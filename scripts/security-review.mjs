import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { sha256 as sha, sourceSnapshot, validateScan } from './evidence.mjs';
import { currentBuild } from './build-info.mjs';
import { httpsOrigin } from './site-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name));
const json = name => JSON.parse(read(name));
const recordedAt = new Date().toISOString();
const runId = recordedAt.replace(/[:.]/g, '-');
const prefix = `docs/reports/security-review-${runId}`;
const snapshot = sourceSnapshot(root);
const verificationPointer = json('docs/reports/verification-current.json');
const verificationRaw = read(verificationPointer.report);
assert.equal(sha(verificationRaw), verificationPointer.reportSha256);
const previous = JSON.parse(verificationRaw);
assert.equal(previous.status, 'passed', 'Full local verification must pass first');
assert.deepEqual(previous.snapshot, snapshot, 'Local verification does not match current sources');
assert.equal(previous.compiler.buildSha256, sha(JSON.stringify(currentBuild(root))),
  'Compiler output differs from verified build');
for (const name of ['coverage', 'unit', 'contracts', 'security-boundaries', 'registry', 'fuzz', 'integration', 'solhint', 'build',
  'reproducible-build', 'development-gate', 'mainnet-gate-fails-closed', 'coverage-thresholds']) {
  assert.equal(previous.results.find(r => r.name === name)?.status, 'passed', `Missing verified check: ${name}`);
}
for (const run of previous.results.filter(r => r.log))
  assert.equal(sha(read(run.log)), run.logSha256, `Verification log changed: ${run.name}`);
const registryRaw = read(previous.registryEvidence.report);
assert.equal(sha(registryRaw), previous.registryEvidence.reportSha256);
const registry = JSON.parse(registryRaw);
assert.equal(registry.status, 'passed');
assert.equal(registry.evidenceSha256, snapshot.files[registry.evidenceFile]);
assert.equal(registry.publicRpcEvidence.sha256, snapshot.files[registry.publicRpcEvidence.file]);
const sourceHash = sha(read('contracts/contracts/Parley.sol'));
assert.equal(sourceHash, snapshot.files['contracts/contracts/Parley.sol']);
assert.equal(sha(read('contracts/test/parley.test.js')),
  previous.results.find(r => r.name === 'unchanged:test/parley.test.js').sha256);
const scanPointer = json('docs/reports/slither-current.json');
const scanMetadata = json(scanPointer.metadata);
const raw = read(scanPointer.report);
const scan = JSON.parse(raw);
validateScan(scan, scanMetadata, snapshot, raw);
assert.equal(scanMetadata.compilerBuildSha256, previous.compiler.buildSha256,
  'Static scan differs from verified compiler output');

// These are local assessments, never independent approval or severity overrides.
const groups = {
  'reentrancy-balance': [
    'Deposits, wanted-token settlement and request net-receipt checks enter the same nonReentrant guard. Sampled token callbacks cannot enter another funded path. Balance deltas still trust token-reported balances; dishonest/rebasing tokens remain unsupported.',
    ['contracts/test/security.test.js', 'contracts/test/parley.test.js'],
  ],
  'reentrancy-eth': [
    'Object status and reciprocal stamps change before payout; failed pushes add pending, whose only debit path is guarded withdraw. Sampled recursive claim/pull/settlement and failed maker/final-postage payouts conserve liabilities. See the manual unguarded-entry-point analysis; callbacks may mutate their own non-fund state.',
    ['contracts/test/security.test.js', 'contracts/test/returndata.test.js'],
  ],
  'uninitialized-state': [
    '_inbox is an address-to-dynamic-array storage mapping, with zero-length default entries. _mail pushes into those entries. Empty, populated and paginated reads are tested; this observation does not waive the scanner high-severity finding.',
    ['contracts/test/parley.test.js'],
  ],
  'divide-before-multiply': [
    'The multiplication checks exact wei divisibility and rejects a remainder. Existing tests cover non-divisible values, zero/501 shares and the 500-share endpoint.',
    ['contracts/test/parley.test.js', 'contracts/test/supplemental.test.js'],
  ],
  'incorrect-equality': [
    'Reported equalities test zero sentinels, empty receipts or UTC day buckets, not an exact contract balance vulnerable to forced deposits. Cached membership is a separate lifecycle assumption documented as ID-LIFECYCLE-01.',
    ['contracts/test/parley.test.js', 'contracts/test/security.test.js'],
  ],
  'uninitialized-local': [
    'Solidity value-type locals default to zero/false. Public packet released, public offer taker/released and existing-member claim opened are exercised in the original tests. No uninitialized storage pointer is introduced here.',
    ['contracts/test/parley.test.js'],
  ],
  'calls-loop': [
    'Direct packets have at most 50 registry lookups and reject duplicate recipients. Registry view calls execute statically; registry correctness/availability remains an external dependency. The 50-contact gas result is local, not official-wallet acceptance.',
    ['contracts/test/parley.test.js'],
  ],
  'reentrancy-benign': [
    'Delayed pending/inbox counters follow external calls, but all funded entry points share the guard. Own-key rotation during a payout is deliberately allowed and tested; no blanket assertion that callbacks cannot mutate state is made.',
    ['contracts/test/security.test.js'],
  ],
  'return-bomb': [
    'The native push forwards 100000 gas and ignores return bytes. Sampled successful/reverting 128 KiB and out-of-gas 1 MiB responses preserve payment/pending state. Bytecode-level independent review is still needed; samples are not a proof.',
    ['contracts/test/returndata.test.js'],
  ],
  timestamp: [
    'Exact packet/request/offer expiry, the 72-hour stamp edge and UTC-midnight quota reset are tested. Other tainted comparisons are mailbox/zero-amount sentinels. No random outcome depends on timestamp. Validator timestamp discretion and transaction ordering remain assumptions.',
    ['contracts/test/security.test.js', 'contracts/test/parley.test.js'],
  ],
  'costly-loop': [
    'Inbox writes occur in a bounded maximum-50 direct-recipient loop. The ordinary non-instrumented local test checks gas below 15000000; production registry/wallet/RPC limits are not proven by it.',
    ['contracts/test/parley.test.js'],
  ],
  'cyclomatic-complexity': [
    'Reference createPacket/createOffer/acceptOffer complexity is retained. Boundary, rollback and accounting tests reduce sampled regression risk, not the need for independent review.',
    ['contracts/test/parley.test.js', 'contracts/test/security.test.js', 'contracts/test/fuzz.test.js'],
  ],
  'low-level-calls': [
    'Native pushes use the capped fallback-to-pending helper; pull zeros pending before its guarded call and reverts on failure. Recursive pull and failed-pull restoration are tested.',
    ['contracts/test/security.test.js', 'contracts/test/returndata.test.js'],
  ],
  'naming-convention': [
    'Uppercase immutables match the reference source; the net-receipt fix is unrelated to these style observations.',
    [],
  ],
};

const findings = scan.results.detectors.map((d, index) => {
  const group = groups[d.check] || [
    'New detector group: no inherited assessment. Manual investigation and independent sign-off required.', [],
  ];
  return {
    index: index + 1, id: d.id, detector: d.check,
    originalImpact: d.impact, originalConfidence: d.confidence,
    description: d.description, localAssessment: group[0],
    testFiles: group[1], independentSignoff: 'pending',
  };
});
assert.equal(new Set(findings.map(f => f.id)).size, findings.length);

const runs = previous.results;

const config = json('config/build.json');
assert.equal(config.contract, null);
assert.equal(config.deploymentBlock, null);
if (config.site !== null) assert.equal(httpsOrigin(config.site), config.site);
assert.equal(config.resident, null);
assert.equal(json('config/release-evidence.json').auditReview, 'pending');
const report = {
  recordedAt, completedAt: new Date().toISOString(), timezone: 'Asia/Shanghai',
  scope: 'Local source review and adversarial tests only; no wallet access, network transaction or independent audit.',
  sourceHash, snapshotSha256: snapshot.sha256, originalTestHash: sha(read('contracts/test/parley.test.js')),
  verification: verificationPointer,
  rawSlitherReport: scanPointer.report, scanMetadata: scanPointer.metadata,
  rawSlitherSha256: sha(raw), staticAnalyzerRerun: true,
  counts: findings.reduce((counts, f) => {
    counts[f.originalImpact] = (counts[f.originalImpact] || 0) + 1;
    return counts;
  }, {}),
  findings,
  additionalObservations: [
    {
      id: 'TOKEN-REQUEST-01', classification: 'medium-correctness-risk',
      summary: 'Local source now rejects a 100-token request that would deliver 95, rolling back payment effects.',
      status: 'fixed locally with regression tests; unresolved on immutable trial contract',
      action: 'Independently review the changed source and token balance assumptions. A separate authorized deployment is required; the old trial is unchanged.',
    },
    {
      id: 'ID-LIFECYCLE-01', classification: 'conditional-identity-assumption',
      summary: 'An already-open member can claim after a synthetic registry sets its ID balance to zero.',
      status: 'synthetic case reproduced; verified production source and pinned RPC runtime support permanent soulbound identity; independent review pending',
      evidence: previous.registryEvidence,
      action: 'Independently review verified registry and inherited call paths. No exposed revoke/burn/upgrade path was found in local source review. Do not claim continuous qualification or one-person identity guarantees from cached membership.',
    },
  ],
  runs,
  productionRelease: false, independentAudit: 'pending',
};
const reportPath = `${prefix}.json`;
fs.writeFileSync(path.join(root, reportPath), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(path.join(root, 'docs/reports/security-review-current.json'), JSON.stringify({
  report: reportPath, reportSha256: sha(read(reportPath)), snapshotSha256: snapshot.sha256,
  independentAudit: 'pending',
}, null, 2) + '\n');
console.log(JSON.stringify({
  report: reportPath, findings: findings.length, counts: report.counts,
  testsPassed: runs.every(r => r.status === 'passed'), sourceMatchesEvidence: true, productionBlocked: true,
}, null, 2));
process.exitCode = runs.every(r => r.status === 'passed') ? 0 : 1;
