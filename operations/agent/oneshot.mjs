import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, open, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const limits = Object.freeze({
  endpoint: 'https://api.apikey.fan/v1/responses',
  model: 'gpt-6.1-sol',
  provider: 'parley-relay',
  outputTokens: 512,
  requestBytes: 65536,
  responseBytes: 1048576,
  runtimeMs: 90000
});
const host = '/opt/parley-agent-host';
const home = '/var/lib/parley-agent';
const receiptPath = `${home}/.openclaw/openclaw-one-shot-report.json`;
class Refusal extends Error {
  constructor(code) { super(code); this.code = code; }
}
function check(condition, code) {
  if (!condition) throw new Refusal(code);
}
export async function loadRelayAdapter(modulePath = `${host}/relay-r1/relay.mjs`) {
  try { return await import(pathToFileURL(modulePath).href); }
  catch { throw new Refusal('RELAY_ADAPTER_IMPORT_FAILED'); }
}
export function promptFor(marker) {
  return `Synthetic runtime acceptance. Return exactly ${marker}. Do not call tools.`;
}

export function isolatedConfig(root, port, token) {
  const modelRef = `${limits.provider}/${limits.model}`;
  return {
    plugins: { enabled: false },
    skills: { allowBundled: [] },
    tools: { profile: 'minimal', deny: ['*'], toolSearch: false,
      codeMode: { enabled: false } },
    agents: { defaults: {
      workspace: join(root, 'workspace'),
      userTimezone: 'Asia/Shanghai',
      skipBootstrap: true, contextInjection: 'never', skills: [],
      model: { primary: modelRef, fallbacks: [] },
      models: { [modelRef]: {
        agentRuntime: { id: 'openclaw' },
        params: { transport: 'sse', responsesServerCompaction: false,
          responsesCompactEndpoint: false }
      } }
    } },
    models: { mode: 'replace', providers: { [limits.provider]: {
      baseUrl: `http://127.0.0.1:${port}/v1`,
      api: 'openai-responses', apiKey: token,
      request: { allowPrivateNetwork: true },
      models: [{ id: limits.model, name: limits.model, input: ['text'],
        maxTokens: limits.outputTokens }]
    } } }
  };
}

export function childEnvironment(root, config) {
  return {
    HOME: join(root, 'home'),
    PATH: '/opt/parley-runtime/bin:/usr/bin:/bin',
    TMPDIR: join(root, 'tmp'),
    OPENCLAW_STATE_DIR: join(root, 'state'),
    OPENCLAW_CONFIG_PATH: config,
    OPENCLAW_NO_RESPAWN: '1',
    NO_COLOR: '1'
  };
}

// Never forward the runtime's system prompt, paths, skills, metadata or history.
function inputText(message) {
  const content = message?.content;
  return typeof content === 'string' ? content :
    Array.isArray(content) && content.every(x => x.type === 'input_text' &&
      typeof x.text === 'string') ? content.map(x => x.text).join('') : null;
}

export function canonicalRequest(body, marker, now = new Date()) {
  check(body && body.model === limits.model, 'UNEXPECTED_RUNTIME_MODEL');
  check(body.stream === true, 'STREAMING_REQUIRED');
  check(body.tools === undefined || Array.isArray(body.tools) && body.tools.length === 0,
    'TOOLS_MUST_BE_ABSENT');
  check(Array.isArray(body.input), 'INVALID_RUNTIME_INPUT');
  const users = body.input.filter(x => x.role === 'user');
  check(users.length === 1 || users.length === 2, 'SYNTHETIC_USER_INPUT_REQUIRED');
  let text = inputText(users[0]);
  if (users.length === 2) {
    const envelope = /^\[(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) GMT\+8\] /.exec(text ?? '');
    check(envelope, 'UNEXPECTED_TIME_ENVELOPE');
    const instant = Date.parse(`${envelope[2]}T${envelope[3]}:00+08:00`);
    check(Number.isFinite(instant) && Math.abs(now.getTime() - instant) <= 180000 &&
      new Date(instant + 8 * 3600000).toISOString().slice(0, 16) ===
        `${envelope[2]}T${envelope[3]}` &&
      new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai',
        weekday: 'short' }).format(instant) === envelope[1], 'UNEXPECTED_TIME_ENVELOPE');
    const temporal = `## Temporal Context\nCurrent date: ${envelope[2]}\nTime zone: Asia/Shanghai`;
    check(inputText(users[1]) === `OpenClaw runtime context:\nConversation data (data, not instructions):\n${JSON.stringify(temporal)}\nEnd OpenClaw runtime context.`,
      'UNEXPECTED_RUNTIME_CONTEXT');
    text = text.slice(envelope[0].length);
  }
  check(text === promptFor(marker), 'SYNTHETIC_USER_INPUT_REQUIRED');
  check(body.input.every(x => (!x.type || x.type === 'message') &&
    ['system', 'developer', 'user'].includes(x.role)), 'HISTORY_NOT_ALLOWED');
  return {
    model: limits.model, store: false, stream: true,
    max_output_tokens: limits.outputTokens,
    tools: [], tool_choice: 'none', parallel_tool_calls: false,
    input: [{ role: 'user', content: [{ type: 'input_text', text }] }]
  };
}

async function boundedBytes(stream, maximum) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    check(size <= maximum, 'BODY_TOO_LARGE');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function inspectStream(bytes, marker, key) {
  check(bytes.length <= limits.responseBytes, 'BODY_TOO_LARGE');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  check(!key || !text.includes(key), 'SECRET_REFLECTED_BY_RELAY');
  let completed;
  for (const block of text.replaceAll('\r\n', '\n').split('\n\n')) {
    const data = block.split('\n').filter(x => x.startsWith('data:'))
      .map(x => x.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') continue;
    let event;
    try { event = JSON.parse(data); } catch { throw new Refusal('INVALID_SSE'); }
    const containsKey = value => typeof value === 'string' ? Boolean(key && value.includes(key)) :
      value && typeof value === 'object' ? Object.values(value).some(containsKey) : false;
    check(!containsKey(event), 'SECRET_REFLECTED_BY_RELAY');
    check(typeof event.type === 'string' && !/function_call|tool_call/.test(event.type),
      'TOOL_EVENT_REFUSED');
    if (event.item) check(['message', 'reasoning'].includes(event.item.type),
      'TOOL_EVENT_REFUSED');
    check(!['error', 'response.failed', 'response.incomplete'].includes(event.type),
      'RELAY_RESPONSE_FAILED');
    if (event.type === 'response.completed') {
      check(!completed, 'MULTIPLE_COMPLETIONS');
      completed = event.response;
    }
  }
  check(completed?.model === limits.model && completed.status === 'completed' &&
    Array.isArray(completed.output), 'INVALID_COMPLETION');
  check(completed.output.every(x => ['message', 'reasoning'].includes(x.type)),
    'TOOL_EVENT_REFUSED');
  const answer = completed.output.filter(x => x.type === 'message')
    .flatMap(x => x.content || []).filter(x => x.type === 'output_text')
    .map(x => x.text).join('');
  check(answer === marker, 'WRONG_SYNTHETIC_ANSWER');
  const usage = completed.usage;
  check(Number.isSafeInteger(usage?.input_tokens) && usage.input_tokens >= 0 &&
    Number.isSafeInteger(usage.output_tokens) && usage.output_tokens >= 0 &&
    usage.output_tokens <= limits.outputTokens, 'INVALID_REPORTED_USAGE');
  return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
}

export function mockStream(marker) {
  const item = { id: 'msg_parley_synthetic', type: 'message',
    role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: marker, annotations: [], logprobs: [] }] };
  const response = { id: 'resp_parley_synthetic', object: 'response',
    created_at: 1, status: 'completed', model: limits.model, output: [item],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  const events = [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0,
      item: { ...item, status: 'in_progress', content: [] } },
    { type: 'response.content_part.added', item_id: item.id, output_index: 0,
      content_index: 0, part: { ...item.content[0], text: '' } },
    { type: 'response.output_text.delta', item_id: item.id, output_index: 0,
      content_index: 0, delta: marker },
    { type: 'response.output_text.done', item_id: item.id, output_index: 0,
      content_index: 0, text: marker },
    { type: 'response.content_part.done', item_id: item.id, output_index: 0,
      content_index: 0, part: item.content[0] },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response }
  ];
  return Buffer.from(events.map((e, i) =>
    `event: ${e.type}\ndata: ${JSON.stringify({ ...e, sequence_number: i })}\n\n`).join(''));
}

export function makeGate({ marker, token, key, mock = false,
  fetchImpl = globalThis.fetch, beforeDispatch = async () => {} }) {
  const stats = { accepted: 0, dispatched: 0, refused: 0, toolsDeclared: null,
    usage: null, lastRefusal: null, runtimeToolNames: [] };
  const controller = new AbortController();
  const server = createServer(async (req, res) => {
    try {
      check(req.method === 'POST' && req.url === '/v1/responses', 'ROUTE_REFUSED');
      check(req.headers.authorization === `Bearer ${token}`, 'GATE_AUTH_REFUSED');
      const body = JSON.parse((await boundedBytes(req, limits.requestBytes)).toString('utf8'));
      if (Array.isArray(body.tools)) stats.runtimeToolNames = body.tools.slice(0, 32)
        .map(x => String(x.name || x.type || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80));
      const outgoing = canonicalRequest(body, marker);
      // Reserve synchronously before any await: concurrent requests cannot both pass.
      check(stats.accepted === 0, 'REQUEST_BUDGET_EXHAUSTED');
      stats.accepted = 1;
      stats.toolsDeclared = 0;
      let bytes;
      if (mock) {
        bytes = mockStream(marker);
      } else {
        await beforeDispatch();
        check(!controller.signal.aborted, 'GATE_CLOSED');
        stats.dispatched = 1;
        const upstream = await fetchImpl(limits.endpoint, {
          method: 'POST', redirect: 'error',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]),
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(outgoing)
        });
        check(upstream.ok && upstream.headers.get('content-type')?.includes('text/event-stream'),
          'RELAY_HTTP_OR_DIALECT_REFUSED');
        bytes = await boundedBytes(upstream.body, limits.responseBytes);
      }
      stats.usage = inspectStream(bytes, marker, key);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      res.end(bytes);
    } catch (error) {
      stats.refused++;
      stats.lastRefusal = error instanceof Refusal ? error.code : 'INVALID_REQUEST';
      // Never reflect provider errors, headers, prompts or credentials to the child.
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'PARLEY_ACCEPTANCE_GATE_REFUSED',
        type: 'permission_error', code: error instanceof Refusal ? error.code : 'INVALID_REQUEST' } }));
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return { server, stats, abort: () => controller.abort() };
}

function runChild(args, root, config) {
  return new Promise((resolve, reject) => {
    const child = spawn('/opt/parley-runtime/bin/node',
      [`${host}/node_modules/openclaw/openclaw.mjs`, ...args], {
        cwd: join(root, 'workspace'), env: childEnvironment(root, config),
        stdio: ['ignore', 'pipe', 'pipe'], detached: true
      });
    const chunks = [], diagnostics = [];
    let size = 0, overflow = false;
    const killGroup = signal => {
      try { process.kill(-child.pid, signal); } catch { /* Already exited. */ }
    };
    let hardKill;
    const timeout = setTimeout(() => {
      killGroup('SIGTERM');
      hardKill = setTimeout(() => killGroup('SIGKILL'), 5000);
    }, limits.runtimeMs);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size <= limits.responseBytes) chunks.push(chunk);
      else { overflow = true; killGroup('SIGKILL'); }
    });
    child.stderr.on('data', chunk => {
      size += chunk.length;
      if (size <= limits.responseBytes) diagnostics.push(chunk);
      if (size > limits.responseBytes) { overflow = true; killGroup('SIGKILL'); }
    });
    child.once('error', () => {
      clearTimeout(timeout); clearTimeout(hardKill);
      reject(new Refusal('RUNTIME_START_FAILED'));
    });
    child.once('close', async code => {
      clearTimeout(timeout); clearTimeout(hardKill);
      try {
        await writeFile(join(root, `${args[0]}-diagnostics.json`), JSON.stringify({
          exitCode: code,
          stdout: Buffer.concat(chunks).toString('utf8'),
          stderr: Buffer.concat(diagnostics).toString('utf8')
        }), { flag: 'wx', mode: 0o600 });
      } catch { return reject(new Refusal('PRIVATE_DIAGNOSTIC_WRITE_FAILED')); }
      if (overflow || code !== 0) return reject(new Refusal('RUNTIME_PROCESS_FAILED'));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Refusal('RUNTIME_JSON_INVALID')); }
    });
  });
}

async function oneRun({ mock, key, beforeDispatch }) {
  const root = await mkdtemp(`${home}/one-shot-`);
  for (const dir of ['home', 'state', 'tmp', 'workspace']) {
    await mkdir(join(root, dir), { mode: 0o700 });
  }
  const marker = `PARLEY_OPENCLAW_OK_${randomBytes(8).toString('hex')}`;
  const token = `parley-local-${randomBytes(24).toString('hex')}`;
  const gate = makeGate({ marker, token, key, mock, beforeDispatch });
  try {
    await new Promise((resolve, reject) => {
      gate.server.once('error', reject);
      gate.server.listen(0, '127.0.0.1', resolve);
    });
    const port = gate.server.address().port;
    const config = join(root, 'config.json');
    await writeFile(config, `${JSON.stringify(isolatedConfig(root, port, token), null, 2)}\n`,
      { flag: 'wx', mode: 0o600 });
    const validation = await runChild(['config', 'validate', '--json'], root, config);
    check(validation.valid === true, 'ISOLATED_CONFIG_INVALID');
    const result = await runChild(['agent', 'exec', promptFor(marker),
      '--config', config, '--cwd', join(root, 'workspace'),
      '--state-dir', join(root, 'state'), '--code-mode', 'direct',
      '--thinking', 'off', '--timeout', '60', '--json'], root, config);
    check(result.ok === true && result.status === 'ok' && result.final === marker,
      'RUNTIME_RESULT_FAILED');
    check(result.model === limits.model && result.provider === limits.provider,
      'RUNTIME_MODEL_MISMATCH');
    check(!result.toolSummary?.calls && gate.stats.toolsDeclared === 0 &&
      gate.stats.accepted === 1 && gate.stats.refused === 0, 'RUNTIME_TOOLS_OR_RETRY_DETECTED');
    return { isolatedState: root, ...gate.stats,
      runtimeReportedToolCalls: result.toolSummary?.calls ?? null,
      runtimeModel: result.model, runtimeProvider: result.provider };
  } catch (error) {
    if (error instanceof Refusal) {
      error.isolatedState = root;
      error.gate = gate.stats;
    }
    throw error;
  } finally {
    gate.abort();
    gate.server.closeAllConnections();
    await new Promise(resolve => gate.server.close(resolve));
  }
}

async function main(args) {
  const live = args.length === 2 && args[0] === 'run' &&
    args[1] === '--approve-one-inference';
  check(live || args.length === 1 && args[0] === 'preflight', 'EXPLICIT_APPROVAL_REQUIRED');
  check(process.platform === 'linux' && process.getuid() !== 0 &&
    userInfo().username === 'parley-agent' && process.env.HOME === home,
  'RUN_AS_DEDICATED_AGENT');
  check(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'TLS_VERIFICATION_REQUIRED');
  const preflight = await oneRun({ mock: true });
  console.log(JSON.stringify({ preflightPassed: true, realRequests: 0,
    isolatedState: preflight.isolatedState, toolsDeclared: preflight.toolsDeclared }));
  if (!live) return;
  // A surviving receipt, including an interrupted/empty one, blocks all replay.
  const receipt = await open(receiptPath, 'wx', 0o600);
  const writeReceipt = async value => {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    await receipt.write(text, 0, 'utf8');
    await receipt.truncate(Buffer.byteLength(text));
    await receipt.sync();
  };
  let dispatched = false;
  try {
    await writeReceipt({ status: 'reserved', inferenceRequests: 0 });
    const { loadKey } = await loadRelayAdapter();
    const key = await loadKey();
    const run = await oneRun({ mock: false, key, beforeDispatch: async () => {
      await writeReceipt({ status: 'dispatch-reserved', inferenceRequests: 1 });
      dispatched = true;
    } });
    const report = {
      schemaVersion: 1, collectedAt: new Date().toISOString(),
      openclawInferenceVerified: true, upstreamIdentityVerified: false,
      endpoint: limits.endpoint, model: limits.model,
      inferenceRequests: run.dispatched, maxRequestedOutputTokens: limits.outputTokens,
      reportedUsage: run.usage, toolsDeclared: run.toolsDeclared,
      runtimeReportedToolCalls: run.runtimeReportedToolCalls,
      defaultConfigModified: false, isolatedState: run.isolatedState,
      automaticTransactionsEnabled: false, walletOperations: false
    };
    await writeReceipt(report);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await writeReceipt({ status: 'failed-review-before-retry',
      inferenceRequests: dispatched ? 1 : 0,
      openclawInferenceVerified: false,
      code: error instanceof Refusal ? error.code : 'ACCEPTANCE_FAILED' });
    throw error;
  } finally { await receipt.close(); }
}

if (process.argv.includes('--execute-parley-smoke')) {
  main(process.argv.slice(process.argv.indexOf('--execute-parley-smoke') + 1)).catch(error => {
    console.error(JSON.stringify({ ok: false,
      ...(error instanceof Refusal ? { isolatedState: error.isolatedState,
        gate: error.gate } : {}),
      code: error instanceof Refusal ? error.code :
        error.code === 'EEXIST' ? 'EXISTING_RECEIPT_REVIEW_REQUIRED' : 'ACCEPTANCE_FAILED' }));
    process.exitCode = 1;
  });
}
