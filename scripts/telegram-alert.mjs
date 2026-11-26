import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const tokenPattern = /^[1-9]\d{4,19}:[A-Za-z0-9_-]{30,100}$/;
const chatPattern = /^-?[1-9]\d{0,19}$/;
const exact = (value, keys) => assert.deepEqual(Object.keys(value || {}).sort(), keys.sort());

export function privateFile(file, maxBytes) {
  assert.ok(path.isAbsolute(file), 'Absolute private file required');
  for (let p = file; p !== path.dirname(p); p = path.dirname(p))
    assert.ok(!fs.lstatSync(p).isSymbolicLink(), 'Private file symlink refused');
  const parent = fs.statSync(path.dirname(file));
  assert.ok(parent.isDirectory() && (parent.mode & 0o077) === 0
    && parent.uid === process.getuid(), 'Private owned parent required');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile() && stat.nlink === 1 && (stat.mode & 0o077) === 0
      && stat.uid === process.getuid() && stat.size > 0 && stat.size <= maxBytes,
    'Private owned regular file required');
    const raw = fs.readFileSync(fd);
    assert.ok(raw.length <= maxBytes, 'Private file grew beyond limit');
    return raw;
  } finally { fs.closeSync(fd); }
}

export function readTelegramConfig(file) {
  const config = JSON.parse(privateFile(file, 4096));
  exact(config, ['schemaVersion', 'botTokenFile', 'chatId']);
  assert.equal(config.schemaVersion, 1);
  assert.ok(chatPattern.test(config.chatId), 'Numeric Telegram chat ID required');
  assert.ok(path.isAbsolute(config.botTokenFile)
    && path.dirname(config.botTokenFile) === path.dirname(file), 'Token must be beside private configuration');
  const token = privateFile(config.botTokenFile, 128).toString('utf8');
  assert.ok(tokenPattern.test(token), 'Invalid Telegram bot token format');
  return { token, chatId: config.chatId };
}

export function storeTelegramConfig(input, directory) {
  assert.ok(path.isAbsolute(directory) && input.length <= 256);
  const [token, chatId, ...extra] = input.toString('utf8').split('\n');
  assert.ok(extra.length === 0 && tokenPattern.test(token) && chatPattern.test(chatId),
    'Invalid private Telegram input');
  for (let p = path.dirname(directory); p !== path.dirname(p); p = path.dirname(p))
    assert.ok(!fs.lstatSync(p).isSymbolicLink(), 'Symlink storage parent refused');
  const parent = fs.statSync(path.dirname(directory));
  assert.ok(parent.uid === process.getuid() && (parent.mode & 0o077) === 0, 'Private owned parent required');
  // Exclusive directory and files preserve prior credentials, including interrupted setup.
  fs.mkdirSync(directory, { mode: 0o700 });
  const tokenFile = path.join(directory, 'bot-token');
  fs.writeFileSync(tokenFile, token, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(directory, 'telegram.json'), JSON.stringify({
    schemaVersion: 1, botTokenFile: tokenFile, chatId,
  }) + '\n', { flag: 'wx', mode: 0o600 });
  return { status: 'TELEGRAM_PRIVATE_CONFIG_STORED', networkRequests: 0 };
}

export function telegramText(payload) {
  assert.equal(payload?.schemaVersion, 1);
  assert.equal(payload.service, 'parley');
  assert.equal(payload.chainId, 56);
  const scope = payload.scope || 'business';
  assert.ok(['business', 'staging-monitor', 'delivery-test'].includes(scope));
  assert.ok(['healthy', 'warning', 'critical'].includes(payload.status));
  assert.ok(Number.isSafeInteger(payload.checkedAt) && payload.checkedAt > 0);
  if (scope === 'business')
    assert.ok(/^0x[0-9a-f]{40}$/i.test(payload.contract || '') && !/^0x0{40}$/i.test(payload.contract));
  else assert.equal(payload.contract, null);
  assert.ok(Array.isArray(payload.checks) && payload.checks.length <= 100);
  const codes = payload.checks.map(c => {
    assert.match(c.code || '', /^[A-Z][A-Z0-9_]{0,79}$/);
    assert.ok(['warning', 'critical'].includes(c.severity));
    return `${c.severity}: ${c.code}`;
  });
  const severity = payload.checks.some(c => c.severity === 'critical') ? 'critical'
    : codes.length ? 'warning' : 'healthy';
  assert.equal(payload.status, severity, 'Telegram severity mismatch');
  return [`Parley ${scope}: ${payload.status}`, `BSC 56`,
    ...(scope === 'business' ? [`Contract: ${payload.contract.toLowerCase()}`] : []),
    new Date(payload.checkedAt * 1000).toISOString(), ...codes].join('\n');
}

export async function sendTelegram(configFile, payload, { fetcher = fetch } = {}) {
  const text = telegramText(payload);
  const now = Math.floor(Date.now() / 1000);
  assert.ok(payload.checkedAt <= now && now - payload.checkedAt <= 300, 'Fresh alert required');
  const { token, chatId } = readTelegramConfig(configFile);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    // Never follow a redirect carrying the URL-path credential, or retry an uncertain send.
    const response = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', redirect: 'error', credentials: 'omit', signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, protect_content: true,
        link_preview_options: { is_disabled: true } }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /^application\/json\b/i);
    assert.ok(response.body);
    const reader = response.body.getReader(), chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        assert.ok(bytes <= 65536, 'Oversized Telegram response');
        chunks.push(Buffer.from(part.value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.ok(result.ok === true && Number.isSafeInteger(result.result?.message_id)
      && result.result.message_id > 0 && String(result.result.chat?.id) === chatId
      && result.result.text === text, 'Telegram delivery acknowledgment mismatch');
    return { status: 'telegram-api-acknowledged', delivered: true,
      messageId: result.result.message_id, humanReceiptVerified: false };
  } catch {
    // Raw transport errors can contain the bot token from the URL.
    throw new Error('TELEGRAM_DELIVERY_FAILED');
  } finally { clearTimeout(timer); }
}

export async function telegramCommand(args, stdin = process.stdin) {
  assert.equal(args.length, 3);
  const [mode, approval, input] = args;
  if (mode === 'store') {
    assert.equal(approval, '--approve-private-storage');
    const chunks = [];
    let bytes = 0;
    for await (const chunk of stdin) {
      bytes += chunk.length;
      assert.ok(bytes <= 256);
      chunks.push(chunk);
    }
    return storeTelegramConfig(Buffer.concat(chunks), input);
  }
  assert.equal(mode, 'test');
  assert.equal(approval, '--approve-one-test-message');
  return sendTelegram(input, {
    schemaVersion: 1, service: 'parley', scope: 'delivery-test', chainId: 56, contract: null,
    checkedAt: Math.floor(Date.now() / 1000), status: 'warning',
    checks: [{ code: 'ALERT_DELIVERY_TEST', severity: 'warning' }],
  });
}
