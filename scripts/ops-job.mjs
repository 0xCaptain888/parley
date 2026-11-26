import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from '../helper/src/normalize.mjs';
import { readJson, locked } from '../helper/src/state.mjs';
import { safePath, validateOperations, writeOperationalLog, monitorHealth } from './operational-monitor.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const { positional, options: o } = parseArgs(process.argv.slice(2));
  assert.equal(positional.length, 1);
  const job = positional[0];
  assert.ok(['resident', 'health', 'stats'].includes(job));
  assert.deepEqual(Object.keys(o).sort(), ['build', 'config', 'logs', 'state-dir']);
  for (const key of ['build', 'config']) safePath(o[key], { privateMode: key === 'config' });
  for (const key of ['logs', 'state-dir']) safePath(o[key], { directory: true, privateMode: true });
  const config = readJson(o.config, null), build = readJson(o.build, null);
  assert.equal(config.mode, 'manual', 'Automatic signing is prohibited');
  if (config.stateRoot) assert.equal(o['state-dir'], path.join(config.stateRoot,
    `${build.chainId}-${build.contract.slice(2, 10).toLowerCase()}`, config.from.toLowerCase()),
  'Queue state differs from configured state root');
  for (const key of ['statsState', 'statsOutput'].filter(k => config[k])) {
    assert.ok(path.isAbsolute(config[key]), 'Absolute mutable statistics path required');
    for (let p = config[key]; p !== path.dirname(p); p = path.dirname(p))
      if (fs.existsSync(p)) assert.ok(!fs.lstatSync(p).isSymbolicLink(), 'Symlink statistics path refused');
  }
  const operations = config.operationsPath
    ? validateOperations(readJson(safePath(config.operationsPath, { privateMode: true }), null))
    : { schemaVersion: 1, logs: { maxBytes: 1024 * 1024, keep: 7 },
      alerts: { enabled: false, webhook: null, cooldownSeconds: 300 } };
  await locked(o.logs, async () => {
    const args = job === 'resident'
      ? ['resident/resident.mjs', '--config', o.config, '--build', o.build, '--once']
      : job === 'health'
        ? ['scripts/resident-ops.mjs', 'health', '--config', o.config, '--build', o.build, '--state-dir', o['state-dir'],
          ...(config.statsOutput ? ['--stats', config.statsOutput] : [])]
        : ['scripts/stats-runner.mjs', '--build', o.build, '--rpc', config.logRpc, '--state-dir',
          config.statsState || path.join(root, 'web/stats/state', `${build.chainId}-${build.contract.toLowerCase()}`),
          '--output', config.statsOutput || path.join(root, 'web/site/stats.json')];
    const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 90000,
      maxBuffer: 4 * 1024 * 1024, env: process.env });
    const now = Math.floor(Date.now() / 1000);
    const record = { schemaVersion: 1, job, checkedAt: now,
      chainId: build.chainId, contract: build.contract,
      status: !result.error && result.status === 0 ? 'passed' : 'failed', exit: result.status, automaticSigning: false };
    if (job === 'health') {
      let health;
      try { health = JSON.parse(result.stdout); } catch { /* Failures still generate a minimal alert. */ }
      if (!health?.checks || !['healthy', 'warning', 'critical'].includes(health.status))
        health = { checkedAt: now, status: 'critical', checks: [{ code: 'HEALTH_PROCESS_FAILED', status: 'critical' }] };
      const monitorDir = path.join(o['state-dir'], 'monitor');
      if (!fs.existsSync(monitorDir)) fs.mkdirSync(monitorDir, { mode: 0o700 });
      try { record.alert = await monitorHealth({ report: health, deployment: build, operations, stateDir: monitorDir, now }); }
      catch { record.alert = { status: 'delivery-failed', delivered: false }; record.status = 'failed'; }
      record.health = { status: health.status, codes: health.checks.filter(c => c.status !== 'passed')
        .map(c => /^[A-Z][A-Z0-9_]{0,79}$/.test(c.code) ? c.code : 'INVALID_CHECK_CODE') };
    }
    // Raw child stdout/stderr can contain private mail; never persist or echo it.
    writeOperationalLog(o.logs, job, record, operations.logs);
    console.log(JSON.stringify(record));
    if (record.status !== 'passed') process.exitCode = 2;
  });
} catch {
  console.error(JSON.stringify({ status: 'blocked', code: 'OPS_JOB_FAILED', automaticSigning: false }));
  process.exitCode = 2;
}
