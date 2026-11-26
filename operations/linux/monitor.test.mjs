import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha256, sourceSnapshot } from '../../scripts/evidence.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'parley-linux-test-')));
const bundle = path.join(temporary, 'bundle');
// Test the historical published manifest without relabeling it as current-source evidence.
fs.mkdirSync(path.join(bundle, 'lib'), { recursive: true });
const project = path.resolve(here, '../..');
for (const file of ['monitor.mjs', 'parley-monitor.service', 'parley-monitor.timer'])
  fs.copyFileSync(path.join(here, file), path.join(bundle, file));
for (const file of ['hosting-evidence.mjs', 'site-release.mjs', 'evidence.mjs'])
  fs.copyFileSync(path.join(project, 'scripts', file), path.join(bundle, 'lib', file));
const historical = fs.readFileSync(path.join(project,
  'docs/reports/publication-2026-11-24T01-28-11-438Z/site/release-manifest.json'));
fs.writeFileSync(path.join(bundle, 'release-manifest.json'), historical);
const names = ['monitor.mjs', 'parley-monitor.service', 'parley-monitor.timer', 'release-manifest.json',
  'lib/hosting-evidence.mjs', 'lib/site-release.mjs', 'lib/evidence.mjs'];
fs.writeFileSync(path.join(bundle, 'bundle.json'), JSON.stringify({
  schemaVersion: 1, applicationSnapshotSha256: JSON.parse(historical).sourceSnapshotSha256,
  files: Object.fromEntries(names.map(name => [name, sha256(fs.readFileSync(path.join(bundle, name)))])),
}));
const monitor = await import(path.join(bundle, 'monitor.mjs'));
const { release } = monitor.verifyBundle(bundle);
const now = 1800000000;
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
const json = object => new Response(JSON.stringify(object), { headers: { 'content-type': 'application/json' } });
const rpcFetch = async (_, options) => {
  const request = JSON.parse(options.body);
  const result = request.method === 'eth_chainId' ? '0x38' : request.method === 'eth_blockNumber' ? '0x100'
    : { number: '0x100', hash: '0x' + 'a'.repeat(64), timestamp: '0x' + now.toString(16) };
  return json({ jsonrpc: '2.0', id: request.id, result });
};

test('fixture anchors the historical published snapshot, not the working tree', () => {
  assert.equal(release.config.contract, null);
  assert.equal(release.sourceSnapshotSha256, '2f126e875e00320d7bbf069ea291533d3006a34f79d148e2d51bb7f026eeaca7');
});
test('production packager still refuses to relabel historical publication after source changes', () => {
  if (sourceSnapshot(project).sha256 === release.sourceSnapshotSha256) return;
  const dest = path.join(temporary, 'refused-package');
  assert.throws(() => execFileSync(process.execPath, [path.join(here, 'package.mjs'), dest], { stdio: 'pipe' }));
  assert.equal(fs.existsSync(dest), false);
});
test('bundle rejects modified executable inputs', () => {
  const target = path.join(bundle, 'monitor.mjs');
  const original = fs.readFileSync(target);
  try {
    fs.appendFileSync(target, '\n// tamper\n');
    assert.throws(() => monitor.verifyBundle(bundle));
  } finally { fs.writeFileSync(target, original); }
});
test('RPC uses only three explicitly allowed read methods', async () => {
  const seen = [];
  const result = await monitor.inspectRPC(monitor.rpcs[0], { now, fetcher: async (url, options) => {
    seen.push(JSON.parse(options.body).method);
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    return rpcFetch(url, options);
  } });
  assert.equal(result.status, 'passed');
  assert.deepEqual(seen, ['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber']);
});
test('unlisted RPC destination is rejected without a request', async () => {
  await assert.rejects(monitor.inspectRPC('https://example.com', { fetcher: () => assert.fail() }));
});
for (const [name, transform] of [
  ['wrong chain', payload => ({ ...payload, result: '0x1' })],
  ['wrong JSON-RPC id', payload => ({ ...payload, id: 999 })],
  ['error response', payload => ({ ...payload, error: { message: 'private-secret' } })],
  ['invalid hex', payload => ({ ...payload, result: '1' })],
  ['oversized body', () => ({ padding: 'x'.repeat(33000) })],
]) {
  test(`RPC rejects ${name} with sanitized output`, async () => {
    const result = await monitor.inspectRPC(monitor.rpcs[0], { now, fetcher: async () =>
      json(transform({ jsonrpc: '2.0', id: 1, result: '0x38' })) });
    assert.deepEqual(result, { url: monitor.rpcs[0], status: 'failed', code: 'READ_ONLY_RPC_CHECK_FAILED' });
  });
}
for (const [name, timestamp] of [['stale block', now - 181], ['future block', now + 31]]) {
  test(`RPC rejects ${name}`, async () => {
    const result = await monitor.inspectRPC(monitor.rpcs[0], { now, fetcher: async (url, options) => {
      if (JSON.parse(options.body).id !== 3) return rpcFetch(url, options);
      return json({ jsonrpc: '2.0', id: 3, result: {
        number: '0x100', hash: '0x' + 'a'.repeat(64), timestamp: '0x' + timestamp.toString(16),
      } });
    } });
    assert.equal(result.status, 'failed');
  });
}
test('transport secrets are never returned', async () => {
  const result = await monitor.inspectRPC(monitor.rpcs[0], { now, fetcher: async () => {
    throw new Error('https://user:password@host/?apiKey=private-secret');
  } });
  assert.equal(result.code, 'READ_ONLY_RPC_CHECK_FAILED');
  assert.ok(!JSON.stringify(result).includes('private-secret'));
});
test('HTTP integrity failure cannot produce an overall pass', async () => {
  const result = await monitor.inspect({ manifest: release, bundleHash: 'a'.repeat(64), now,
    fetcher: async (url, options) => options.method === 'POST' ? rpcFetch(url, options) : new Response('wrong', { status: 500 }) });
  assert.equal(result.status, 'failed');
  assert.equal(result.rpc.status, 'passed');
  assert.equal(result.hosting.checks.length, 24);
  assert.equal(result.productionRelease, false);
  assert.deepEqual(result.blockers, monitor.blocked);
});
test('RPC quorum requires at least two healthy endpoints', async () => {
  const result = await monitor.inspect({ manifest: release, bundleHash: 'a'.repeat(64), now,
    fetcher: async (url, options) => {
      if (options.method !== 'POST') return new Response('wrong', { status: 500 });
      if (url !== monitor.rpcs[0]) throw new Error('offline');
      return rpcFetch(url, options);
    } });
  assert.equal(result.rpc.status, 'failed');
});
test('real release bytes pass all 24 HTTP checks with a two-endpoint RPC quorum', async () => {
  const site = path.resolve(here, '../../docs/reports/publication-2026-11-24T01-28-11-438Z/site');
  const { siteCsp, routes, privateProbes } = await import(path.join(bundle, 'lib/site-release.mjs'));
  const result = await monitor.inspect({ manifest: release, bundleHash: 'a'.repeat(64), now,
    fetcher: async (url, options) => {
      if (options.method === 'POST') {
        if (url === monitor.rpcs[2]) throw new Error('one endpoint unavailable');
        return rpcFetch(url, options);
      }
      const pathname = new URL(url).pathname;
      if (privateProbes.includes(pathname)) return new Response(null, { status: 404 });
      let name = routes.includes(pathname) ? 'index.html' : pathname.slice(1);
      let status = 200;
      if (pathname === '/parley-missing-page') { name = '404.html'; status = 404; }
      const type = name.endsWith('.html') ? 'text/html' : name.endsWith('.js') || name.endsWith('.mjs')
        ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.json')
          ? 'application/json' : name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.webm')
            ? 'video/webm' : name.endsWith('.md') ? 'text/markdown' : name.endsWith('.zip')
              ? 'application/zip' : 'text/plain';
      return new Response(fs.readFileSync(path.join(site, name)), { status, headers: {
        'content-type': type, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
        'content-security-policy': siteCsp, 'strict-transport-security': 'max-age=31536000',
        'cache-control': 'no-cache',
      } });
    } });
  assert.equal(result.hosting.status, 'passed');
  assert.equal(result.hosting.checks.length, 24);
  assert.equal(result.rpc.status, 'passed');
  assert.equal(result.status, 'passed');
  assert.equal(result.productionRelease, false);
});
test('RPC quorum rejects divergent heads', async () => {
  const result = await monitor.inspect({ manifest: release, bundleHash: 'a'.repeat(64), now,
    fetcher: async (url, options) => {
      if (options.method !== 'POST') return new Response('wrong', { status: 500 });
      const response = await rpcFetch(url, options);
      const payload = await response.json();
      if (url === monitor.rpcs[0] && payload.id === 2) payload.result = '0x1000';
      if (url === monitor.rpcs[0] && payload.id === 3) payload.result.number = '0x1000';
      return json(payload);
    } });
  assert.equal(result.rpc.status, 'failed');
});
test('state path rejects public permissions and symlinks', () => {
  const dir = fs.mkdtempSync(path.join(temporary, 'state-'));
  monitor.privateDirectory(dir);
  fs.chmodSync(dir, 0o755);
  assert.throws(() => monitor.privateDirectory(dir));
  fs.chmodSync(dir, 0o700);
  const link = path.join(temporary, 'linked');
  fs.symlinkSync(dir, link);
  assert.throws(() => monitor.privateDirectory(link));
});
test('reports are private, atomic and logs have bounded generations', () => {
  const dir = fs.mkdtempSync(path.join(temporary, 'log-'));
  monitor.saveReport(dir, { status: 'failed' });
  assert.equal(fs.statSync(path.join(dir, 'latest.json')).mode & 0o077, 0);
  for (let i = 0; i < 20; i++) monitor.rotateLog(dir, { sequence: i }, 35, 2);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['checks.jsonl', 'checks.jsonl.1', 'checks.jsonl.2', 'latest.json']);
  for (const file of fs.readdirSync(dir)) {
    assert.equal(fs.statSync(path.join(dir, file)).mode & 0o077, 0);
    if (file.startsWith('checks')) assert.ok(fs.statSync(path.join(dir, file)).size <= 35);
  }
});
test('state file symlink cannot overwrite a target', () => {
  const dir = fs.mkdtempSync(path.join(temporary, 'link-'));
  const target = path.join(dir, 'target');
  fs.writeFileSync(target, 'untouched', { mode: 0o600 });
  fs.symlinkSync(target, path.join(dir, 'checks.jsonl'));
  assert.throws(() => monitor.rotateLog(dir, { status: 'passed' }));
  assert.equal(fs.readFileSync(target, 'utf8'), 'untouched');
});
test('overlapping manual run fails closed', async () => {
  const dir = fs.mkdtempSync(path.join(temporary, 'locked-'));
  fs.writeFileSync(path.join(dir, 'run.lock'), '', { mode: 0o600 });
  await assert.rejects(monitor.run(bundle, dir));
  assert.deepEqual(fs.readdirSync(dir), ['run.lock']);
});
test('units cannot start business jobs or bind an inbound listener', () => {
  const unit = fs.readFileSync(path.join(here, 'parley-monitor.service'), 'utf8');
  assert.match(unit, /User=parley/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.match(unit, /ProtectHome=true/);
  assert.match(unit, /NoNewPrivileges=true/);
  assert.match(unit, /MemoryMax=256M/);
  assert.ok(!/resident\.mjs|stats-runner|wallet|ListenStream|DEPLOYER_KEY/.test(unit));
});
