import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { siteCsp } from './site-release.mjs';
import { sha256, sourceSnapshot } from './evidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = new URL(process.env.PARLEY_TEST_URL || 'http://127.0.0.1:4207');
assert.ok(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname)
  && !base.username && !base.password && !base.search && !base.hash && base.pathname === '/',
'Policy browser test requires a local loopback origin');
const snapshot = sourceSnapshot(root);
const files = ['config.json', 'index.html', 'style.css', 'assets/app.js', 'assets/parley-stamp.svg', 'demo.webm'];
const inputs = () => Object.fromEntries(files.map(name =>
  [name, sha256(fs.readFileSync(path.join(root, 'web/site', name)))]));
const assetHashes = inputs();
assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'web/site/config.json'))).contract, null,
  'This test requires the unconfigured staging build, not mainnet or local-chain transactions');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/Users/lyh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const checkedAt = new Date().toISOString();
const relative = `docs/reports/browser-policy-${checkedAt.replace(/[:.]/g, '-')}`;
fs.mkdirSync(path.join(root, relative), { recursive: true });
const checks = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    try {
      await context.addInitScript(() => {
        window.policyViolations = [];
        document.addEventListener('securitypolicyviolation', event =>
          window.policyViolations.push({ directive: event.violatedDirective, blocked: event.blockedURI }));
      });
      const page = await context.newPage();
      const errors = [], externalRequests = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', async route => {
        if (new URL(route.request().url()).origin !== base.origin) {
          externalRequests.push('Unexpected external request');
          await route.abort();
          return;
        }
        const response = await route.fetch();
        await route.fulfill({ response, headers: { ...response.headers(),
          'content-security-policy': siteCsp, 'strict-transport-security': 'max-age=31536000' } });
      });
      for (const route of ['/?demo=1', '/packets?demo=1', '/p/18?demo=1', '/board?demo=1',
        '/stats?demo=1', '/docs?lang=en']) {
        await page.goto(base.origin + route);
        await page.locator('#app h1').first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        assert.deepEqual(await page.evaluate(() => window.policyViolations), [], 'CSP conflict');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, [], 'Browser runtime error');
        assert.deepEqual(externalRequests, [], 'Staging made an external request');
        checks.push({ width, route, cspViolations: 0, horizontalOverflow: false });
      }
      await page.screenshot({ path: path.join(root, relative, `${width}.png`), fullPage: true });
    } finally { await context.close(); }
  }
  assert.deepEqual(sourceSnapshot(root), snapshot, 'Source inputs changed during browser testing');
  assert.deepEqual(inputs(), assetHashes, 'Public assets changed during browser testing');
  fs.writeFileSync(path.join(root, relative, 'report.json'), JSON.stringify({
    checkedAt, sourceSnapshotSha256: snapshot.sha256, policySha256: sha256(siteCsp), assetHashes, checks,
    status: 'passed', scope: 'Local staging render with candidate CSP; not a public HTTPS acceptance',
    publicHosting: false, realWallet: false, productionRelease: false,
  }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ report: `${relative}/report.json`, checks: checks.length, status: 'passed',
    publicHosting: false, productionRelease: false }, null, 2));
} finally { await browser.close(); }
