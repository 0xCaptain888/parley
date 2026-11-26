import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { privateFile, readTelegramConfig, storeTelegramConfig, telegramText, sendTelegram } from '../../scripts/telegram-alert.mjs';
import { validateOperations, monitorHealth } from '../../scripts/operational-monitor.mjs';
import { linuxResidentServicePlan } from '../../scripts/resident-service.mjs';

const token = `123456:${'A'.repeat(35)}`, chatId = '-1001234567890';
function temporary(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'parley-production-')));
  fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const payload = () => ({ schemaVersion: 1, service: 'parley', scope: 'delivery-test', chainId: 56,
  contract: null, checkedAt: Math.floor(Date.now() / 1000), status: 'warning',
  checks: [{ code: 'ALERT_DELIVERY_TEST', severity: 'warning' }], privateMessage: 'MUST_NOT_APPEAR' });
function privateConfig(t) {
  const dir = temporary(t), target = path.join(dir, 'telegram');
  const result = storeTelegramConfig(Buffer.from(`${token}\n${chatId}`), target);
  assert.equal(result.networkRequests, 0);
  return { dir, target, file: path.join(target, 'telegram.json') };
}
test('Telegram credentials are separate private exclusive files, never output or sent on storage', t => {
  const { target, file } = privateConfig(t);
  assert.deepEqual(readTelegramConfig(file), { token, chatId });
  assert.equal(fs.statSync(target).mode & 0o777, 0o700);
  for (const entry of fs.readdirSync(target)) assert.equal(fs.statSync(path.join(target, entry)).mode & 0o777, 0o600);
  assert.ok(!fs.readFileSync(file, 'utf8').includes(token));
  assert.throws(() => storeTelegramConfig(Buffer.from(`${token}\n${chatId}`), target));
});
test('Telegram storage rejects malformed input and unsafe parent permissions', t => {
  const dir = temporary(t);
  for (const input of [`${token}\n@channel`, `${token}\n${chatId}\nextra`, `not-a-token\n${chatId}`])
    assert.throws(() => storeTelegramConfig(Buffer.from(input), path.join(dir, 'telegram')));
  fs.chmodSync(dir, 0o755);
  assert.throws(() => storeTelegramConfig(Buffer.from(`${token}\n${chatId}`), path.join(dir, 'telegram')));
});
test('private reader rejects permissive, linked, symlinked, oversized and foreign token files', t => {
  const { target, file } = privateConfig(t), secret = path.join(target, 'bot-token');
  fs.chmodSync(secret, 0o644); assert.throws(() => readTelegramConfig(file)); fs.chmodSync(secret, 0o600);
  const hard = path.join(target, 'hard'); fs.linkSync(secret, hard);
  assert.throws(() => readTelegramConfig(file)); fs.unlinkSync(hard);
  const link = path.join(target, 'link'); fs.symlinkSync(secret, link);
  assert.throws(() => privateFile(link, 128));
  assert.throws(() => privateFile(secret, 1));
  const data = JSON.parse(fs.readFileSync(file)); data.botTokenFile = '/tmp/foreign-token';
  fs.writeFileSync(file, JSON.stringify(data));
  assert.throws(() => readTelegramConfig(file), /beside/);
});
test('Telegram messages contain only approved codes, deployment and time, with no injected text', () => {
  const p = payload(), text = telegramText(p);
  assert.ok(!text.includes('MUST_NOT_APPEAR'));
  assert.ok(!text.includes(token));
  assert.throws(() => telegramText({ ...p, status: 'healthy' }));
  assert.throws(() => telegramText({ ...p, scope: 'business' }));
  assert.throws(() => telegramText({ ...p, checks: [{ code: 'Send PRIVATE text', severity: 'warning' }] }));
});
test('Telegram sends one protected message to the fixed TLS host and verifies the API acknowledgment', async t => {
  const { file } = privateConfig(t);
  let requests = 0;
  const result = await sendTelegram(file, payload(), { fetcher: async (url, options) => {
    requests++;
    assert.equal(url, `https://api.telegram.org/bot${token}/sendMessage`);
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.equal(body.chat_id, chatId); assert.equal(body.protect_content, true);
    assert.ok(!options.body.includes('MUST_NOT_APPEAR'));
    return Response.json({ ok: true, result: { message_id: 1, chat: { id: Number(chatId) }, text: body.text } });
  } });
  assert.equal(requests, 1); assert.equal(result.delivered, true);
  assert.equal(result.humanReceiptVerified, false);
  assert.ok(!JSON.stringify(result).includes(token));
});
test('Telegram refuses failure, wrong chat, wrong text, oversized response and token-bearing transport errors without retry', async t => {
  const { file } = privateConfig(t);
  for (const response of [
    () => Response.json({ ok: false }),
    () => Response.json({}, { status: 302 }),
    () => Response.json({ ok: true, result: { message_id: 1, chat: { id: 5 }, text: telegramText(payload()) } }),
    () => Response.json({ ok: true, result: { message_id: 1, chat: { id: Number(chatId) }, text: 'wrong' } }),
    () => new Response('x'.repeat(65537), { headers: { 'content-type': 'application/json' } }),
    () => { throw Error(`transport: ${token}`); },
  ]) {
    let calls = 0;
    await assert.rejects(sendTelegram(file, payload(), { fetcher: async () => { calls++; return response(); } }),
      error => error.message === 'TELEGRAM_DELIVERY_FAILED');
    assert.equal(calls, 1);
  }
  await assert.rejects(sendTelegram(file, { ...payload(), checkedAt: 1 }, {
    fetcher: () => assert.fail('Stale alert must not send'),
  }));
});
test('Telegram health routing preserves cooldown and failure semantics without storing private config content', async t => {
  const stateDir = temporary(t), now = Math.floor(Date.now() / 1000), contract = `0x${'2'.repeat(40)}`;
  const operations = { schemaVersion: 1, logs: { maxBytes: 1024, keep: 2 }, alerts: {
    enabled: true, provider: 'telegram', configFile: '/private/operator/telegram.json', cooldownSeconds: 300,
  } };
  assert.equal(validateOperations(operations), operations);
  assert.throws(() => validateOperations({ ...operations, alerts: { ...operations.alerts, botToken: token } }));
  const report = { checkedAt: now, status: 'critical', privateText: 'MUST_NOT_APPEAR',
    checks: [{ code: 'TICK_FRESH', status: 'critical' }] };
  let calls = 0;
  const invoke = extra => monitorHealth({ report, deployment: { chainId: 56, contract }, operations, stateDir, now,
    deliver: () => assert.fail('Not a webhook'),
    deliverTelegram: async (file, body) => {
      calls++; assert.equal(file, operations.alerts.configFile);
      assert.ok(!JSON.stringify(body).includes('MUST_NOT_APPEAR'));
      return { delivered: true };
    }, ...extra });
  assert.equal((await invoke()).delivered, true);
  assert.equal((await invoke()).status, 'cooldown');
  operations.alerts.configFile = '/private/new-destination/telegram.json';
  assert.equal((await invoke()).delivered, true);
  assert.equal(calls, 2);
  const before = fs.readFileSync(path.join(stateDir, 'alert-state.json'));
  operations.alerts.configFile = '/private/failed/telegram.json';
  await assert.rejects(invoke({ deliverTelegram: async () => { throw Error('fail'); } }));
  assert.deepEqual(fs.readFileSync(path.join(stateDir, 'alert-state.json')), before);
  assert.ok(!before.toString().includes('telegram.json'));
});

test('business Telegram health never records delivery or cooldown without API acknowledgment', async t => {
  const stateDir = temporary(t), now = Math.floor(Date.now() / 1000), contract = `0x${'2'.repeat(40)}`;
  const operations = { schemaVersion: 1, logs: { maxBytes: 1024, keep: 2 }, alerts: {
    enabled: true, provider: 'telegram', configFile: '/private/operator/telegram.json', cooldownSeconds: 18000,
  } };
  const report = { checkedAt: now, status: 'critical', checks: [{ code: 'TICK_FRESH', status: 'critical' }] };
  const invoke = deliverTelegram => monitorHealth({
    report, deployment: { chainId: 56, contract }, operations, stateDir, now, deliverTelegram,
  });
  for (const result of [undefined, null, {}, { delivered: false }, { delivered: 1 }]) {
    await assert.rejects(invoke(async () => result), /acknowledgment/);
    assert.equal(fs.existsSync(path.join(stateDir, 'alert-state.json')), false);
  }
  assert.equal((await invoke(async () => ({ delivered: true }))).delivered, true);
  const before = fs.readFileSync(path.join(stateDir, 'alert-state.json'));
  operations.alerts.configFile = '/private/changed-destination/telegram.json';
  await assert.rejects(invoke(async () => ({ delivered: false })), /acknowledgment/);
  assert.deepEqual(fs.readFileSync(path.join(stateDir, 'alert-state.json')), before);
});

const address = c => `0x${c.repeat(40)}`;
function linuxInput() {
  const from = address('3'), contract = address('2');
  return {
    root: '/opt/parley-business', node: '/opt/parley-runtime/bin/node',
    configPath: '/var/lib/parley-business/config.json', buildPath: '/opt/parley-business/config/build.json',
    logs: '/var/lib/parley-business/logs', stateDir: `/var/lib/parley-business/resident/56-22222222/${from}`,
    binding: { chainId: 56, contract, from },
    build: { chainId: 56, contract, deploymentBlock: 100, resident: 'btc123456',
      excluded: [from], site: 'https://parley-staging.pages.dev' },
    config: { from, mode: 'manual', home: '/var/lib/parley-business/helper', authorization: null,
      stateRoot: '/var/lib/parley-business/resident', statsState: '/var/lib/parley-business/stats',
      statsOutput: '/var/lib/parley-business/stats.json', logRpc: 'https://bsc-rpc.publicnode.com',
      dailyBNB: '0.01', perTxBNB: '0.001', perTxUSD: '1', giftEach: '0.0001',
      publicPacket: { total: '0.0002', shares: 2 }, welcome: 'hello',
      pricesUpdatedAt: 1795665000, pricesUSD: { BNB: '600', USDT: '1', USDC: '1' } },
    now: 1795665001,
  };
}
test('Linux plan creates immutable-code, external-state, non-overlapping timers without wallet or model execution', () => {
  const r = linuxResidentServicePlan(linuxInput()), units = Object.values(r.units).join('\n');
  assert.equal(Object.keys(r.units).length, 6);
  assert.match(units, /OnUnitInactiveSec=60s/);
  assert.match(units, /User=parley-agent/);
  assert.match(units, /ProtectSystem=strict/);
  assert.match(units, /ReadWritePaths=\/var\/lib\/parley-business/);
  assert.match(units, /InaccessiblePaths=\/var\/lib\/parley-agent \/run\/user/);
  assert.match(units, /Environment=HOME=\/var\/lib\/parley-business\/helper/);
  assert.ok(!units.includes('Environment=HOME=/var/lib/parley-agent'));
  assert.ok(!/--approve|--preview|baw|openclaw\.mjs|\/bin\/sh|relay-api-key/.test(units));
  assert.equal(r.serviceInstalled, false); assert.equal(r.automaticSigning, false);
  assert.equal(r.modelRequests, 0);
});
test('Linux plan fails closed for missing final contract, automatic authority, code-tree state or invalid systemd paths', () => {
  for (const mutate of [
    i => i.build.contract = null, i => i.build.deploymentBlock = null,
    i => i.config.mode = 'auto', i => i.config.authorization = 'blanket',
    i => i.config.statsOutput = '/opt/parley-business/web/site/stats.json',
    i => i.config.stateRoot = '/opt/parley-business/resident/state',
    i => i.configPath += '%n', i => i.logs += '\nExecStart=/bin/sh',
    i => i.binding.from = address('9'), i => i.config.pricesUpdatedAt -= 86400,
  ]) {
    const i = linuxInput(); mutate(i);
    assert.throws(() => linuxResidentServicePlan(i));
  }
});
