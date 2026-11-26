import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { privateFile, sendTelegram } from '../../scripts/telegram-alert.mjs';

const stateRoot = '/var/lib/parley-monitor/telegram';
const monitorFile = '/var/lib/parley-monitor/latest.json';
const repeatAlertAfterSeconds = 5 * 60 * 60;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function stagingHealth(report, now) {
  const issues = [];
  const add = (code, severity = 'critical') => issues.push({ code, severity });
  const timestamp = Date.parse(report?.checkedAt) / 1000;
  if (!Number.isSafeInteger(timestamp) || timestamp > now || now - timestamp > 420) add('MONITOR_REPORT_STALE');
  if (report?.schemaVersion !== 1 || !['passed', 'failed'].includes(report.status)
    || report.walletAccess !== false || report.mainnetBroadcast !== false || report.productionRelease !== false)
    add('MONITOR_REPORT_INVALID');
  if (report?.hosting?.status !== 'passed') add('STAGING_HTTP_FAILED');
  if (report?.rpc?.status !== 'passed') add('STAGING_RPC_FAILED');
  if (report?.status === 'failed' && !issues.length) add('MONITOR_REPORT_INCONSISTENT');
  return { schemaVersion: 1, service: 'parley', scope: 'staging-monitor', chainId: 56, contract: null,
    checkedAt: now, status: issues.length ? 'critical' : 'healthy', checks: issues };
}

export async function watchTelegram({ directory = stateRoot, reportFile = monitorFile,
  now = Math.floor(Date.now() / 1000), deliver = sendTelegram } = {}) {
  const s = fs.lstatSync(directory);
  assert.ok(s.isDirectory() && !s.isSymbolicLink() && s.uid === process.getuid() && (s.mode & 0o077) === 0);
  const lock = path.join(directory, 'watch.lock');
  const fd = fs.openSync(lock, 'wx', 0o600);
  try {
    let report = null;
    try { report = JSON.parse(privateFile(reportFile, 65536)); } catch { /* Missing report is an alert, never healthy. */ }
    const payload = stagingHealth(report, now);
    const configFile = path.join(directory, 'telegram.json');
    const configBytes = privateFile(configFile, 4096);
    const signature = digest({ status: payload.status, checks: payload.checks, config: digest(configBytes.toString('utf8')) });
    const stateFile = path.join(directory, 'delivery-state.json');
    let previous = null;
    if (fs.existsSync(stateFile)) {
      previous = JSON.parse(privateFile(stateFile, 4096));
      assert.ok(previous.schemaVersion === 1 && ['healthy', 'critical'].includes(previous.status)
        && Number.isSafeInteger(previous.deliveredAt) && previous.deliveredAt <= now
        && /^[a-f0-9]{64}$/.test(previous.signature), 'Invalid delivery state');
    }
    if (payload.status === 'healthy' && (!previous || previous.status === 'healthy'))
      return { status: 'healthy-no-alert', delivered: false };
    if (previous?.signature === signature && now - previous.deliveredAt < repeatAlertAfterSeconds)
      return { status: 'cooldown', delivered: false };
    const result = await deliver(configFile, payload);
    assert.equal(result?.delivered, true, 'Telegram API acknowledgment required');
    const pending = path.join(directory, 'delivery-state.pending');
    fs.writeFileSync(pending, JSON.stringify({ schemaVersion: 1, status: payload.status,
      signature, deliveredAt: now }) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(pending, stateFile);
    return { status: payload.status === 'healthy' ? 'recovery-api-acknowledged' : 'alert-api-acknowledged',
      delivered: true, humanReceiptVerified: false };
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.deepEqual(process.argv.slice(2), ['--approved-operational-alerts']);
    assert.equal(process.platform, 'linux');
    assert.ok(process.getuid() !== 0);
    console.log(JSON.stringify(await watchTelegram()));
  } catch {
    console.error('PARLEY_TELEGRAM_WATCH_FAILED');
    process.exitCode = 2;
  }
}
