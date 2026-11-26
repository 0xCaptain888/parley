import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import dns from 'node:dns/promises';
import { isIP, BlockList } from 'node:net';
import { atomicJson, locked, readJson } from '../helper/src/state.mjs';
import { sha256 } from './evidence.mjs';
import { sendTelegram } from './telegram-alert.mjs';

export function safePath(target, { directory = false, privateMode = false } = {}) {
  assert.ok(path.isAbsolute(target), 'Absolute path required');
  for (let p = target; p !== path.dirname(p); p = path.dirname(p)) {
    if (fs.existsSync(p)) assert.ok(!fs.lstatSync(p).isSymbolicLink(), 'Symlink operational path refused');
  }
  const stat = fs.lstatSync(target);
  assert.ok(directory ? stat.isDirectory() : stat.isFile(), 'Unexpected operational path type');
  if (privateMode) assert.equal(stat.mode & 0o077, 0, 'Private operational path permissions required');
  return target;
}

// Only globally routable destinations; DNS answers are pinned for the subsequent HTTPS request.
export function publicIP(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b))
      || (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0));
  }
  if (isIP(ip) !== 6) return false;
  const global = new BlockList(), reserved = new BlockList();
  global.addSubnet('2000::', 3, 'ipv6');
  for (const [network, bits] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]])
    reserved.addSubnet(network, bits, 'ipv6');
  return global.check(ip, 'ipv6') && !reserved.check(ip, 'ipv6');
}

export function validateOperations(c) {
  assert.deepEqual(Object.keys(c || {}).sort(), ['schemaVersion', 'alerts', 'logs'].sort(), 'Unknown operations configuration');
  assert.equal(c.schemaVersion, 1);
  assert.deepEqual(Object.keys(c.logs || {}).sort(), ['maxBytes', 'keep'].sort());
  assert.ok(Number.isSafeInteger(c.logs.maxBytes) && c.logs.maxBytes >= 1024 && c.logs.maxBytes <= 10 * 1024 * 1024);
  assert.ok(Number.isSafeInteger(c.logs.keep) && c.logs.keep >= 1 && c.logs.keep <= 20);
  const telegram = c.alerts?.provider === 'telegram';
  assert.deepEqual(Object.keys(c.alerts || {}).sort(), (telegram
    ? ['enabled', 'provider', 'configFile', 'cooldownSeconds'] : ['enabled', 'webhook', 'cooldownSeconds']).sort());
  assert.equal(typeof c.alerts.enabled, 'boolean');
  assert.ok(Number.isSafeInteger(c.alerts.cooldownSeconds) && c.alerts.cooldownSeconds >= 60
    && c.alerts.cooldownSeconds <= 86400);
  if (telegram) {
    assert.equal(c.alerts.enabled, true, 'Disabled alerts must use the null webhook configuration');
    assert.ok(typeof c.alerts.configFile === 'string' && path.isAbsolute(c.alerts.configFile)
      && !/[\x00-\x1f]/.test(c.alerts.configFile), 'Absolute private Telegram config required');
  } else if (c.alerts.enabled) {
    const u = new URL(c.alerts.webhook);
    assert.ok(u.protocol === 'https:' && !u.username && !u.password && !u.hash && (!u.port || u.port === '443')
      && !isIP(u.hostname) && u.hostname.includes('.') && !/\.(local|localhost|invalid|test)$/.test(u.hostname),
    'Public HTTPS webhook required');
  } else assert.equal(c.alerts.webhook, null, 'Disabled webhook must be null');
  return c;
}

export async function postAlert(url, payload, resolver = dns.lookup) {
  const target = new URL(url);
  assert.ok(target.protocol === 'https:' && !target.username && !target.password
    && !target.hash && (!target.port || target.port === '443'), 'Unsafe alert URL');
  const addresses = await resolver(target.hostname, { all: true, verbatim: true });
  assert.ok(addresses.length > 0 && addresses.every(a => publicIP(a.address)), 'Private/reserved webhook address refused');
  const selected = addresses[0], body = Buffer.from(JSON.stringify(payload));
  assert.ok(body.length <= 16384, 'Alert payload too large');
  await new Promise((resolve, reject) => {
    const req = https.request(target, { method: 'POST', timeout: 10000,
      lookup: (_host, opts, callback) => opts?.all
        ? callback(null, [selected]) : callback(null, selected.address, selected.family),
      headers: { 'content-type': 'application/json', 'content-length': body.length } }, res => {
      let bytes = 0;
      res.on('data', chunk => { bytes += chunk.length; if (bytes > 65536) res.destroy(new Error('Oversized alert response')); });
      res.on('error', reject);
      res.on('end', () => res.statusCode >= 200 && res.statusCode < 300 ? resolve() : reject(new Error('Alert delivery rejected')));
    });
    req.on('timeout', () => req.destroy(new Error('Alert delivery timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

export function alertPayload(report, deployment) {
  assert.ok(['healthy', 'warning', 'critical'].includes(report.status), 'Invalid health severity');
  assert.ok(Number.isSafeInteger(report.checkedAt) && report.checkedAt > 0, 'Invalid health time');
  assert.ok(deployment.chainId === 56 && /^0x[0-9a-f]{40}$/i.test(deployment.contract || '')
    && !/^0x0{40}$/i.test(deployment.contract), 'Final alert deployment required');
  assert.ok(Array.isArray(report.checks) && report.checks.length <= 100, 'Invalid health checks');
  const failed = report.checks.filter(c => c.status !== 'passed').map(c => {
    assert.match(c.code || '', /^[A-Z][A-Z0-9_]{0,79}$/, 'Invalid health check code');
    assert.ok(['warning', 'critical'].includes(c.status), 'Invalid health check severity');
    return { code: c.code, severity: c.status };
  }).sort((a, b) => a.code.localeCompare(b.code));
  const severity = failed.some(c => c.severity === 'critical') ? 'critical' : failed.length ? 'warning' : 'healthy';
  assert.equal(report.status, severity, 'Health severity/checks mismatch');
  return { schemaVersion: 1, service: 'parley', chainId: 56, contract: deployment.contract.toLowerCase(),
    checkedAt: report.checkedAt, status: report.status, checks: failed };
}

export async function monitorHealth({ report, deployment, operations, stateDir, now = Math.floor(Date.now() / 1000),
  deliver = postAlert, deliverTelegram = sendTelegram }) {
  validateOperations(operations);
  safePath(stateDir, { directory: true, privateMode: true });
  const payload = alertPayload(report, deployment);
  assert.ok(payload.checkedAt <= now && now - payload.checkedAt <= 300, 'Stale/future health report refused');
  const signature = sha256(JSON.stringify({ contract: payload.contract, status: payload.status, checks: payload.checks,
    destination: operations.alerts.provider === 'telegram' ? operations.alerts.configFile : operations.alerts.webhook }));
  return locked(stateDir, async () => {
    const file = path.join(stateDir, 'alert-state.json'), previous = readJson(file, null);
    if (!operations.alerts.enabled) return { status: 'alerts-disabled', delivered: false };
    assert.ok(!previous || previous.contract === payload.contract, 'Alert state deployment mismatch');
    if (previous) assert.ok(Number.isSafeInteger(previous.deliveredAt) && previous.deliveredAt <= now
      && /^[0-9a-f]{64}$/.test(previous.signature || '') && ['healthy', 'warning', 'critical'].includes(previous.status),
    'Invalid saved alert state');
    if ((!previous || previous.status === 'healthy') && payload.status === 'healthy')
      return { status: 'healthy-no-alert', delivered: false };
    if (previous?.signature === signature && now - previous.deliveredAt < operations.alerts.cooldownSeconds)
      return { status: 'cooldown', delivered: false };
    if (operations.alerts.provider === 'telegram') {
      const result = await deliverTelegram(operations.alerts.configFile, payload);
      assert.equal(result?.delivered, true, 'Telegram API acknowledgment required');
    }
    else await deliver(operations.alerts.webhook, payload);
    atomicJson(file, { contract: payload.contract, signature, deliveredAt: now, status: payload.status });
    return { status: payload.status === 'healthy' ? 'recovery-delivered' : 'alert-delivered', delivered: true };
  });
}

// Called only for runner-owned files, between one-shot jobs, never on active daemon output.
export function writeOperationalLog(directory, job, value, limits) {
  safePath(directory, { directory: true, privateMode: true });
  assert.ok(['resident', 'health', 'stats'].includes(job));
  validateOperations({ schemaVersion: 1, logs: limits,
    alerts: { enabled: false, webhook: null, cooldownSeconds: 300 } });
  const line = JSON.stringify(value) + '\n';
  assert.ok(Buffer.byteLength(line) <= limits.maxBytes, 'Operational record exceeds rotation limit');
  const file = path.join(directory, `${job}.jsonl`);
  for (let i = 0; i <= limits.keep; i++) {
    const p = i ? `${file}.${i}` : file;
    if (fs.existsSync(p)) safePath(p, { privateMode: true });
  }
  if (fs.existsSync(file) && fs.statSync(file).size + Buffer.byteLength(line) > limits.maxBytes) {
    for (let i = limits.keep; i >= 1; i--) {
      const src = i === 1 ? file : `${file}.${i - 1}`, dest = `${file}.${i}`;
      if (fs.existsSync(src)) fs.renameSync(src, dest);
    }
  }
  fs.appendFileSync(file, line, { mode: 0o600 });
}
