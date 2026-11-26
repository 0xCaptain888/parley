import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { sha256 } from '../../scripts/evidence.mjs';
import { copySiteBundle, httpsOrigin, privateProbes, publicFiles, routes, siteCsp, siteManifest,
  validateSiteManifest } from '../../scripts/site-release.mjs';
import { inspectHosting } from '../../scripts/hosting-evidence.mjs';

const origin = 'https://parley.example.org';
const address = n => '0x' + String(n).repeat(40);
const now = 1795399200;
const snapshot = { sha256: 'a'.repeat(64) };

test('checked-in hosting policy matches the CSP exercised by acceptance tests', () => {
  const headers = fs.readFileSync(new URL('../../web/site/_headers', import.meta.url), 'utf8');
  assert.ok(headers.split('\n').some(line => line.trim() === `Content-Security-Policy: ${siteCsp}`));
  assert.ok(headers.includes('Strict-Transport-Security: max-age=31536000'));
  assert.ok(headers.includes('/skill/SHA256SUMS\n  Content-Type: text/plain; charset=utf-8'));
  assert.ok(headers.includes('/skill/parley.mjs\n  Content-Type: text/javascript; charset=utf-8'));
});

function fixture(t, mode = 'staging') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parley-site-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
  };
  const config = { chainId: 56, contract: mode === 'candidate' ? address(1) : null,
    registry: address(2), deploymentBlock: mode === 'candidate' ? 100 : null, multicall: address(3),
    rpcs: ['https://bsc-rpc.publicnode.com'], site: mode === 'candidate' ? origin : null,
    resident: mode === 'candidate' ? 'resident' : null, excluded: mode === 'candidate' ? [address(4)] : [],
    tokens: { USDT: address(5), USDC: address(6) } };
  for (const name of publicFiles) write('web/site/' + name, `public fixture ${name}\n`);
  const syncConfig = () => {
    write('config/build.json', config);
    write('web/site/config.json', config);
  };
  syncConfig();
  const stats = { contract: config.contract, updatedAt: now, block: 150, blockHash: '0x' + 'a'.repeat(64),
    excluded: config.excluded };
  write('web/site/stats.json', mode === 'candidate' ? stats : 'null\n');
  const skillNames = ['SKILL.md', 'parley.mjs', 'parley.zip'];
  for (const name of skillNames)
    write('skill/' + name, fs.readFileSync(path.join(root, 'web/site/skill', name)));
  write('web/site/skill/SHA256SUMS', skillNames.map(name =>
    `${sha256(fs.readFileSync(path.join(root, 'skill', name)))}  ${name}`).join('\n') + '\n');
  const manifest = siteManifest(root, snapshot, mode);
  const bytes = name => fs.readFileSync(path.join(root, 'web/site', name));
  return { root, write, config, stats, syncConfig, manifest, bytes };
}

const typeFor = name => name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css'
  : /\.(m?js)$/.test(name) ? 'text/javascript' : name.endsWith('.json') ? 'application/json'
    : name.endsWith('.md') ? 'text/markdown' : name.endsWith('.svg') ? 'image/svg+xml'
      : name.endsWith('.zip') ? 'application/zip' : name.endsWith('.webm') ? 'video/webm' : 'text/plain';

function hostingFixture(f, overrides = {}) {
  const requests = [];
  const fetcher = async (url, options) => {
    const pathname = new URL(url).pathname;
    requests.push({ pathname, options });
    if (overrides.fetcher) return overrides.fetcher(url, options);
    if (privateProbes.includes(pathname)) return new Response('Not found', { status: overrides.privateStatus || 404 });
    let name = pathname.slice(1);
    if (pathname === '/parley-missing-page') name = '404.html';
    if (routes.includes(pathname)) name = 'index.html';
    const headers = { 'content-type': typeFor(name), 'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer', 'content-security-policy': siteCsp,
      'strict-transport-security': 'max-age=31536000', 'cache-control': 'no-cache',
      ...(overrides.headers || {}) };
    let body = name === 'release-manifest.json'
      ? Buffer.from(JSON.stringify(f.manifest, null, 2) + '\n') : f.bytes(name);
    if (overrides.body) body = overrides.body(name, body);
    return new Response(body, { status: overrides.status || (name === '404.html' ? 404 : 200), headers });
  };
  return { requests, inspect: () => inspectHosting({ origin, manifest: f.manifest, fetcher, now, timeoutMs: 2 }) };
}

test('staging bundle contains only allowlisted static assets, never private adjacent files', t => {
  const f = fixture(t);
  f.write('web/site/.env', 'not public');
  f.write('web/site/resident/state.json', 'not public');
  const destination = path.join(f.root, 'bundle');
  copySiteBundle(f.root, destination, f.manifest);
  assert.equal(fs.existsSync(path.join(destination, '.env')), false);
  assert.equal(fs.existsSync(path.join(destination, 'resident')), false);
  for (const name of publicFiles)
    assert.deepEqual(fs.readFileSync(path.join(destination, name)), f.bytes(name));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(destination, 'release-manifest.json'))), f.manifest);
  assert.throws(() => copySiteBundle(f.root, destination, f.manifest), /overwrite/);
});

test('packaging rejects changed asset bytes, mixed build configuration and stale Skill downloads', t => {
  const f = fixture(t);
  f.write('web/site/assets/app.js', 'tampered');
  assert.throws(() => copySiteBundle(f.root, path.join(f.root, 'bundle'), f.manifest), /changed/);
  f.config.registry = address(9);
  f.write('web/site/config.json', f.config);
  assert.throws(() => siteManifest(f.root, snapshot), /differs from build/);
  f.syncConfig();
  f.write('web/site/skill/parley.mjs', 'tampered');
  assert.throws(() => siteManifest(f.root, snapshot), /checksum mismatch/);
});

test('bundle paths and public configuration cannot leak symlink targets or credential fields', t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.root, 'web/site/demo.webm'));
  fs.symlinkSync('/etc/hosts', path.join(f.root, 'web/site/demo.webm'));
  assert.throws(() => siteManifest(f.root, snapshot), /symlink escapes/);
  for (const mutate of [
    c => { c.privateKey = 'not-a-real-key'; },
    c => { c.rpcs = ['https://user:password@example.org']; },
    c => { c.rpcs = ['https://example.org/?apiKey=not-a-real-key']; },
    c => { c.rpcs = ['https://example.org/not-a-real-key']; },
    c => { c.chainId = 31337; },
    c => { c.contract = address(1); },
  ]) {
    const bad = structuredClone(f.manifest);
    mutate(bad.config);
    assert.throws(() => validateSiteManifest(bad));
  }
});

test('manifest cannot introduce public files, mutable scripts or staging metrics/deployment claims', t => {
  const f = fixture(t);
  const extra = structuredClone(f.manifest);
  extra.files['.env'] = extra.files['config.json'];
  assert.throws(() => validateSiteManifest(extra), /file list/);
  const mutable = structuredClone(f.manifest);
  mutable.files['assets/app.js'].mutable = true;
  assert.throws(() => validateSiteManifest(mutable), /Only candidate stats/);
  f.write('web/site/stats.json', { members: 30 });
  assert.throws(() => siteManifest(f.root, snapshot), /must not contain metrics/);
});

test('public HTTPS origin rejects downgrade, credentials, URL parameters, ports and local targets', () => {
  for (const value of ['http://example.org', 'https://user:password@example.org', origin + '/path',
    origin + '?key=secret', origin + '#hash', 'https://localhost', 'https://127.0.0.1',
    'https://[::1]', 'https://service.local', 'https://example.org:444'])
    assert.throws(() => httpsOrigin(value));
  assert.equal(httpsOrigin(origin + '/'), origin);
});

test('HTTP acceptance covers all assets, six routes and private path denial without claiming installation', async t => {
  const f = fixture(t);
  const h = hostingFixture(f);
  const report = await h.inspect();
  assert.equal(report.status, 'passed');
  assert.equal(report.checks.length, 24);
  assert.equal(report.cleanMachineSkillInstall, false);
  assert.equal(report.mainnetBroadcast, false);
  assert.ok(h.requests.every(r => r.options.redirect === 'manual' && r.options.credentials === 'omit'));
  for (const route of routes) assert.ok(h.requests.some(r => r.pathname === route));
});

test('wrong bytes, MIME, security headers, unsafe duplicate CSP and caching fail acceptance', async t => {
  const f = fixture(t);
  for (const overrides of [
    { body: (name, body) => name === 'assets/app.js' ? Buffer.from('other build') : body },
    { headers: { 'content-type': 'text/html' } },
    { headers: { 'x-content-type-options': '' } },
    { headers: { 'referrer-policy': 'unsafe-url' } },
    { headers: { 'content-security-policy': "default-src *; script-src 'unsafe-inline'" } },
    { headers: { 'content-security-policy': "script-src *; " + siteCsp } },
    { headers: { 'strict-transport-security': 'max-age=0' } },
    { headers: { 'cache-control': 'public, max-age=31536000' } },
  ]) assert.equal((await hostingFixture(f, overrides).inspect()).status, 'failed');
});

test('redirects, partial responses and successful rewrites of private URLs fail closed', async t => {
  const f = fixture(t);
  assert.equal((await hostingFixture(f, { status: 302 }).inspect()).status, 'failed');
  assert.equal((await hostingFixture(f, { status: 206 }).inspect()).status, 'failed');
  const exposed = await hostingFixture(f, { privateStatus: 200 }).inspect();
  assert.equal(exposed.status, 'failed');
  assert.equal(exposed.checks.filter(c => c.status === 'failed').length, 5);
});

test('only an index-to-root 308 is allowed, and the root still needs exact artifact bytes', async t => {
  const f = fixture(t);
  const normal = hostingFixture(f);
  const respond = async url => {
    const pathname = new URL(url).pathname;
    if (pathname === '/index.html')
      return new Response(null, { status: 308, headers: { location: '/', 'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer', 'content-security-policy': siteCsp,
        'strict-transport-security': 'max-age=31536000' } });
    if (privateProbes.includes(pathname)) return new Response('Not found', { status: 404 });
    const name = pathname === '/parley-missing-page' ? '404.html'
      : routes.includes(pathname) ? 'index.html' : pathname.slice(1);
    return new Response(name === 'release-manifest.json' ? JSON.stringify(f.manifest, null, 2) + '\n' : f.bytes(name),
      { status: name === '404.html' ? 404 : 200, headers: { 'content-type': typeFor(name), 'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer', 'content-security-policy': siteCsp,
        'strict-transport-security': 'max-age=31536000', 'cache-control': 'no-cache' } });
  };
  assert.equal((await hostingFixture(f, { fetcher: respond }).inspect()).status, 'passed');
  for (const location of ['https://other.example.org/', '/?other=1', '/docs', '//other.example.org/']) {
    const report = await hostingFixture(f, { fetcher: async (url, options) =>
      new URL(url).pathname === '/index.html' ? new Response(null, { status: 308, headers: { location } })
        : respond(url, options) }).inspect();
    assert.equal(report.status, 'failed');
  }
  const changed = await hostingFixture(f, { fetcher: async (url, options) => {
    const response = await respond(url, options);
    return new URL(url).pathname === '/' ? new Response('changed', { headers: response.headers }) : response;
  } }).inspect();
  assert.equal(changed.status, 'failed');
  assert.equal((await normal.inspect()).status, 'passed');
});

test('Cloudflare routes rewrite to the canonical root and a tracked 404 disables blanket SPA fallback', () => {
  const redirects = fs.readFileSync(new URL('../../web/site/_redirects', import.meta.url), 'utf8');
  assert.deepEqual(redirects.trim().split('\n'),
    ['/p/* / 200', '/packets / 200', '/board / 200', '/stats / 200', '/docs / 200']);
  const notFound = fs.readFileSync(new URL('../../web/site/404.html', import.meta.url), 'utf8');
  assert.ok(notFound.includes('<h1>404</h1>'));
  assert.ok(!notFound.includes('<script'));
  assert.ok(publicFiles.includes('404.html'));
});

test('a configured candidate permits fresh stats changes only for the exact contract and team exclusions', async t => {
  const f = fixture(t, 'candidate');
  const h = hostingFixture(f, { body: (name, body) =>
    name === 'stats.json' ? Buffer.from(JSON.stringify({ ...f.stats, members: 31 })) : body });
  assert.equal((await h.inspect()).status, 'passed');
  for (const patch of [{ contract: address(9) }, { updatedAt: now - 1201 }, { updatedAt: now + 61 },
    { excluded: [] }, { blockHash: null }, { block: 99 }]) {
    const bad = hostingFixture(f, { body: (name, body) =>
      name === 'stats.json' ? Buffer.from(JSON.stringify({ ...f.stats, ...patch })) : body });
    assert.equal((await bad.inspect()).status, 'failed');
  }
  await assert.rejects(inspectHosting({ origin: 'https://other.example.org', manifest: f.manifest }),
    /differs from production/);
});

test('bounded HTTP reads reject excessive bodies and reports never preserve transport secrets', async t => {
  const f = fixture(t);
  const huge = hostingFixture(f, { body: () => Buffer.alloc(2048 * 1024 + 1) });
  assert.equal((await huge.inspect()).status, 'failed');
  const failed = hostingFixture(f, { fetcher: async () => { throw new Error('https://user:secret@example.org/?token=secret'); } });
  const report = await failed.inspect();
  assert.equal(report.status, 'failed');
  assert.ok(!JSON.stringify(report).includes('secret'));
  const timeout = hostingFixture(f, { fetcher: async (url, { signal }) =>
    new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) });
  assert.equal((await timeout.inspect()).status, 'failed');
});
