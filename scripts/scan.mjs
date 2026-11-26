import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { currentBuild } from './build-info.mjs';
import { localEnv, sha256, sourceSnapshot } from './evidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const startedAt = new Date().toISOString();
const relative = `docs/reports/slither-${startedAt.replace(/[:.]/g, '-')}`;
const out = path.join(root, relative);
fs.mkdirSync(path.join(out, 'artifacts/build-info'), { recursive: true });
const snapshot = sourceSnapshot(root);
const build = currentBuild(root);
// Scan only the linked current compiler output, never old or coverage-instrumented builds.
fs.writeFileSync(path.join(out, 'artifacts/build-info/current.json'), JSON.stringify(build));
const executable = path.join(root, '.venv-audit/bin/slither');
const args = ['.', '--ignore-compile', '--hardhat-artifacts-directory', path.join(out, 'artifacts'),
  '--filter-paths', 'node_modules|contracts/mocks', '--json', path.join(out, 'raw.json'), '--disable-color'];
const env = localEnv();
const version = spawnSync(executable, ['--version'], { cwd: root, env, encoding: 'utf8' });
assert.ok(!version.error && version.status === 0, 'Slither is unavailable');
const result = spawnSync(executable, args, {
  cwd: path.join(root, 'contracts'), env, encoding: 'utf8', timeout: 300000,
  maxBuffer: 30 * 1024 * 1024,
});
fs.writeFileSync(path.join(out, 'scan.log'), (result.stdout || '') + (result.stderr || ''));
const metadata = {
  startedAt, completedAt: new Date().toISOString(), tool: 'slither', version: version.stdout.trim(),
  snapshotSha256: snapshot.sha256, sourceSha256: snapshot.files['contracts/contracts/Parley.sol'],
  compilerBuildSha256: sha256(JSON.stringify(build)), command: [executable, ...args],
  exit: result.status, status: 'failed', independentAudit: 'pending',
  ...(result.error ? { error: result.error.message } : {}),
};
try {
  const raw = fs.readFileSync(path.join(out, 'raw.json'));
  const scan = JSON.parse(raw);
  assert.ok(!result.error && [0, 255].includes(result.status), 'Static analyzer process failed');
  assert.equal(scan.success, true, 'Static analyzer did not complete');
  assert.ok(Array.isArray(scan.results?.detectors), 'Missing detector results');
  assert.deepEqual(sourceSnapshot(root), snapshot, 'Sources changed during the scan');
  metadata.reportSha256 = sha256(raw);
  metadata.findings = scan.results.detectors.length;
  metadata.counts = scan.results.detectors.reduce((counts, f) => {
    counts[f.impact] = (counts[f.impact] || 0) + 1;
    return counts;
  }, {});
  metadata.status = 'completed';
} catch (error) {
  metadata.error = error.message;
  process.exitCode = 1;
}
fs.writeFileSync(path.join(out, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'docs/reports/slither-current.json'), JSON.stringify({
  metadata: `${relative}/metadata.json`, report: `${relative}/raw.json`, status: metadata.status,
}, null, 2) + '\n');
console.log(JSON.stringify(metadata, null, 2));
