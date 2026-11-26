import assert from 'node:assert/strict';
import { sha256 } from './evidence.mjs';
import { httpsOrigin, privateProbes, routes, validateSiteManifest } from './site-release.mjs';

const media = name => name.endsWith('.html') ? ['text/html'] : name.endsWith('.css') ? ['text/css']
  : name.endsWith('.js') || name.endsWith('.mjs') ? ['text/javascript', 'application/javascript']
    : name.endsWith('.json') ? ['application/json'] : name.endsWith('.svg') ? ['image/svg+xml']
      : name.endsWith('.webm') ? ['video/webm'] : name.endsWith('.md') ? ['text/markdown']
        : name.endsWith('.zip') ? ['application/zip', 'application/x-zip-compressed'] : ['text/plain'];

function securityHeaders(headers, html) {
  assert.equal(headers.get('x-content-type-options')?.toLowerCase(), 'nosniff', 'Missing nosniff header');
  assert.equal(headers.get('referrer-policy')?.toLowerCase(), 'no-referrer', 'Missing no-referrer header');
  if (!html) return;
  const directives = new Map();
  for (const directive of (headers.get('content-security-policy') || '').split(';').filter(x => x.trim())) {
    const [name, ...values] = directive.trim().split(/\s+/);
    assert.ok(!directives.has(name.toLowerCase()), 'Duplicate CSP directive');
    directives.set(name.toLowerCase(), values);
  }
  for (const name of ['default-src', 'script-src', 'style-src', 'base-uri'])
    assert.deepEqual(directives.get(name), ["'self'"], `Unsafe or missing CSP ${name}`);
  for (const name of ['object-src', 'frame-ancestors', 'form-action'])
    assert.deepEqual(directives.get(name), ["'none'"], `Unsafe or missing CSP ${name}`);
  assert.deepEqual(directives.get('connect-src'), ["'self'", 'https:'], 'Unsafe CSP connect-src');
  assert.ok(directives.has('upgrade-insecure-requests'), 'Missing HTTPS upgrade policy');
  const hsts = headers.get('strict-transport-security') || '';
  assert.ok(Number(/(?:^|;)\s*max-age=(\d+)/i.exec(hsts)?.[1]) >= 31536000, 'Missing one-year HSTS');
}

async function responseBytes(response, limit) {
  const length = response.headers.get('content-length');
  if (length !== null) assert.ok(/^\d+$/.test(length) && Number(length) <= limit, 'Response size exceeds limit');
  assert.ok(response.body, 'Missing response body');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      assert.ok(size <= limit, 'Response size exceeds limit');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks, size);
}

function statsState(bytes, manifest, now) {
  const stats = JSON.parse(bytes.toString());
  if (manifest.mode === 'staging') {
    assert.equal(stats, null, 'Staging contains unverified metrics');
    return;
  }
  assert.ok(stats && stats.contract?.toLowerCase() === manifest.config.contract.toLowerCase(),
    'Stats contract does not match release');
  assert.ok(Number.isFinite(stats.updatedAt) && stats.updatedAt <= now + 60 && now - stats.updatedAt <= 1200,
    'Stats are stale or dated in the future');
  assert.ok(Number.isSafeInteger(stats.block) && stats.block >= manifest.config.deploymentBlock
    && /^0x[0-9a-fA-F]{64}$/.test(stats.blockHash || ''), 'Stats block anchor is invalid');
  assert.deepEqual(stats.excluded?.map(x => x.toLowerCase()).sort(),
    manifest.config.excluded.map(x => x.toLowerCase()).sort(), 'Stats exclusions do not match release');
}

export async function inspectHosting({ origin, manifest, fetcher = fetch, now = Math.floor(Date.now() / 1000),
  timeoutMs = 15000 }) {
  validateSiteManifest(manifest);
  origin = httpsOrigin(origin);
  if (manifest.mode === 'candidate')
    assert.equal(origin, manifest.config.site, 'Hosting origin differs from production configuration');
  const report = {
    origin, checkedAt: new Date().toISOString(), mode: manifest.mode, status: 'running',
    sourceSnapshotSha256: manifest.sourceSnapshotSha256, manifestSha256: sha256(JSON.stringify(manifest)),
    checks: [], mainnetBroadcast: false, walletAccess: false, cleanMachineSkillInstall: false, productionRelease: false,
    scope: 'Point-in-time HTTP artifact/header checks only; not rendering, wallet, installation or uptime acceptance',
  };
  const probe = async (pathname, action) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetcher(origin + pathname, { redirect: 'manual', credentials: 'omit',
        cache: 'no-store', headers: { 'accept-encoding': 'identity' }, signal: controller.signal });
      assert.ok(!response.redirected && (!response.url || response.url === origin + pathname),
        'Unexpected redirect or response origin');
      await action(response);
      report.checks.push({ path: pathname, status: 'passed' });
    } catch {
      // Transport errors may contain authenticated URLs. Never persist raw error messages.
      report.checks.push({ path: pathname, status: 'failed', reason: 'HTTP status, artifact, header, size or freshness check failed' });
    } finally {
      clearTimeout(timer);
      await response?.body?.cancel().catch(() => {});
    }
  };
  for (const [name, entry] of Object.entries(manifest.files).filter(([name]) =>
    !name.startsWith('_') && name !== '404.html')) {
    await probe('/' + name, async response => {
      // Pages canonicalizes index.html; the root is independently hash-checked below.
      if (name === 'index.html' && response.status === 308) {
        assert.equal(response.headers.get('location'), '/', 'Unexpected index canonicalization');
        securityHeaders(response.headers, true);
        return;
      }
      assert.equal(response.status, 200, 'Public asset unavailable');
      const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      assert.ok(media(name).includes(type), 'Unexpected response content type');
      securityHeaders(response.headers, name.endsWith('.html'));
      if (name.startsWith('skill/') || ['config.json', 'stats.json'].includes(name))
        assert.match(response.headers.get('cache-control') || '', /(?:^|,)\s*no-(?:cache|store)(?:,|$)/i,
          'Release configuration and downloads must revalidate');
      const bytes = await responseBytes(response, entry.mutable ? 2 * 1024 * 1024 : entry.bytes);
      if (!entry.mutable) {
        assert.equal(bytes.length, entry.bytes, 'Asset size mismatch');
        assert.equal(sha256(bytes), entry.sha256, 'Asset digest mismatch');
      }
      if (name === 'config.json') assert.deepEqual(JSON.parse(bytes.toString()), manifest.config);
      if (name === 'stats.json') statsState(bytes, manifest, now);
    });
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  await probe('/release-manifest.json', async response => {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase(), 'application/json');
    assert.deepEqual(await responseBytes(response, manifestBytes.length), manifestBytes);
  });
  for (const route of routes) {
    await probe(route, async response => {
      assert.equal(response.status, 200, 'SPA route unavailable');
      assert.equal(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase(), 'text/html');
      securityHeaders(response.headers, true);
      const bytes = await responseBytes(response, manifest.files['index.html'].bytes);
      assert.equal(sha256(bytes), manifest.files['index.html'].sha256, 'Route serves another build');
    });
  }
  for (const pathname of privateProbes) {
    await probe(pathname, async response => {
      assert.ok([403, 404, 410].includes(response.status), 'Private path is exposed or rewritten to a success page');
      await response.body?.cancel();
    });
  }
  await probe('/parley-missing-page', async response => {
    assert.equal(response.status, 404, 'Unknown page must not return the app');
    assert.equal(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase(), 'text/html');
    securityHeaders(response.headers, true);
    const entry = manifest.files['404.html'];
    assert.equal(sha256(await responseBytes(response, entry.bytes)), entry.sha256, 'Wrong not-found artifact');
  });
  report.status = report.checks.every(c => c.status === 'passed') ? 'passed' : 'failed';
  report.completedAt = new Date().toISOString();
  return report;
}
