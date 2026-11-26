import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { discoverTelegramChats, discoveryCommand } from './telegram-discover.mjs';

const token = `12345:${'x'.repeat(32)}`, now = 1800000000;
const response = result => new Response(JSON.stringify({ ok: true, result }), {
  headers: { 'content-type': 'application/json' },
});
const start = (id = 123, type = 'private') => ({
  message: { date: now, text: '/start', chat: { id, type, username: 'never-display' } },
});

test('only read-only official methods; no acknowledgment, filter changes or secret output', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? response({ url: '' }) : response([start(), start()]);
  };
  const result = await discoverTelegramChats(token, { fetcher, now });
  assert.deepEqual(result, { status: 'TELEGRAM_CHAT_CANDIDATES',
    candidates: [{ chatId: '123', type: 'private' }] });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `https://api.telegram.org/bot${token}/getWebhookInfo`);
  assert.equal(calls[1].url, `https://api.telegram.org/bot${token}/getUpdates`);
  assert.deepEqual(JSON.parse(calls[1].options.body), { limit: 100, timeout: 0 });
  for (const { options } of calls) {
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.ok(!JSON.stringify(result).includes('never-display'));
  assert.ok(!JSON.stringify(result).includes(token));
});

test('existing webhook is left untouched and its URL never displayed', async () => {
  let calls = 0;
  const result = await discoverTelegramChats(token, { fetcher: async () => {
    calls++;
    return response({ url: 'https://private.example/secret' });
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result, { status: 'TELEGRAM_WEBHOOK_PRESENT_NO_CHANGES', candidates: [] });
});

test('ignore stale, future, edited, unrelated and unsafe identifiers', async () => {
  const updates = [
    { message: { ...start().message, date: now - 901 } },
    { message: { ...start().message, date: now + 1 } },
    { message: { ...start().message, text: '/starter' } },
    { edited_message: start().message }, start(Number.MAX_SAFE_INTEGER + 1),
    start(0), start(1, 'invalid'), start(-100123, 'supergroup'),
  ];
  let calls = 0;
  const result = await discoverTelegramChats(token, {
    now, fetcher: async () => response(++calls === 1 ? { url: '' } : updates),
  });
  assert.deepEqual(result.candidates, [{ chatId: '-100123', type: 'supergroup' }]);
});

test('invalid token makes no network request', async () => {
  await assert.rejects(discoverTelegramChats('invalid', {
    fetcher: () => assert.fail('network forbidden'),
  }), { message: 'TELEGRAM_DISCOVERY_FAILED_CLOSED' });
});

test('transport errors cannot leak token or URL', async () => {
  await assert.rejects(discoverTelegramChats(token, {
    fetcher: () => { throw new Error(`https://api.telegram.org/bot${token}`); },
  }), { message: 'TELEGRAM_DISCOVERY_FAILED_CLOSED' });
});

test('reject bad status, type, oversized, malformed and unsuccessful responses', async () => {
  const bad = [
    () => new Response('', { status: 401 }),
    () => new Response('{}'),
    () => new Response('x'.repeat(262145), { headers: { 'content-type': 'application/json' } }),
    () => new Response('{', { headers: { 'content-type': 'application/json' } }),
    () => response({}),
    () => new Response('{"ok":false}', { headers: { 'content-type': 'application/json' } }),
  ];
  for (const fetcher of bad)
    await assert.rejects(discoverTelegramChats(token, { fetcher }),
      { message: 'TELEGRAM_DISCOVERY_FAILED_CLOSED' });
});

test('no recent start has explicit non-success status', async () => {
  let calls = 0;
  const result = await discoverTelegramChats(token, {
    fetcher: async () => response(++calls === 1 ? { url: '' } : []),
  });
  assert.deepEqual(result, { status: 'TELEGRAM_NO_RECENT_START', candidates: [] });
});

test('CLI requires exact approval and bounded stdin; never uses a token argument', async () => {
  for (const [args, input] of [
    [[], token], [['--approve-readonly-chat-discovery', token], ''],
    [['--approve-readonly-chat-discovery'], 'x'.repeat(129)],
  ])
    await assert.rejects(discoveryCommand(args, Readable.from([input]), {
      fetcher: () => assert.fail('network forbidden'),
    }), { message: 'TELEGRAM_DISCOVERY_FAILED_CLOSED' });
  const result = await discoveryCommand(['--approve-readonly-chat-discovery'],
    Readable.from([token]), { fetcher: async () => response({ url: 'https://example.org' }) });
  assert.equal(result.status, 'TELEGRAM_WEBHOOK_PRESENT_NO_CHANGES');
});
