import test from 'node:test';
import assert from 'node:assert/strict';
import { auditRequest } from '../../scripts/audit-request.mjs';
import { auditHandoffFiles, verifyAuditHandoff } from '../../scripts/audit-handoff.mjs';
import { sha256 } from '../../scripts/evidence.mjs';

const when = '2026-11-26T10:00:00.000Z';
function fixture() {
  const sources = {
    'contracts/contracts/Parley.sol': Buffer.from('public contract source'),
    'package.json': Buffer.from('{"name":"public-project"}'),
  };
  const snapshot = { files: Object.fromEntries(Object.entries(sources).map(([n, d]) => [n, sha256(d)])) };
  snapshot.sha256 = sha256(JSON.stringify(snapshot.files));
  const build = { input: { sources: { 'contracts/Parley.sol': { content: sources['contracts/contracts/Parley.sol'].toString() } } },
    output: { publicArtifact: true } };
  const scan = { success: true, results: { detectors: [
    { id: 'finding-one', check: 'reentrancy-eth', impact: 'High', confidence: 'Medium', description: 'review me' },
  ] } };
  const scanRaw = Buffer.from(JSON.stringify(scan));
  const files = { ...sources, 'docs/reports/tests.log': Buffer.from('actual test output'),
    'docs/reports/registry.json': Buffer.from('{"status":"passed"}'),
    'docs/reports/security.json': Buffer.from('{"independentAudit":"pending"}'),
    'docs/reports/scan.json': scanRaw };
  const verification = { status: 'passed', snapshot,
    results: [{ name: 'unit', log: 'docs/reports/tests.log', logSha256: sha256(files['docs/reports/tests.log']) }],
    registryEvidence: { report: 'docs/reports/registry.json', reportSha256: sha256(files['docs/reports/registry.json']) } };
  files['docs/reports/verification.json'] = Buffer.from(JSON.stringify(verification));
  const context = {
    snapshot, scan, scanRaw, compilerBuildSha256: sha256(JSON.stringify(build)),
    verificationReportSha256: sha256(files['docs/reports/verification.json']),
    verificationPointer: { report: 'docs/reports/verification.json' },
    securityPointer: { report: 'docs/reports/security.json', reportSha256: sha256(files['docs/reports/security.json']) },
    scanPointer: { report: 'docs/reports/scan.json', metadata: 'docs/reports/scan-metadata.json' },
    scanMetadata: { status: 'completed', compilerBuildSha256: sha256(JSON.stringify(build)) },
    security: { additionalObservations: [{ id: 'TOKEN-REQUEST-01', summary: 'request net receipt' },
      { id: 'ID-LIFECYCLE-01', summary: 'registry lifecycle' }] },
    reviewNotBefore: Date.parse(when) - 1000,
    readEvidence: name => { assert.ok(Object.hasOwn(files, name), `Unexpected read: ${name}`); return files[name]; },
  };
  files['docs/reports/scan-metadata.json'] = Buffer.from(JSON.stringify(context.scanMetadata));
  return { files, context, build, make: () => auditHandoffFiles(context, build, when) };
}

test('handoff request preserves exact severity, both observations and pending independent decisions', () => {
  const { context } = fixture();
  const request = auditRequest(context, when);
  assert.equal(request.independentAudit, 'pending');
  assert.equal(request.releaseDecision, 'blocked');
  assert.equal(request.independenceDeclared, false);
  assert.deepEqual(request.reviewers, []);
  assert.equal(request.findings[0].originalImpact, 'High');
  assert.equal(request.findings[0].id, 'finding-one');
  for (const item of [...request.findings, ...request.observations]) {
    assert.equal(item.disposition, 'pending');
    assert.deepEqual(item.evidence, []);
    assert.equal(item.reviewedBy, null);
  }
  request.findings[0].disposition = 'mitigated';
  assert.equal(auditRequest(context, when).findings[0].disposition, 'pending');
  assert.equal(request.observations.length, 2);
});

test('request cannot predate completed evidence or use an invalid date', () => {
  const { context } = fixture();
  for (const date of ['invalid', '2026-11-25T00:00:00Z'])
    assert.throws(() => auditRequest(context, date), /predate/);
});

test('handoff contains the complete snapshot, exact compiler and every referenced public report and log', () => {
  const { make, files, context, build } = fixture();
  const entries = make(), manifest = verifyAuditHandoff(entries);
  assert.equal(manifest.sourceSnapshotSha256, context.snapshot.sha256);
  assert.equal(manifest.findings, 1);
  assert.equal(manifest.observations, 2);
  for (const [name, bytes] of Object.entries(files)) assert.deepEqual(entries[`project/${name}`], bytes);
  assert.deepEqual(JSON.parse(entries['compiler/current-build.json']), build);
  assert.equal(manifest.productionRelease, false);
  assert.deepEqual(make(), entries);
});

test('source, compiler, verification, scan, security and test log changes are refused', () => {
  for (const name of ['contracts/contracts/Parley.sol', 'docs/reports/verification.json',
    'docs/reports/scan.json', 'docs/reports/security.json', 'docs/reports/tests.log',
    'docs/reports/registry.json', 'docs/reports/scan-metadata.json']) {
    const { files, make } = fixture();
    files[name] = Buffer.from('changed');
    assert.throws(make);
  }
  const { build, make } = fixture();
  build.output.private = true;
  assert.throws(make, /Compiler input changed/);
});

test('arbitrary, private and escaping snapshot paths cannot become handoff members', () => {
  for (const name of ['../escape', '/absolute', 'config/.env', 'config/telegram.json',
    'operations/bot-token', 'private/participants.json', 'scripts\\escape.mjs']) {
    const { context, make } = fixture();
    context.snapshot.files[name] = sha256('private');
    context.snapshot.sha256 = sha256(JSON.stringify(context.snapshot.files));
    assert.throws(make);
  }
});

test('report pointers cannot read arbitrary workspace paths or collide with snapshot sources', () => {
  for (const name of ['.env', 'private/interviews.json', '../escape.json', 'contracts/contracts/Parley.sol']) {
    const { context, make } = fixture();
    context.securityPointer.report = name;
    assert.throws(make);
  }
});

test('handoff integrity rejects missing, extra, modified members and altered checksum lists', () => {
  for (const mutate of [
    files => { delete files['project/package.json']; },
    files => { files['extra.json'] = Buffer.from('not allowed'); },
    files => { files['project/package.json'] = Buffer.from('changed'); },
    files => { files.SHA256SUMS = Buffer.from('fabricated'); },
    files => { files['compiler/current-build.json'] = Buffer.from('{}'); },
    files => { files['audit-request.json'] = Buffer.from('{}'); },
  ]) {
    const entries = fixture().make();
    mutate(entries);
    assert.throws(() => verifyAuditHandoff(entries));
  }
});

test('handoff manifest cannot mark independent review or production release complete', () => {
  for (const change of [{ independentAudit: 'completed' }, { productionRelease: true }, { status: 'approved' }]) {
    const entries = fixture().make();
    entries['handoff-manifest.json'] = Buffer.from(JSON.stringify({
      ...JSON.parse(entries['handoff-manifest.json']), ...change,
    }));
    assert.throws(() => verifyAuditHandoff(entries));
  }
});
