import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inspectHosting } from './lib/hosting-evidence.mjs';

export const origin = 'https://parley-staging.pages.dev';
export const rpcs = Object.freeze([
  'https://bsc-dataseed.binance.org',
  'https://bsc-dataseed1.bnbchain.org',
  'https://bsc-rpc.publicnode.com',
]);
export const blocked = Object.freeze([
  'FINAL_CONTRACT_NOT_DEPLOYED',
  'BUSINESS_RESIDENT_DISABLED',
  'STATS_PUBLICATION_DISABLED',
  'ALERT_WEBHOOK_NOT_CONFIGURED',
]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value);

export function verifyBundle(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'bundle.json')));
  assert.equal(manifest.schemaVersion, 1);
  const names = ['monitor.mjs', 'release-manifest.json', 'lib/hosting-evidence.mjs',
    'lib/site-release.mjs', 'lib/evidence.mjs', 'parley-monitor.service', 'parley-monitor.timer'];
  assert.deepEqual(Object.keys(manifest.files).sort(), names.sort());
  for (const [name, digest] of Object.entries(manifest.files)) {
    const target = path.join(root, name);
    assert.ok(fs.lstatSync(target).isFile() && !fs.lstatSync(target).isSymbolicLink());
    assert.match(digest, /^[a-f0-9]{64}$/);
    assert.equal(hash(fs.readFileSync(target)), digest);
  }
  const release = JSON.parse(fs.readFileSync(path.join(root, 'release-manifest.json')));
  assert.equal(release.mode, 'staging');
  assert.equal(release.config.site, origin);
  assert.equal(release.config.contract, null);
  assert.deepEqual(release.config.rpcs, rpcs);
  assert.equal(release.sourceSnapshotSha256, manifest.applicationSnapshotSha256);
  return { release, bundle: manifest };
}

async function boundedJSON(response) {
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /^application\/json\b/i);
  const length = response.headers.get('content-length');
  if (length !== null) assert.ok(/^\d+$/.test(length) && Number(length) <= 32768);
  assert.ok(response.body);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      assert.ok(size <= 32768);
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString());
}

export async function inspectRPC(url, { fetcher = fetch, now = Math.floor(Date.now() / 1000) } = {}) {
  assert.ok(rpcs.includes(url));
  // This allowlist is the only RPC request builder. No signing or broadcast method is supported.
  const methods = ['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber'];
  const call = async (method, params, id) => {
    assert.ok(methods.includes(method));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetcher(url, {
        method: 'POST', redirect: 'error', credentials: 'omit', signal: controller.signal,
        headers: { 'content-type': 'application/json', 'accept-encoding': 'identity' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      });
      const payload = await boundedJSON(response);
      assert.equal(payload.jsonrpc, '2.0');
      assert.equal(payload.id, id);
      assert.ok(!payload.error && Object.hasOwn(payload, 'result'));
      return payload.result;
    } finally { clearTimeout(timer); }
  };
  try {
    const chain = await call('eth_chainId', [], 1);
    assert.ok(hex(chain) && BigInt(chain) === 56n);
    const number = await call('eth_blockNumber', [], 2);
    assert.ok(hex(number) && BigInt(number) > 0n && BigInt(number) <= BigInt(Number.MAX_SAFE_INTEGER));
    const block = await call('eth_getBlockByNumber', [number, false], 3);
    assert.ok(hex(block?.number) && BigInt(block.number) === BigInt(number));
    assert.match(block.hash || '', /^0x[0-9a-f]{64}$/i);
    assert.ok(hex(block.timestamp) && BigInt(block.timestamp) <= BigInt(Number.MAX_SAFE_INTEGER));
    const timestamp = Number(BigInt(block.timestamp));
    assert.ok(timestamp <= now + 30 && now - timestamp <= 180);
    return { url, status: 'passed', chainId: 56, block: Number(BigInt(number)), blockHash: block.hash, timestamp };
  } catch {
    return { url, status: 'failed', code: 'READ_ONLY_RPC_CHECK_FAILED' };
  }
}

export async function inspect({ manifest, bundleHash, fetcher = fetch, now = Math.floor(Date.now() / 1000) }) {
  const [hosting, rpc] = await Promise.all([
    inspectHosting({ origin, manifest, fetcher, now, timeoutMs: 5000 }),
    Promise.all(rpcs.map(url => inspectRPC(url, { fetcher, now }))),
  ]);
  const good = rpc.filter(item => item.status === 'passed');
  const rpcStatus = good.length >= 2 && Math.max(...good.map(x => x.block)) - Math.min(...good.map(x => x.block)) <= 100
    ? 'passed' : 'failed';
  return {
    schemaVersion: 1, checkedAt: new Date(now * 1000).toISOString(),
    status: hosting.status === 'passed' && rpcStatus === 'passed' ? 'passed' : 'failed',
    bundleSha256: bundleHash, sourceSnapshotSha256: manifest.sourceSnapshotSha256,
    hosting, rpc: { status: rpcStatus, requiredHealthy: 2, endpoints: rpc },
    blockers: blocked, walletAccess: false, mainnetBroadcast: false, productionRelease: false,
    scope: 'Periodic staging HTTP integrity and public RPC checks only; not business, wallet, uptime or user acceptance',
  };
}

export function privateDirectory(dir) {
  assert.ok(path.isAbsolute(dir));
  let current = path.parse(dir).root;
  for (const component of dir.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stat = fs.lstatSync(current);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Unsafe state directory');
  }
  const stat = fs.statSync(dir);
  assert.equal(stat.mode & 0o077, 0, 'State directory must be private');
  assert.equal(stat.uid, process.getuid(), 'State directory must belong to the service user');
}

function safeFile(file) {
  if (!fs.existsSync(file)) return;
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && (stat.mode & 0o077) === 0);
}

export function rotateLog(dir, report, maxBytes = 262144, keep = 7) {
  const line = JSON.stringify(report) + '\n';
  assert.ok(Buffer.byteLength(line) <= 65536);
  const file = path.join(dir, 'checks.jsonl');
  const names = [file, ...Array.from({ length: keep }, (_, i) => `${file}.${i + 1}`)];
  names.forEach(safeFile);
  if (fs.existsSync(file) && fs.statSync(file).size + Buffer.byteLength(line) > maxBytes) {
    for (let i = keep; i >= 1; i--) {
      const previous = i === 1 ? file : `${file}.${i - 1}`;
      if (fs.existsSync(previous)) fs.renameSync(previous, `${file}.${i}`);
    }
  }
  fs.appendFileSync(file, line, { mode: 0o600, flag: fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW });
}

export function saveReport(dir, report) {
  const last = path.join(dir, 'latest.json');
  safeFile(last);
  const temporary = path.join(dir, 'latest.pending');
  fs.writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, last);
  rotateLog(dir, report);
}

export async function run(root, dir) {
  privateDirectory(dir);
  const lock = path.join(dir, 'run.lock');
  // systemd serializes timer runs; this also rejects overlapping manual invocations.
  const fd = fs.openSync(lock, 'wx', 0o600);
  try {
    const { release } = verifyBundle(root);
    const report = await inspect({ manifest: release, bundleHash: hash(fs.readFileSync(path.join(root, 'bundle.json'))) });
    saveReport(dir, report);
    console.log(JSON.stringify({ checkedAt: report.checkedAt, status: report.status,
      httpPassed: report.hosting.checks.filter(x => x.status === 'passed').length,
      httpTotal: report.hosting.checks.length, rpcStatus: report.rpc.status,
      productionRelease: false, blockers: blocked }));
    return report.status === 'passed' ? 0 : 1;
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.deepEqual(process.argv.slice(2), ['--state-dir', '/var/lib/parley-monitor']);
    process.exitCode = await run(path.dirname(fileURLToPath(import.meta.url)), process.argv[3]);
  } catch {
    // Never print raw transport, filesystem or parse errors into journal logs.
    console.error('PARLEY_MONITOR_FAILED_CLOSED');
    process.exitCode = 2;
  }
}
