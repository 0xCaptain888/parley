import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { checkBaseline, localEnv, sha256, sourceSnapshot } from './evidence.mjs';
import { currentBuild } from './build-info.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'contracts/package.json'));
const { utils: coverageUtils } = require('sc-istanbul');
const startedAt = new Date().toISOString();
const relative = `docs/reports/local-verification-${startedAt.replace(/[:.]/g, '-')}`;
const out = path.join(root, relative);
fs.mkdirSync(out, { recursive: true });
const snapshot = sourceSnapshot(root);
const env = localEnv();
const results = [];
const report = {
  startedAt, timezone: 'Asia/Shanghai', scope: 'Local only; no wallet or mainnet transaction',
  snapshot, results, status: 'running', productionRelease: false,
};
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
save();
function run(name, command, args, timeout = 3600000) {
  const r = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout,
    maxBuffer: 30 * 1024 * 1024 });
  const output = (r.stdout || '') + (r.stderr || '');
  fs.writeFileSync(path.join(out, `${name}.log`), output);
  results.push({
    name, status: !r.error && r.status === 0 ? 'passed' : 'failed', exit: r.status,
    log: `${relative}/${name}.log`, logSha256: sha256(output),
    mochaPassing: Number(output.match(/(\d+) passing/)?.[1] || 0),
    nodeTestPassing: Number(output.match(/# pass (\d+)/)?.[1] || 0),
    ...(r.error ? { error: r.error.message } : {}),
  });
  save();
  console.log(`${name}: ${results.at(-1).status}; ${relative}/${name}.log`);
  assert.equal(results.at(-1).status, 'passed', `${name} failed; see saved log`);
}
try {
  results.push(...checkBaseline(root,
    JSON.parse(fs.readFileSync(path.join(root, 'config/source-baseline.json'))), process.argv[2]));
  for (const [name, args] of [
    ['coverage', ['run', 'test:coverage']],
    ['contracts', ['run', 'test:contracts']],
    ['unit', ['test']],
    ['operations', ['run', 'test:operations']],
    ['security-boundaries', ['run', 'check:boundaries']],
    ['registry', ['run', 'test:registry']],
    ['fuzz', ['run', 'test:fuzz']],
    ['integration', ['run', 'test:e2e']],
    ['solhint', ['run', 'check:static']],
    ['build', ['run', 'build']],
  ]) run(name, 'npm', args);
  const registryRaw = fs.readFileSync(path.join(root, 'docs/reports/registry-current.json'));
  const registry = JSON.parse(registryRaw);
  assert.equal(registry.status, 'passed');
  assert.ok(Date.parse(registry.checkedAt) >= Date.parse(startedAt), 'Registry report is stale');
  fs.writeFileSync(path.join(out, 'registry.json'), registryRaw);
  report.registryEvidence = { report: `${relative}/registry.json`, reportSha256: sha256(registryRaw) };
  const checksum = fs.readFileSync(path.join(root, 'skill/SHA256SUMS'), 'utf8');
  execFileSync(process.execPath, [path.join(root, 'helper/build.mjs')], { cwd: root, env, stdio: 'pipe' });
  assert.equal(fs.readFileSync(path.join(root, 'skill/SHA256SUMS'), 'utf8'), checksum,
    'Build is not reproducible');
  report.skillManifest = checksum;
  results.push({ name: 'reproducible-build', status: 'passed' });
  run('development-gate', process.execPath, ['scripts/release-check.mjs', '--development']);
  const denied = spawnSync(process.execPath, ['scripts/release-check.mjs'], { cwd: root, env, encoding: 'utf8' });
  const denial = (denied.stdout || '') + (denied.stderr || '');
  fs.writeFileSync(path.join(out, 'production-blocked.log'), denial);
  assert.ok(!denied.error && denied.status === 1 && /Mainnet deployment is not configured/.test(denial),
    'Expected unconfigured production deployment to be rejected');
  results.push({ name: 'mainnet-gate-fails-closed', status: 'passed' });
  const build = currentBuild(root);
  report.compiler = { version: build.solcLongVersion, settings: build.input.settings,
    buildSha256: sha256(JSON.stringify(build)), runtimeBytes:
      build.output.contracts['contracts/Parley.sol'].Parley.evm.deployedBytecode.object.length / 2 };
  const coverageRaw = fs.readFileSync(path.join(root, 'contracts/coverage.json'));
  fs.writeFileSync(path.join(out, 'coverage.json'), coverageRaw);
  const summary = coverageUtils.summarizeCoverage(JSON.parse(coverageRaw));
  report.coverage = Object.fromEntries(['lines', 'statements', 'functions', 'branches'].map(k => [k, summary[k]]));
  for (const kind of ['lines', 'statements', 'functions'])
    assert.equal(report.coverage[kind].pct, 100, `${kind} coverage regressed below 100%`);
  assert.ok(report.coverage.branches.pct >= 84.74, 'Branch coverage regressed below the reference run');
  results.push({ name: 'coverage-thresholds', status: 'passed' });
  assert.deepEqual(sourceSnapshot(root), snapshot, 'Verification inputs changed during the run');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  save();
  const bytes = fs.readFileSync(path.join(out, 'report.json'));
  fs.writeFileSync(path.join(root, 'docs/reports/verification-current.json'), JSON.stringify({
    report: `${relative}/report.json`, reportSha256: sha256(bytes),
    snapshotSha256: snapshot.sha256, status: report.status, completedAt: report.completedAt,
  }, null, 2) + '\n');
}
console.log(`Local verification ${report.status}. Production release remains blocked.`);
