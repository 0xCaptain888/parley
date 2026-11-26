import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stagingHealth, watchTelegram } from './telegram-watch.mjs';
const now = Math.floor(Date.now() / 1000);
const good = () => ({ schemaVersion: 1, checkedAt: new Date(now * 1000).toISOString(), status: 'passed',
  hosting: { status: 'passed' }, rpc: { status: 'passed' },
  walletAccess: false, mainnetBroadcast: false, productionRelease: false, private: 'MUST_NOT_APPEAR' });

test('staging health never transmits raw reports, secrets or private endpoint errors', () => {
  const payload = stagingHealth(good(), now);
  assert.equal(payload.status, 'healthy');
  assert.ok(!JSON.stringify(payload).includes('MUST_NOT_APPEAR'));
  for (const mutate of [
    r => r.checkedAt = 'invalid', r => r.checkedAt = new Date((now - 421) * 1000).toISOString(),
    r => r.checkedAt = new Date((now + 1) * 1000).toISOString(), r => r.schemaVersion = 0,
    r => r.walletAccess = true, r => r.status = 'failed', r => r.rpc.status = 'failed',
  ]) {
    const r = good(); mutate(r);
    assert.equal(stagingHealth(r, now).status, 'critical');
  }
  assert.equal(stagingHealth(null, now).status, 'critical');
});
test('watcher sends a failure, deduplicates, sends recovery, and never changes the source monitor report', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'parley-telegram-watch-')));
  fs.chmodSync(root, 0o700); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'telegram'); fs.mkdirSync(directory, { mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'telegram.json'), '{}', { mode: 0o600 });
  const reportFile = path.join(root, 'latest.json');
  let calls = 0;
  const invoke = extra => watchTelegram({ directory, reportFile, now,
    deliver: async (_file, payload) => {
      calls++; assert.equal(payload.scope, 'staging-monitor'); return { delivered: true };
    }, ...extra });
  assert.equal((await invoke()).delivered, true);
  assert.equal((await invoke()).status, 'cooldown');
  fs.writeFileSync(reportFile, JSON.stringify(good()), { mode: 0o600 });
  const before = fs.readFileSync(reportFile);
  assert.equal((await invoke()).status, 'recovery-api-acknowledged');
  assert.equal((await invoke()).status, 'healthy-no-alert');
  assert.equal(calls, 2); assert.deepEqual(fs.readFileSync(reportFile), before);
  const state = fs.readFileSync(path.join(directory, 'delivery-state.json'));
  fs.writeFileSync(reportFile, '{}');
  await assert.rejects(invoke({ deliver: async () => { throw Error('private token'); } }));
  assert.deepEqual(fs.readFileSync(path.join(directory, 'delivery-state.json')), state);
  assert.equal(fs.existsSync(path.join(directory, 'watch.lock')), false);
});
test('watcher refuses overlapping runs, linked state and fabricated delivery acknowledgment', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'parley-telegram-refusal-')));
  fs.chmodSync(root, 0o700); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'telegram.json'), '{}', { mode: 0o600 });
  const input = { directory: root, reportFile: path.join(root, 'missing'), now,
    deliver: async () => ({ delivered: false }) };
  await assert.rejects(watchTelegram(input));
  assert.equal(fs.existsSync(path.join(root, 'delivery-state.json')), false);
  fs.writeFileSync(path.join(root, 'watch.lock'), '');
  await assert.rejects(watchTelegram(input));
});

test('same ongoing failure is suppressed for five hours, including across hourly checks', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'parley-telegram-cooldown-')));
  fs.chmodSync(root, 0o700); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'telegram.json'), '{}', { mode: 0o600 });
  let calls = 0;
  const invoke = seconds => watchTelegram({
    directory: root, reportFile: path.join(root, 'missing'), now: now + seconds,
    deliver: async () => { calls++; return { delivered: true }; },
  });
  assert.equal((await invoke(0)).status, 'alert-api-acknowledged');
  for (const seconds of [3600, 7200, 10800, 14400, 17999])
    assert.equal((await invoke(seconds)).status, 'cooldown');
  assert.equal(calls, 1);
  assert.equal((await invoke(18000)).status, 'alert-api-acknowledged');
  assert.equal((await invoke(21600)).status, 'cooldown');
  assert.equal(calls, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'delivery-state.json'))).deliveredAt, now + 18000);
});

test('healthy checks stay silent and recovery is not held for the five-hour cooldown', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'parley-telegram-recovery-')));
  fs.chmodSync(root, 0o700); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'telegram.json'), '{}', { mode: 0o600 });
  const reportFile = path.join(root, 'latest.json');
  let calls = 0;
  const invoke = seconds => watchTelegram({ directory: root, reportFile, now: now + seconds,
    deliver: async () => { calls++; return { delivered: true }; } });
  const report = seconds => fs.writeFileSync(reportFile, JSON.stringify({
    ...good(), checkedAt: new Date((now + seconds) * 1000).toISOString(),
  }), { mode: 0o600 });
  report(0);
  assert.equal((await invoke(0)).status, 'healthy-no-alert');
  fs.writeFileSync(reportFile, '{}');
  assert.equal((await invoke(3600)).status, 'alert-api-acknowledged');
  report(7200);
  assert.equal((await invoke(7200)).status, 'recovery-api-acknowledged');
  assert.equal((await invoke(7200)).status, 'healthy-no-alert');
  fs.writeFileSync(reportFile, '{}');
  assert.equal((await invoke(10800)).status, 'alert-api-acknowledged');
  assert.equal(calls, 3);
});

test('a changed failure signature is reported at the next check without waiting five hours', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'parley-telegram-new-issue-')));
  fs.chmodSync(root, 0o700); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'telegram.json'), '{}', { mode: 0o600 });
  const reportFile = path.join(root, 'latest.json');
  let calls = 0;
  const invoke = seconds => watchTelegram({ directory: root, reportFile, now: now + seconds,
    deliver: async () => { calls++; return { delivered: true }; } });
  assert.equal((await invoke(0)).status, 'alert-api-acknowledged');
  fs.writeFileSync(reportFile, JSON.stringify({
    ...good(), checkedAt: new Date((now + 3600) * 1000).toISOString(),
    status: 'failed', rpc: { status: 'failed' },
  }), { mode: 0o600 });
  assert.equal((await invoke(3600)).status, 'alert-api-acknowledged');
  assert.equal(calls, 2);
});

test('installed timer template schedules hourly alert checks without enabling catch-up runs', () => {
  const timer = fs.readFileSync(new URL('./parley-telegram.timer', import.meta.url), 'utf8');
  assert.match(timer, /^OnActiveSec=1h$/m);
  assert.match(timer, /^OnUnitInactiveSec=1h$/m);
  assert.match(timer, /^RandomizedDelaySec=5s$/m);
  assert.match(timer, /^Persistent=false$/m);
  assert.doesNotMatch(timer, /^On(?:Active|UnitInactive)Sec=60s$/m);
});
