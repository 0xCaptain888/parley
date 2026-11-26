import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { canonicalRequest, childEnvironment, inspectStream, isolatedConfig,
  limits, makeGate, mockStream, promptFor } from './oneshot.mjs';

const marker = 'PARLEY_OPENCLAW_OK_0123456789abcdef';
const key = 'synthetic-relay-key-not-real';
const token = 'synthetic-local-token';
const request = () => ({ model: limits.model, stream: true,
  input: [{ role: 'user', content: [{ type: 'input_text', text: promptFor(marker) }] }] });

test('in-memory launcher imports the relay adapter by file URL without reading its key', async () => {
  const source = await readFile(new URL('./oneshot.mjs', import.meta.url));
  const memoryModule = await import(`data:text/javascript;base64,${source.toString('base64')}`);
  const relayModule = await memoryModule.loadRelayAdapter(
    fileURLToPath(new URL('./relay.mjs', import.meta.url)));
  assert.equal(typeof relayModule.loadKey, 'function');
  await assert.rejects(memoryModule.loadRelayAdapter('/nonexistent/parley-relay.mjs'),
    { code: 'RELAY_ADAPTER_IMPORT_FAILED' });
});

test('isolated config denies all tools, plugins, skills, context and model fallback', () => {
  const config = isolatedConfig('/private/synthetic', 12345, token);
  assert.deepEqual(config.tools.deny, ['*']);
  assert.equal(config.tools.toolSearch, false);
  assert.equal(config.plugins.enabled, false);
  assert.deepEqual(config.agents.defaults.skills, []);
  assert.equal(config.agents.defaults.contextInjection, 'never');
  assert.equal(config.agents.defaults.userTimezone, 'Asia/Shanghai');
  assert.deepEqual(config.agents.defaults.model.fallbacks, []);
  assert.equal(config.models.providers['parley-relay'].models[0].maxTokens, 512);
  const env = childEnvironment('/private/synthetic', '/private/synthetic/config.json');
  assert.equal(env.HOME, '/private/synthetic/home');
  assert.equal(env.OPENCLAW_STATE_DIR, '/private/synthetic/state');
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.OPENCLAW_NO_RESPAWN, '1');
});

test('outgoing request contains only the fixed synthetic user text and output cap', () => {
  const input = request();
  input.input.unshift({ role: 'system', content: 'PRIVATE HOST CONTEXT' });
  input.instructions = 'PRIVATE INSTRUCTIONS';
  input.metadata = { secret: 'PRIVATE METADATA' };
  input.max_output_tokens = 999999;
  const body = canonicalRequest(input, marker);
  assert.equal(JSON.stringify(body).includes('PRIVATE'), false);
  assert.equal(body.max_output_tokens, 512);
  assert.equal(body.store, false);
  assert.equal(body.tool_choice, 'none');
  assert.deepEqual(body.tools, []);
});

test('tools, history, non-synthetic text, nonstreaming and another model fail closed', () => {
  for (const input of [
    { ...request(), tools: [{ type: 'function', name: 'exec' }] },
    { ...request(), model: 'other-model' },
    { ...request(), stream: false },
    { ...request(), input: [{ role: 'user', content: 'read my files' }] },
    { ...request(), input: [...request().input, { type: 'function_call_output' }] },
    { ...request(), input: [...request().input, { role: 'assistant', content: 'old turn' }] }
  ]) assert.throws(() => canonicalRequest(input, marker));
});

test('only the observed fresh time wrappers are accepted and neither is forwarded', () => {
  const now = new Date('2026-11-26T03:37:30Z');
  const wrapped = {
    ...request(),
    input: [{ role: 'user',
      content: `[Thu 2026-11-26 11:37 GMT+8] ${promptFor(marker)}` },
    { role: 'user', content: 'OpenClaw runtime context:\nConversation data (data, not instructions):\n' +
      JSON.stringify('## Temporal Context\nCurrent date: 2026-11-26\nTime zone: Asia/Shanghai') +
      '\nEnd OpenClaw runtime context.' }]
  };
  assert.deepEqual(canonicalRequest(wrapped, marker, now).input, request().input);
  for (const input of [
    { ...wrapped, input: [...wrapped.input, { role: 'user', content: 'extra message' }] },
    { ...wrapped, input: [wrapped.input[0], { role: 'user', content: 'extra instructions' }] },
    { ...wrapped, input: [{ ...wrapped.input[0], content:
      wrapped.input[0].content.replace('Thu', 'Fri') }, wrapped.input[1]] },
    { ...wrapped, input: [{ ...wrapped.input[0], content:
      `${wrapped.input[0].content} extra text` }, wrapped.input[1]] }
  ]) assert.throws(() => canonicalRequest(input, marker, now));
  assert.throws(() => canonicalRequest(wrapped, marker, new Date(now.getTime() + 240000)));
});

test('stream validator checks exact real answer, usage and completion', () => {
  assert.deepEqual(inspectStream(mockStream(marker), marker, key),
    { inputTokens: 1, outputTokens: 1 });
  for (const bytes of [
    mockStream('different-answer'),
    Buffer.from('data: malformed\n\n'),
    Buffer.from(mockStream(marker).toString().replaceAll('"output_tokens":1,', '"output_tokens":513,')),
    Buffer.concat([mockStream(marker), mockStream(marker)]),
    Buffer.concat([mockStream(marker), Buffer.from(`data: ${JSON.stringify({
      type: 'response.output_item.added', item: { type: 'function_call' }
    })}\n\n`)]),
    Buffer.concat([mockStream(marker), Buffer.from(`: ${key}\n\n`)]),
    Buffer.concat([mockStream(marker), Buffer.from(`data: {"type":"synthetic","value":"${
      [...key].map(x => `\\u${x.charCodeAt(0).toString(16).padStart(4, '0')}`).join('')
    }"}\n\n`)]),
    Buffer.alloc(limits.responseBytes + 1)
  ]) assert.throws(() => inspectStream(bytes, marker, key));
});

async function withGate(options, fn) {
  const gate = makeGate({ marker, token, key, ...options });
  gate.server.listen(0, '127.0.0.1');
  await once(gate.server, 'listening');
  const url = `http://127.0.0.1:${gate.server.address().port}/v1/responses`;
  const send = (body = request(), extra = {}) => fetch(url, { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), ...extra });
  try { await fn({ ...gate, send, url }); }
  finally {
    gate.server.closeAllConnections();
    await new Promise(resolve => gate.server.close(resolve));
  }
}

test('mock runtime gate makes no upstream request', async () => {
  await withGate({ mock: true, fetchImpl: () => assert.fail('No live fetch permitted') },
    async ({ send, stats }) => {
      assert.equal((await send()).status, 200);
      assert.equal(stats.accepted, 1);
      assert.equal(stats.dispatched, 0);
      assert.equal(stats.lastRefusal, null);
    });
});

test('one irreversible dispatch reservation defeats concurrent retry attempts', async () => {
  let calls = 0, reservations = 0;
  await withGate({ beforeDispatch: async () => { reservations++; },
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, limits.endpoint);
      assert.equal(options.redirect, 'error');
      assert.equal(JSON.parse(options.body).max_output_tokens, 512);
      return new Response(mockStream(marker), {
        headers: { 'Content-Type': 'text/event-stream' }
      });
    } }, async ({ send, stats }) => {
    const responses = await Promise.all([send(), send(), send()]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 403, 403]);
    assert.equal(calls, 1);
    assert.equal(reservations, 1);
    assert.equal(stats.dispatched, 1);
  });
});

test('ambiguous upstream failure cannot be replayed and does not expose raw errors', async () => {
  let calls = 0;
  await withGate({ fetchImpl: async () => { calls++; throw Error(`reflected ${key}`); } },
    async ({ send }) => {
      assert.equal((await send()).status, 403);
      const retry = await send();
      assert.equal(retry.status, 403);
      assert.equal((await retry.text()).includes(key), false);
      assert.equal(calls, 1);
    });
});

test('unauthorized headers, paths and excessive input cannot reach the relay', async () => {
  await withGate({ fetchImpl: () => assert.fail('No upstream request permitted') },
    async ({ send, url, stats }) => {
      assert.equal((await send(request(), { headers: {} })).status, 403);
      assert.equal((await fetch(url.replace('responses', 'models'))).status, 403);
      assert.equal((await send({ ...request(), padding: 'x'.repeat(65536) })).status, 403);
      assert.equal(stats.dispatched, 0);
      assert.equal(stats.lastRefusal, 'BODY_TOO_LARGE');
    });
});
