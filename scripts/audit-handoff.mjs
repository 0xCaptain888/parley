import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { auditContext } from './audit-context.mjs';
import { auditRequest } from './audit-request.mjs';
import { currentBuild } from './build-info.mjs';
import { sha256, sourceSnapshot } from './evidence.mjs';
import { safePath } from './operational-monitor.mjs';

const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const relativePath = name => assert.ok(typeof name === 'string'
  && /^[A-Za-z0-9_@./-]+$/.test(name) && !path.posix.isAbsolute(name)
  && name.split('/').every(p => p && p !== '.' && p !== '..'), 'Unsafe handoff member');
const publicEvidence = name => {
  relativePath(name);
  assert.match(name, /^docs\/reports\/[A-Za-z0-9_./-]+\.(json|log)$/, 'Only public verification evidence');
};

export function auditHandoffFiles(context, build, createdAt) {
  const entries = {};
  const put = (name, data) => {
    relativePath(name);
    assert.ok(!Object.hasOwn(entries, name), 'Duplicate handoff member');
    entries[name] = Buffer.from(data);
  };
  const checked = (name, expected) => {
    const data = context.readEvidence(name);
    assert.equal(sha256(data), expected, `Handoff input changed: ${name}`);
    put(`project/${name}`, data);
  };
  assert.equal(sha256(JSON.stringify(context.snapshot.files)), context.snapshot.sha256, 'Invalid source snapshot');
  assert.equal(sha256(JSON.stringify(build)), context.compilerBuildSha256, 'Compiler input changed');
  for (const [name, expected] of Object.entries(context.snapshot.files)) {
    relativePath(name);
    assert.ok(['package.json', 'package-lock.json', '.solhint.json', 'skill-template.md'].includes(name)
      || /^(contracts|config|helper|scripts|resident|web|operations|docs\/reports)\//.test(name),
    'Unexpected source scope');
    assert.ok(!/(^|\/)(\.env[^/]*|[^/]*secret[^/]*|bot-token|telegram\.json|delivery-state\.json)$/.test(name),
      'Private material is not a handoff input');
    checked(name, expected);
  }
  const verificationName = context.verificationPointer.report;
  publicEvidence(verificationName);
  const verificationRaw = context.readEvidence(verificationName);
  assert.equal(sha256(verificationRaw), context.verificationReportSha256, 'Verification input changed');
  const verification = JSON.parse(verificationRaw);
  const refs = new Map([
    [verificationName, context.verificationReportSha256],
    [context.securityPointer.report, context.securityPointer.reportSha256],
    [context.scanPointer.report, sha256(context.scanRaw)],
    [verification.registryEvidence.report, verification.registryEvidence.reportSha256],
  ]);
  for (const run of verification.results.filter(r => r.log)) refs.set(run.log, run.logSha256);
  for (const [name, expected] of refs) {
    publicEvidence(name);
    assert.ok(!Object.hasOwn(context.snapshot.files, name), 'Evidence/source collision');
    checked(name, expected);
  }
  publicEvidence(context.scanPointer.metadata);
  const metadata = context.readEvidence(context.scanPointer.metadata);
  assert.deepEqual(JSON.parse(metadata), context.scanMetadata, 'Scan metadata changed');
  put(`project/${context.scanPointer.metadata}`, metadata);
  put('source-snapshot.json', json(context.snapshot));
  put('compiler/current-build.json', Buffer.from(JSON.stringify(build)));
  put('audit-request.json', json(auditRequest(context, createdAt)));
  put('README.txt', Buffer.from([
    'Parley independent review handoff',
    '',
    'This archive is pending review, not an audit approval or deployment authorization.',
    'SHA256SUMS covers every member except itself. Verify it before opening sources.',
    'project/ preserves all snapshot and referenced report paths.',
    'compiler/current-build.json includes the exact compiler input and dependency sources.',
    'audit-request.json retains every original scanner severity and all pending items.',
    'Local assessments/tests are not independent reviewer conclusions.',
    '',
    'Review every finding and both separate observations; attach actual evidence.',
    'Do not treat accepted High/Medium risks as releasable. Fixes require fresh evidence.',
    'Return the completed report and any new evidence using project-relative paths.',
    'Operator must verify reviewer independence/provenance separately.',
    'Nothing in this archive signs, deploys, publishes or changes release flags.',
    'Do not execute install scripts merely because they are present for source review.',
    '',
  ].join('\n')));
  put('handoff-manifest.json', json({
    schemaVersion: 1, status: 'prepared-pending-independent-review',
    sourceSnapshotSha256: context.snapshot.sha256, compilerBuildSha256: context.compilerBuildSha256,
    findings: context.scan.results.detectors.length, observations: context.security.additionalObservations.length,
    independentAudit: 'pending', productionRelease: false,
    files: Object.fromEntries(Object.keys(entries).sort().map(name => [name, sha256(entries[name])])),
  }));
  put('SHA256SUMS', Buffer.from(Object.keys(entries).sort()
    .map(name => `${sha256(entries[name])}  ${name}\n`).join('')));
  return entries;
}

export function verifyAuditHandoff(entries) {
  const manifest = JSON.parse(entries['handoff-manifest.json']);
  assert.equal(manifest.status, 'prepared-pending-independent-review');
  assert.equal(manifest.independentAudit, 'pending');
  assert.equal(manifest.productionRelease, false);
  const expectedNames = [...Object.keys(manifest.files), 'handoff-manifest.json', 'SHA256SUMS'].sort();
  assert.deepEqual(Object.keys(entries).sort(), expectedNames, 'Unexpected handoff files');
  for (const [name, expected] of Object.entries(manifest.files)) {
    relativePath(name);
    assert.equal(sha256(entries[name]), expected, `Handoff member changed: ${name}`);
  }
  const sums = expectedNames.filter(name => name !== 'SHA256SUMS')
    .map(name => `${sha256(entries[name])}  ${name}\n`).join('');
  assert.equal(entries.SHA256SUMS.toString(), sums, 'Handoff checksum manifest changed');
  const snapshot = JSON.parse(entries['source-snapshot.json']);
  assert.equal(sha256(JSON.stringify(snapshot.files)), snapshot.sha256);
  assert.equal(snapshot.sha256, manifest.sourceSnapshotSha256);
  for (const [name, expected] of Object.entries(snapshot.files))
    assert.equal(sha256(entries[`project/${name}`]), expected);
  const request = JSON.parse(entries['audit-request.json']);
  assert.equal(request.snapshotSha256, snapshot.sha256);
  assert.equal(sha256(entries['compiler/current-build.json']), manifest.compilerBuildSha256);
  return manifest;
}

export function packageAuditHandoff(root, output) {
  assert.ok(path.isAbsolute(output) && !fs.existsSync(output), 'Exclusive absolute output required');
  safePath(path.dirname(output), { directory: true });
  const context = auditContext(root);
  const files = auditHandoffFiles(context, currentBuild(root), new Date().toISOString());
  const manifest = verifyAuditHandoff(files);
  fs.mkdirSync(output, { mode: 0o700 });
  for (const [name, data] of Object.entries(files)) {
    const dest = path.join(output, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
    fs.writeFileSync(dest, data, { flag: 'wx', mode: 0o600 });
    fs.utimesSync(dest, 946684800, 946684800);
  }
  assert.equal(sourceSnapshot(root).sha256, context.snapshot.sha256, 'Source changed during handoff');
  const archive = path.join(output, 'audit-handoff.zip');
  const names = Object.keys(files).sort();
  execFileSync('zip', ['-q', '-X', archive, '-@'], { cwd: output, input: names.join('\n') + '\n' });
  const actualNames = execFileSync('unzip', ['-Z', '-1', archive], { encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(actualNames, names, 'Unexpected archive members');
  for (const name of names)
    assert.deepEqual(execFileSync('unzip', ['-p', archive, name], { maxBuffer: 30 * 1024 * 1024 }), files[name]);
  return { archive, archiveSha256: sha256(fs.readFileSync(archive)),
    archiveMembers: names.length, everyArchiveMemberVerified: true,
    sourceSnapshotSha256: manifest.sourceSnapshotSha256, findings: manifest.findings,
    observations: manifest.observations, independentAudit: 'pending',
    uploaded: false, walletAccess: false, productionRelease: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 3, 'One explicit new output directory required');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    console.log(JSON.stringify(packageAuditHandoff(root, path.resolve(process.argv[2])), null, 2));
  } catch {
    console.error('AUDIT_HANDOFF_REFUSED_CHECK_SOURCE_BOUND_EVIDENCE_AND_OUTPUT');
    process.exitCode = 2;
  }
}
