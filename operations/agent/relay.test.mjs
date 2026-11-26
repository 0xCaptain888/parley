import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, symlink, link, rm, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { relay, configPatch, saveKey, loadKey, probeRelay } from './relay.mjs';

const key = 'synthetic-key-not-a-real-credential';
const nonce = '0123456789abcdef';
const marker = `PARLEY_RELAY_OK_${nonce}`;
const reply = output => ({ model: relay.model, status: 'completed', output,
  usage: { input_tokens: 10, output_tokens: 5 } });
const text = () => reply([{ type: 'message',
  content: [{ type: 'output_text', text: marker }] }]);
const call = () => reply([{ type: 'function_call', name: 'parley_echo',
  call_id: 'call_synthetic', arguments: JSON.stringify({ nonce }) }]);
const bodies = () => [{ data: [{ id: relay.model }] }, text(), call(), text()];
function mock(items, seen = []) {
  return async (url, options) => {
    seen.push({ url, options });
    const value = items.shift();
    if (value instanceof Error) throw value;
    assert.notEqual(value, undefined, 'Unexpected extra request');
    return value instanceof Response ? value : new Response(JSON.stringify(value));
  };
}

test('configuration pins relay and exact model without a plaintext key or native auth', () => {
  const p = configPatch();
  const provider = p.models.providers['parley-relay'];
  assert.equal(provider.baseUrl, 'https://api.apikey.fan/v1');
  assert.equal(provider.api, 'openai-responses');
  assert.deepEqual(provider.apiKey, { source: 'file', provider: 'parleyrelay', id: 'value' });
  assert.equal(provider.models[0].id, 'gpt-6.1-sol');
  assert.equal(p.agents.defaults.model.primary, 'parley-relay/gpt-6.1-sol');
  assert.deepEqual(p.agents.defaults.model.fallbacks, []);
  assert.equal(p.agents.defaults.models['parley-relay/gpt-6.1-sol'].agentRuntime.id, 'openclaw');
  assert.equal(provider.request.allowPrivateNetwork, false);
  assert.equal(p.gateway, undefined);
  assert.equal(p.tools, undefined);
  assert.equal(p.channels, undefined);
  assert.equal(p.auth, undefined);
});

test('private key storage is exclusive, exact, and refuses unsafe files', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'parley-relay-')));
  const path = join(dir, 'key');
  try {
    await chmod(dir, 0o700);
    await saveKey(key, path);
    assert.equal(await loadKey(path), key);
    await assert.rejects(saveKey('another-synthetic-key', path), { code: 'EEXIST' });
    await chmod(path, 0o644);
    await assert.rejects(loadKey(path), /UNSAFE_SECRET_FILE/);
    await chmod(path, 0o600);
    await link(path, join(dir, 'hardlink'));
    await assert.rejects(loadKey(path), /UNSAFE_SECRET_FILE/);
    await symlink(path, join(dir, 'symlink'));
    await assert.rejects(loadKey(join(dir, 'symlink')));
    const alias = `${dir}-alias`;
    await symlink(dir, alias);
    try {
      await assert.rejects(saveKey(key, join(alias, 'new')), /UNSAFE_SECRET_DIRECTORY/);
    } finally { await rm(alias); }
    await chmod(dir, 0o755);
    await assert.rejects(saveKey(key, join(dir, 'new')), /UNSAFE_SECRET_DIRECTORY/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('invalid header material never reaches storage or the transport', async () => {
  for (const bad of ['', 'short', `${key}\n`, `${key}\r\nInjected: true`, 'x'.repeat(4097)]) {
    await assert.rejects(saveKey(bad, '/not-used/key'), /INVALID_KEY/);
    await assert.rejects(probeRelay({ key: bad, approved: true, fetchImpl: () => {
      assert.fail('Must not send invalid credential');
    } }), /INVALID_KEY/);
  }
});

test('no network request without explicit test authorization', async () => {
  await assert.rejects(probeRelay({ key, fetchImpl: () => assert.fail('Must not call') }),
    /RELAY_TEST_AUTHORIZATION_REQUIRED/);
});

test('three bounded Responses calls verify plain text and a harmless tool round trip', async () => {
  const seen = [];
  const report = await probeRelay({ key, approved: true, nonce, fetchImpl: mock(bodies(), seen) });
  assert.equal(seen.length, 4);
  assert.equal(report.inferenceRequests, 3);
  assert.equal(report.relayApiVerified, true);
  assert.equal(report.upstreamIdentityVerified, false);
  assert.equal(report.openclawInferenceVerified, false);
  assert.equal(report.walletOperations, false);
  assert(!JSON.stringify(report).includes(key));
  for (const [i, { url, options }] of seen.entries()) {
    assert.equal(url, `https://api.apikey.fan/v1/${i ? 'responses' : 'models'}`);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    assert(options.signal instanceof AbortSignal);
    if (i) {
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'gpt-6.1-sol');
      assert.equal(body.max_output_tokens, 512);
      assert.equal(body.store, false);
      assert.equal(body.stream, false);
      assert.equal(body.service_tier, undefined);
    }
  }
  const finalInput = JSON.parse(seen[3].options.body).input;
  assert.equal(finalInput.at(-1).type, 'function_call_output');
  assert.equal(finalInput.at(-1).output, marker);
});

test('catalog must advertise the exact requested model before inference', async () => {
  const seen = [];
  await assert.rejects(probeRelay({ key, approved: true, nonce,
    fetchImpl: mock([{ data: [{ id: 'different-model' }] }], seen) }), /EXACT_MODEL_NOT_LISTED/);
  assert.equal(seen.length, 1);
});

test('does not retry HTTP errors or reveal a reflected key', async () => {
  const seen = [];
  await assert.rejects(probeRelay({ key, approved: true, nonce,
    fetchImpl: mock([new Response(key, { status: 401 })], seen) }),
  error => error.message === 'RELAY_AUTH_REJECTED' && !error.message.includes(key));
  assert.equal(seen.length, 1);
});

test('refuses model substitution and incomplete inference', async () => {
  for (const [value, code] of [
    [{ ...text(), model: 'another-model' }, /RELAY_MODEL_MISMATCH/],
    [{ ...text(), status: 'incomplete' }, /INCOMPLETE_RESPONSE/],
    [reply([]), /TEXT_TEST_FAILED/]
  ]) {
    await assert.rejects(probeRelay({ key, approved: true, nonce,
      fetchImpl: mock([bodies()[0], value]) }), code);
  }
});

test('stops when token usage is missing or exceeds the requested output budget', async () => {
  for (const usage of [undefined, { input_tokens: 1, output_tokens: 513 },
    { input_tokens: -1, output_tokens: 1 }, { input_tokens: 1, output_tokens: 1.5 }]) {
    const seen = [];
    await assert.rejects(probeRelay({ key, approved: true, nonce,
      fetchImpl: mock([bodies()[0], { ...text(), usage }], seen) }), /INVALID_REPORTED_USAGE/);
    assert.equal(seen.length, 2);
  }
});

test('does not replay an ambiguous transport failure', async () => {
  const seen = [];
  await assert.rejects(probeRelay({ key, approved: true, nonce,
    fetchImpl: mock([bodies()[0], new Error('synthetic timeout')], seen) }), /synthetic timeout/);
  assert.equal(seen.length, 2);
});

test('never executes model-supplied tool names or altered arguments', async () => {
  for (const replacement of [
    { name: 'exec' },
    { arguments: JSON.stringify({ nonce, command: 'anything' }) },
    { arguments: JSON.stringify({ nonce: 'different' }) },
    { arguments: 'invalid-json' }
  ]) {
    const data = call();
    Object.assign(data.output[0], replacement);
    const seen = [];
    await assert.rejects(probeRelay({ key, approved: true, nonce,
      fetchImpl: mock([bodies()[0], text(), data], seen) }),
    /UNEXPECTED_TOOL_CALL|INVALID_TOOL_ARGUMENTS/);
    assert.equal(seen.length, 3);
  }
});

test('oversized JSON and unexpected tool continuation fail closed', async () => {
  await assert.rejects(probeRelay({ key, approved: true, nonce,
    fetchImpl: mock([new Response('x'.repeat(1024 * 1024 + 1))]) }), /RESPONSE_TOO_LARGE/);
  await assert.rejects(probeRelay({ key, approved: true, nonce,
    fetchImpl: mock([bodies()[0], text(), call(), call()]) }), /TOOL_ROUNDTRIP_FAILED/);
});

test('an oversized relay output cannot inflate the next paid request', async () => {
  const value = call();
  value.output.unshift({ type: 'reasoning', encrypted_content: 'x'.repeat(9000) });
  const seen = [];
  await assert.rejects(probeRelay({ key, approved: true, nonce,
    fetchImpl: mock([bodies()[0], text(), value], seen) }), /REQUEST_TOO_LARGE/);
  assert.equal(seen.length, 3);
});

test('the key entry helper requires an interactive dedicated account and does not export the key', async () => {
  const script = await readFile(new URL('./enter-relay-key.sh', import.meta.url), 'utf8');
  assert(script.includes('read -r -s'));
  assert(script.includes('test -t 0'));
  assert(script.includes('test "$(id -un)" = parley-agent'));
  assert(!script.includes('export key'));
  assert(!script.includes('set -x'));
});
