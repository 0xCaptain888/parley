import assert from 'node:assert/strict';
import { currentBuild } from './build-info.mjs';
import { readContainedEvidence, sha256, sourceSnapshot, validateScan } from './evidence.mjs';

export function auditContext(root) {
  const read = name => readContainedEvidence(root, name);
  const json = name => JSON.parse(read(name));
  const snapshot = sourceSnapshot(root);
  const pointer = json('docs/reports/verification-current.json');
  const verificationRaw = read(pointer.report);
  assert.equal(sha256(verificationRaw), pointer.reportSha256, 'Verification report integrity mismatch');
  const verification = JSON.parse(verificationRaw);
  assert.equal(verification.status, 'passed', 'Full local verification must pass');
  assert.deepEqual(verification.snapshot, snapshot, 'Verification does not cover current inputs');
  for (const name of ['security-boundaries', 'coverage', 'unit', 'contracts', 'registry', 'fuzz', 'integration',
    'solhint', 'build', 'reproducible-build', 'development-gate', 'mainnet-gate-fails-closed', 'coverage-thresholds'])
    assert.equal(verification.results.find(r => r.name === name)?.status, 'passed', `Missing check: ${name}`);
  const compilerBuildSha256 = sha256(JSON.stringify(currentBuild(root)));
  assert.equal(verification.compiler.buildSha256, compilerBuildSha256, 'Verification compiler mismatch');
  for (const run of verification.results.filter(r => r.log))
    assert.equal(sha256(read(run.log)), run.logSha256, `Verification log changed: ${run.name}`);
  const scanPointer = json('docs/reports/slither-current.json');
  const scanRaw = read(scanPointer.report);
  const scan = JSON.parse(scanRaw);
  const scanMetadata = json(scanPointer.metadata);
  validateScan(scan, scanMetadata, snapshot, scanRaw);
  assert.equal(scanMetadata.compilerBuildSha256, compilerBuildSha256, 'Scan compiler mismatch');
  const securityPointer = json('docs/reports/security-review-current.json');
  const securityRaw = read(securityPointer.report);
  assert.equal(sha256(securityRaw), securityPointer.reportSha256, 'Security summary integrity mismatch');
  const security = JSON.parse(securityRaw);
  assert.equal(security.snapshotSha256, snapshot.sha256, 'Security summary is stale');
  assert.equal(security.rawSlitherSha256, sha256(scanRaw), 'Security summary covers a different scan');
  assert.equal(security.verification.reportSha256, pointer.reportSha256, 'Security verification mismatch');
  return { snapshot, scan, scanRaw, scanMetadata, compilerBuildSha256,
    verificationReportSha256: pointer.reportSha256, observationIds: security.additionalObservations.map(o => o.id),
    reviewNotBefore: Math.max(Date.parse(verification.completedAt), Date.parse(scanMetadata.completedAt),
      Date.parse(security.completedAt)),
    readEvidence: read, security, securityPointer, verificationPointer: pointer, scanPointer };
}
