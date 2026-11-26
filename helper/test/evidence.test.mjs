import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkBaseline, localEnv, readContainedEvidence, sha256, sourceSnapshot, validateAuditBinding, validateScan } from '../../scripts/evidence.mjs';

function fixture(t) {
  const root = fs.mkdtempSync('/private/tmp/parley-evidence-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  return { root, write };
}

test('reference checks accept only the recorded revision and preserve unchanged modules', t => {
  const { root, write } = fixture(t);
  const entries = [
    { entry: 'contracts/Parley.sol', file: 'contract.sol', referenceSha256: sha256('old'),
      currentSha256: sha256('fixed'), change: 'TOKEN-REQUEST-01', description: 'net receipts',
      documentation: 'change.md', independentReview: 'pending' },
    { entry: 'helper/envelope.mjs', file: 'envelope.mjs', referenceSha256: sha256('envelope') },
    { entry: 'test/parley.test.js', file: 'test.js', referenceSha256: sha256('test') },
  ];
  write('contract.sol', 'fixed'); write('envelope.mjs', 'envelope'); write('test.js', 'test');
  write('change.md', 'documented change');
  const results = checkBaseline(root, { version: 1, entries });
  assert.equal(results[0].name, 'documented-change:contracts/Parley.sol');
  assert.equal(results[0].independentReview, 'pending');
  write('contract.sol', 'unrecorded');
  assert.throws(() => checkBaseline(root, { version: 1, entries }), /Unrecorded source change/);
  write('contract.sol', 'fixed'); write('test.js', 'modified test');
  assert.throws(() => checkBaseline(root, { version: 1, entries }), /Unrecorded source change/);
});

test('local verification never inherits a fork, production key or ambient long-fuzz mode', () => {
  assert.deepEqual(localEnv({ PATH: '/bin', FORK_RPC: 'remote', FORK_BLOCK: '123',
    DEPLOYER_KEY: 'not-a-real-key', PARLEY_LONG_FUZZ: '1' }), { PATH: '/bin', PARLEY_LONG_FUZZ: '0' });
});

test('scan validation rejects stale, tampered and failed analysis', () => {
  const scan = { success: true, results: { detectors: [] } };
  const raw = Buffer.from(JSON.stringify(scan));
  const metadata = { status: 'completed', snapshotSha256: 'current', reportSha256: sha256(raw), exit: 0 };
  const snapshot = { sha256: 'current' };
  assert.doesNotThrow(() => validateScan(scan, metadata, snapshot, raw));
  assert.throws(() => validateScan(scan, metadata, { sha256: 'other' }, raw), /current sources/);
  assert.throws(() => validateScan(scan, metadata, snapshot, Buffer.from('tampered')), /integrity/);
  assert.throws(() => validateScan({ ...scan, success: false }, metadata, snapshot, raw), /did not complete/);
  assert.throws(() => validateScan(scan, { ...metadata, exit: 1 }, snapshot, raw), /process failed/);
});

function auditFixture() {
  const snapshot = { sha256: 'snapshot', files: { 'contracts/contracts/Parley.sol': 'source' } };
  const scan = { success: true, results: { detectors: [
    { id: 'finding1', check: 'reentrancy-eth', impact: 'High', confidence: 'Medium' },
    { id: 'finding2', check: 'timestamp', impact: 'Low', confidence: 'High' },
  ] } };
  const scanRaw = Buffer.from(JSON.stringify(scan));
  const context = { scan, scanRaw,
    scanMetadata: { status: 'completed', snapshotSha256: 'snapshot', reportSha256: sha256(scanRaw),
      exit: 255, compilerBuildSha256: 'compiler' },
    compilerBuildSha256: 'compiler', verificationReportSha256: 'verification',
    reviewNotBefore: Date.parse('2026-11-22T23:00:00Z'),
    observationIds: ['TOKEN-REQUEST-01', 'ID-LIFECYCLE-01'], readEvidence: () => Buffer.from('test evidence') };
  const reviewed = { disposition: 'mitigated', rationale: 'Independent analysis with attached current source evidence.',
    reviewedBy: 'independent reviewer', reviewedAt: '2026-11-23T00:00:00Z',
    evidence: [{ path: 'docs/reports/test.json', sha256: sha256('test evidence') }] };
  const audit = { schemaVersion: 2, independentAudit: 'completed', independenceDeclared: true,
    releaseDecision: 'approve', unresolvedIssues: [], snapshotSha256: 'snapshot', sourceHash: 'source',
    compilerBuildSha256: 'compiler', scanReportSha256: sha256(scanRaw),
    verificationReportSha256: 'verification', reviewers: ['independent reviewer'],
    completedAt: '2026-11-23T01:00:00Z',
    findings: scan.results.detectors.map(d => ({ id: d.id, detector: d.check,
      originalImpact: d.impact, originalConfidence: d.confidence, ...structuredClone(reviewed) })),
    observations: context.observationIds.map(id => ({ id, ...structuredClone(reviewed) })),
  };
  const validate = () => {
    const raw = Buffer.from(JSON.stringify(audit));
    return validateAuditBinding({ snapshotSha256: 'snapshot', reportSha256: sha256(raw) },
      audit, snapshot, raw, context);
  };
  return { audit, context, validate };
}

test('a source-bound audit must cover every exact finding and separate observation', () => {
  assert.doesNotThrow(auditFixture().validate);
  for (const mutate of [
    a => { a.independentAudit = 'pending'; },
    a => { a.sourceHash = 'old'; },
    a => { a.reviewers = []; },
    a => { delete a.schemaVersion; },
    a => { a.independenceDeclared = false; },
    a => { a.releaseDecision = 'blocked'; },
    a => { a.unresolvedIssues = ['unresolved vulnerability']; },
    a => { a.compilerBuildSha256 = 'other'; },
    a => { a.scanReportSha256 = 'other'; },
    a => { a.verificationReportSha256 = 'other'; },
    a => { a.completedAt = '2026-11-21T00:00:00Z'; },
    a => { a.findings.pop(); },
    a => { a.findings[1] = a.findings[0]; },
    a => { a.findings[0].id = 'unknown'; },
    a => { a.findings[0].originalImpact = 'Low'; },
    a => { a.findings[0].originalConfidence = 'Low'; },
    a => { a.findings[0].detector = 'different'; },
    a => { a.observations.pop(); },
    a => { a.observations[1] = a.observations[0]; },
  ]) {
    const { audit, validate } = auditFixture();
    mutate(audit);
    assert.throws(validate);
  }
});

test('an item cannot close without rationale, named review and integrity-checked evidence', () => {
  for (const mutate of [
    f => { f.disposition = 'pending'; },
    f => { f.disposition = 'accepted-risk'; },
    f => { f.rationale = 'safe'; },
    f => { f.reviewedBy = 'unknown reviewer'; },
    f => { f.reviewedAt = 'invalid'; },
    f => { f.reviewedAt = '2026-11-21T00:00:00Z'; },
    f => { f.reviewedAt = '2026-11-24T00:00:00Z'; },
    f => { f.evidence = []; },
    f => { f.evidence[0].path = '../outside.json'; },
    f => { f.evidence[0].path = '/outside.json'; },
    f => { f.evidence[0].path = 'docs\\outside.json'; },
    f => { f.evidence[0].sha256 = 'bad'; },
    f => { f.evidence[0].sha256 = sha256('tampered'); },
  ]) {
    const { audit, validate } = auditFixture();
    mutate(audit.findings[0]);
    assert.throws(validate);
  }
  const lowRisk = auditFixture();
  lowRisk.audit.findings[1].disposition = 'accepted-risk';
  assert.doesNotThrow(lowRisk.validate);
  const observation = auditFixture();
  observation.audit.observations[0].disposition = 'accepted-risk';
  assert.throws(observation.validate, /High\/Medium/);
});

test('audit evidence rejects a stale current scan or compiler context', () => {
  const { validate, context } = auditFixture();
  context.scanMetadata.snapshotSha256 = 'old';
  assert.throws(validate, /current sources/);
  context.scanMetadata.snapshotSha256 = 'snapshot';
  context.compilerBuildSha256 = 'other';
  assert.throws(validate, /Scan compiler/);
});

test('contained evidence refuses traversal and symlinks outside the project', t => {
  const { root, write } = fixture(t);
  write('reports/evidence.json', 'safe evidence');
  assert.equal(readContainedEvidence(root, 'reports/evidence.json').toString(), 'safe evidence');
  for (const name of ['../outside', '/etc/passwd', 'reports/../evidence.json', 'reports\\evidence.json'])
    assert.throws(() => readContainedEvidence(root, name), /contained/);
  fs.symlinkSync('/etc/hosts', path.join(root, 'reports/escape'));
  assert.throws(() => readContainedEvidence(root, 'reports/escape'), /symlink escapes/);
});

test('snapshot includes new input files and rejects linked source inputs', t => {
  const { root, write } = fixture(t);
  for (const name of ['package.json', 'package-lock.json', 'contracts/package.json',
    'contracts/package-lock.json', 'contracts/hardhat.config.js', 'contracts/.solcover.js',
    '.solhint.json', 'config/build.json', 'config/source-baseline.json', 'config/deployment-intent.example.json',
    'config/operations.example.json', 'config/submission.example.json', 'skill-template.md',
    'docs/reports/registry-sourcify-2026-11-23.json', 'docs/reports/registry-rpc-2026-11-23.json',
    'helper/build.mjs', 'web/site/index.html', 'web/site/404.html', 'web/site/style.css', 'web/site/_headers', 'web/site/_redirects'])
    write(name, '{}');
  for (const dir of ['contracts/contracts', 'contracts/test', 'contracts/helper', 'contracts/scripts', 'helper/src', 'helper/test',
    'scripts', 'resident', 'web/stats', 'web/site/src', 'operations'])
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  const before = sourceSnapshot(root);
  write('scripts/new.mjs', 'new input');
  assert.notEqual(sourceSnapshot(root).sha256, before.sha256);
  const withScript = sourceSnapshot(root);
  write('contracts/scripts/fork-check.js', 'fork input');
  assert.notEqual(sourceSnapshot(root).sha256, withScript.sha256);
  const withFork = sourceSnapshot(root);
  write('operations/install.sh', '#!/bin/bash\nexit 0\n');
  assert.notEqual(sourceSnapshot(root).sha256, withFork.sha256);
  fs.symlinkSync(path.join(root, 'scripts/new.mjs'), path.join(root, 'scripts/link.mjs'));
  assert.throws(() => sourceSnapshot(root), /Symlink/);
});
