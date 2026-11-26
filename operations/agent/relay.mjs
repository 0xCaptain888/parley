import { constants } from 'node:fs';
import { open, lstat, realpath, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';

export const relay = Object.freeze({
  origin: 'https://api.apikey.fan',
  model: 'gpt-6.1-sol',
  provider: 'parley-relay',
  state: '/var/lib/parley-agent/.openclaw',
  maxOutputTokens: 512,
  maxInferenceRequests: 3
});
export const keyPath = `${relay.state}/relay-api-key`;
const modelRef = `${relay.provider}/${relay.model}`;
const maxBodyBytes = 1024 * 1024;
class Refusal extends Error {
  constructor(code) { super(code); this.code = code; }
}
function requireThat(condition, code) {
  if (!condition) throw new Refusal(code);
}
function validKey(key) {
  requireThat(typeof key === 'string' && /^[\x21-\x7e]{8,4096}$/.test(key), 'INVALID_KEY');
}

export function configPatch() {
  return {
    secrets: { providers: { parleyrelay: {
      source: 'file', path: keyPath, mode: 'singleValue', maxBytes: 4096
    } } },
    models: { providers: { [relay.provider]: {
      baseUrl: `${relay.origin}/v1`,
      api: 'openai-responses',
      apiKey: { source: 'file', provider: 'parleyrelay', id: 'value' },
      request: { allowPrivateNetwork: false },
      models: [{ id: relay.model, name: relay.model, input: ['text'],
        maxTokens: relay.maxOutputTokens }]
    } } },
    agents: { defaults: {
      model: { primary: modelRef, fallbacks: [] },
      models: { [modelRef]: {
        agentRuntime: { id: 'openclaw' },
        params: { transport: 'sse', responsesServerCompaction: false,
          responsesCompactEndpoint: false }
      } }
    } }
  };
}

export async function saveKey(key, path = keyPath) {
  validKey(key);
  const parent = await lstat(dirname(path));
  requireThat(parent.isDirectory() && parent.uid === process.getuid() &&
    (parent.mode & 0o777) === 0o700 &&
    await realpath(dirname(path)) === dirname(path), 'UNSAFE_SECRET_DIRECTORY');
  // Exclusive creation refuses rotation/overwrite; the operator must review it.
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT |
    constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(key); await file.sync(); } finally { await file.close(); }
}

export async function loadKey(path = keyPath) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await file.stat();
    requireThat(s.isFile() && s.nlink === 1 && s.uid === process.getuid() &&
      (s.mode & 0o777) === 0o600 && s.size <= 4096, 'UNSAFE_SECRET_FILE');
    const key = await file.readFile('utf8');
    validKey(key);
    return key;
  } finally { await file.close(); }
}

async function readJson(response) {
  requireThat(response.body, 'EMPTY_RESPONSE');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      requireThat(size <= maxBodyBytes, 'RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Refusal('INVALID_RESPONSE_JSON'); }
}

function textOf(data) {
  return (data.output || []).filter(x => x.type === 'message')
    .flatMap(x => x.content || []).filter(x => x.type === 'output_text')
    .map(x => x.text).join('');
}

export async function probeRelay({ key, approved = false, fetchImpl = globalThis.fetch,
  nonce = randomBytes(8).toString('hex') } = {}) {
  requireThat(approved === true, 'RELAY_TEST_AUTHORIZATION_REQUIRED');
  validKey(key);
  requireThat(/^[a-f0-9]{16}$/.test(nonce), 'INVALID_TEST_NONCE');
  const requests = [];
  let inferenceRequests = 0;
  async function request(path, body) {
    const encoded = body ? JSON.stringify(body) : undefined;
    if (body) {
      requireThat(Buffer.byteLength(encoded) <= 8192, 'REQUEST_TOO_LARGE');
      requireThat(++inferenceRequests <= relay.maxInferenceRequests, 'REQUEST_BUDGET_EXCEEDED');
    }
    const response = await fetchImpl(`${relay.origin}/v1/${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      ...(body ? { body: encoded } : {})
    });
    requireThat(response.ok, response.status === 401 ? 'RELAY_AUTH_REJECTED' : 'RELAY_HTTP_REJECTED');
    const data = await readJson(response);
    if (body) {
      requireThat(data.model === relay.model, 'RELAY_MODEL_MISMATCH');
      requireThat(data.status === 'completed' && Array.isArray(data.output), 'INCOMPLETE_RESPONSE');
      const usage = data.usage || {};
      requireThat(Number.isSafeInteger(usage.input_tokens) && usage.input_tokens >= 0 &&
        Number.isSafeInteger(usage.output_tokens) && usage.output_tokens >= 0 &&
        usage.output_tokens <= relay.maxOutputTokens, 'INVALID_REPORTED_USAGE');
      requests.push({
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens
      });
    }
    return data;
  }
  const catalog = await request('models');
  requireThat(Array.isArray(catalog.data) &&
    catalog.data.some(x => x.id === relay.model), 'EXACT_MODEL_NOT_LISTED');
  const marker = `PARLEY_RELAY_OK_${nonce}`;
  const base = { model: relay.model, store: false, stream: false,
    max_output_tokens: relay.maxOutputTokens };
  const plain = await request('responses', { ...base,
    input: `Synthetic connectivity test. Return exactly ${marker}. Do not use tools.` });
  requireThat(textOf(plain) === marker &&
    !plain.output.some(x => x.type === 'function_call'), 'TEXT_TEST_FAILED');

  const tools = [{ type: 'function', name: 'parley_echo',
    description: 'Echo a synthetic test nonce; no external action.',
    strict: true, parameters: { type: 'object', additionalProperties: false,
      properties: { nonce: { type: 'string', enum: [nonce] } }, required: ['nonce'] } }];
  const input = [{ role: 'user', content:
    `Call parley_echo with nonce ${nonce}, then return its result exactly.` }];
  const call = await request('responses', { ...base, input, tools,
    tool_choice: { type: 'function', name: 'parley_echo' }, parallel_tool_calls: false });
  const calls = call.output.filter(x => x.type === 'function_call');
  requireThat(calls.length === 1 && calls[0].name === 'parley_echo' &&
    typeof calls[0].call_id === 'string' && calls[0].call_id.length > 0, 'UNEXPECTED_TOOL_CALL');
  let args;
  try { args = JSON.parse(calls[0].arguments); }
  catch { throw new Refusal('INVALID_TOOL_ARGUMENTS'); }
  requireThat(args && Object.keys(args).length === 1 && args.nonce === nonce, 'INVALID_TOOL_ARGUMENTS');
  // This is the only "tool": a local constant, never a shell or wallet action.
  const answer = await request('responses', { ...base, tools, tool_choice: 'none',
    input: [...input, ...call.output, { type: 'function_call_output',
      call_id: calls[0].call_id, output: marker }] });
  requireThat(textOf(answer) === marker &&
    !answer.output.some(x => x.type === 'function_call'), 'TOOL_ROUNDTRIP_FAILED');
  return {
    schemaVersion: 1, collectedAt: new Date().toISOString(),
    endpoint: relay.origin, model: relay.model, api: 'openai-responses',
    relayApiVerified: true, inferenceRequests: requests.length, requests,
    maxOutputTokensPerRequest: relay.maxOutputTokens,
    maxRequestBodyBytes: 8192,
    upstreamIdentityVerified: false, openclawInferenceVerified: false,
    walletOperations: false, automaticTransactionsEnabled: false
  };
}

function hostOnly() {
  requireThat(process.platform === 'linux' && process.getuid() !== 0 &&
    userInfo().username === 'parley-agent' && process.env.HOME === '/var/lib/parley-agent',
  'RUN_AS_DEDICATED_AGENT_ON_SERVER');
  requireThat(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'TLS_VERIFICATION_REQUIRED');
}

async function main(args) {
  const [command, approval, ...extra] = args;
  requireThat(extra.length === 0, 'UNEXPECTED_ARGUMENTS');
  if (command === 'plan' && !approval) {
    console.log(JSON.stringify(configPatch(), null, 2));
    return;
  }
  hostOnly();
  if (command === 'store-key' && approval === '--approve-private-storage') {
    requireThat(!process.stdin.isTTY, 'USE_MASKED_KEY_ENTRY_SCRIPT');
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      requireThat(size <= 4096, 'INVALID_KEY');
      chunks.push(chunk);
    }
    await saveKey(Buffer.concat(chunks).toString('utf8'));
    console.log('RELAY_KEY_STORED_NO_NETWORK_REQUEST');
  } else if (command === 'write-plan' && !approval) {
    await writeFile(`${relay.state}/parley-relay.patch.json`,
      `${JSON.stringify(configPatch(), null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    console.log('RELAY_PATCH_WRITTEN_NOT_APPLIED');
  } else if (command === 'probe' && approval === '--approve-relay-tests') {
    const key = await loadKey();
    // Reserve the report before network work so an existing receipt prevents replay.
    const reportFile = await open(`${relay.state}/relay-probe-report.json`,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      const report = await probeRelay({ key, approved: true });
      await reportFile.writeFile(`${JSON.stringify(report, null, 2)}\n`);
      await reportFile.sync();
      console.log(JSON.stringify(report, null, 2));
    } finally { await reportFile.close(); }
  } else {
    throw new Refusal('EXPLICIT_APPROVAL_OR_VALID_COMMAND_REQUIRED');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    // A relay may reflect the key in an error body; never log external errors.
    const code = error instanceof Refusal ? error.code :
      error.code === 'EEXIST' ? 'FILE_EXISTS_REVIEW_BEFORE_RETRY' : 'RELAY_OPERATION_FAILED';
    console.error(JSON.stringify({ ok: false, code }));
    process.exitCode = 1;
  });
}
