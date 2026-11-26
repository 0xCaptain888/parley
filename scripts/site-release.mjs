import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { readContainedEvidence, sha256 } from './evidence.mjs';

export const publicFiles = [
  '_headers', '_redirects', 'index.html', '404.html', 'style.css', 'config.json', 'stats.json',
  'assets/app.js', 'assets/parley-stamp.svg', 'demo.webm',
  'skill/SKILL.md', 'skill/parley.mjs', 'skill/parley.zip', 'skill/SHA256SUMS',
];
export const routes = ['/', '/packets', '/p/1', '/board', '/stats', '/docs'];
export const privateProbes = ['/.env', '/.git/config', '/resident/config.local.json',
  '/helper/state/keys.json', '/node_modules/package.json'];
export const siteCsp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
  + "media-src 'self'; connect-src 'self' https:; object-src 'none'; base-uri 'self'; "
  + "frame-ancestors 'none'; form-action 'none'; upgrade-insecure-requests";

export function httpsOrigin(input) {
  const url = new URL(input);
  assert.ok(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
    && url.pathname === '/' && !url.port, 'A credential-free HTTPS origin on the default port is required');
  assert.ok(url.hostname.includes('.') && !/^(localhost|\[.*\]|[\d.]+)$/.test(url.hostname)
    && !/\.(localhost|local|invalid|test)$/.test(url.hostname),
  'A public hostname is required');
  return url.origin;
}

function publicConfiguration(config, mode) {
  assert.deepEqual(Object.keys(config).sort(), ['chainId', 'contract', 'registry', 'deploymentBlock',
    'multicall', 'rpcs', 'site', 'resident', 'excluded', 'tokens'].sort(),
  'Unexpected field in public configuration');
  assert.equal(config.chainId, 56, 'Public bundles must target BSC');
  if (config.site !== null) assert.equal(httpsOrigin(config.site), config.site, 'Canonical public origin required');
  assert.ok(Array.isArray(config.rpcs) && config.rpcs.length > 0
    && config.rpcs.every(url => httpsOrigin(url) === url), 'Only credential-free public RPC origins may be published');
  for (const address of [config.registry, config.multicall, ...Object.values(config.tokens), ...config.excluded])
    assert.match(address || '', /^0x[0-9a-fA-F]{40}$/, 'Invalid public configuration address');
  assert.deepEqual(Object.keys(config.tokens).sort(), ['USDC', 'USDT'], 'Unexpected listed tokens');
  assert.ok(Array.isArray(config.excluded) && new Set(config.excluded.map(a => a.toLowerCase())).size === config.excluded.length,
    'Duplicate public exclusions');
  if (mode === 'staging') {
    assert.equal(config.contract, null, 'Staging bundle must not enable contract transactions');
    assert.equal(config.deploymentBlock, null, 'Staging cannot claim a deployment');
  } else {
    assert.match(config.contract || '', /^0x[0-9a-fA-F]{40}$/, 'Production contract is required');
    assert.ok(!/^0x0{40}$/i.test(config.contract), 'Zero production contract');
    assert.equal(httpsOrigin(config.site), config.site, 'Production origin must be canonical');
    assert.ok(/^[a-z0-9]{1,64}$/.test(config.resident || '') && config.excluded.length > 0
      && Number.isSafeInteger(config.deploymentBlock) && config.deploymentBlock > 0,
    'Production identity, deployment block and exclusions are required');
  }
}

export function siteManifest(root, snapshot, mode = 'staging') {
  assert.ok(['staging', 'candidate'].includes(mode), 'Unknown site bundle mode');
  const read = name => readContainedEvidence(root, `web/site/${name}`);
  const config = JSON.parse(read('config.json'));
  assert.deepEqual(config, JSON.parse(readContainedEvidence(root, 'config/build.json')),
    'Website configuration differs from build configuration');
  publicConfiguration(config, mode);
  if (mode === 'staging') {
    assert.equal(JSON.parse(read('stats.json')), null, 'Unconfigured staging must not contain metrics');
  }
  const sums = read('skill/SHA256SUMS').toString().trim().split('\n');
  assert.equal(sums.length, 3, 'Expected all three Skill artifact checksums');
  const names = new Set();
  for (const line of sums) {
    const match = /^([0-9a-f]{64})  (SKILL\.md|parley\.mjs|parley\.zip)$/.exec(line);
    assert.ok(match && !names.has(match[2]), 'Malformed or duplicate Skill checksum');
    names.add(match[2]);
    assert.equal(sha256(read(`skill/${match[2]}`)), match[1], 'Skill artifact checksum mismatch');
    assert.deepEqual(read(`skill/${match[2]}`), readContainedEvidence(root, `skill/${match[2]}`),
      'Website and standalone Skill artifacts differ');
  }
  const files = Object.fromEntries(publicFiles.map(name => {
    const bytes = read(name);
    return [name, { bytes: bytes.length, sha256: sha256(bytes), mutable: mode === 'candidate' && name === 'stats.json' }];
  }));
  return { schemaVersion: 1, mode, sourceSnapshotSha256: snapshot.sha256, config, files,
    notes: {
      realWalletAcceptance: false, cleanMachineSkillInstall: false,
      productionRelease: false, fictionalVideo: true,
      scope: 'Static artifact manifest only; not audit, deployment, live hosting or installation evidence',
    } };
}

export function validateSiteManifest(manifest) {
  assert.equal(manifest.schemaVersion, 1, 'Unknown site manifest schema');
  assert.ok(['staging', 'candidate'].includes(manifest.mode), 'Unknown site mode');
  assert.match(manifest.sourceSnapshotSha256 || '', /^[0-9a-f]{64}$/, 'Invalid source snapshot');
  assert.deepEqual(Object.keys(manifest.files).sort(), [...publicFiles].sort(), 'Unexpected public file list');
  for (const [name, entry] of Object.entries(manifest.files)) {
    assert.match(entry.sha256 || '', /^[0-9a-f]{64}$/, `Missing file digest: ${name}`);
    assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && entry.bytes <= 20 * 1024 * 1024,
      `Invalid public file size: ${name}`);
    assert.equal(entry.mutable, manifest.mode === 'candidate' && name === 'stats.json',
      'Only candidate stats may change after packaging');
  }
  publicConfiguration(manifest.config, manifest.mode);
}

export function copySiteBundle(root, destination, manifest) {
  validateSiteManifest(manifest);
  assert.ok(!fs.existsSync(destination), 'Refusing to overwrite an existing site bundle');
  const bytes = new Map(publicFiles.map(name => [name, readContainedEvidence(root, `web/site/${name}`)]));
  for (const [name, data] of bytes) {
    assert.equal(data.length, manifest.files[name].bytes, `Public file size changed: ${name}`);
    assert.equal(sha256(data), manifest.files[name].sha256, `Public file changed: ${name}`);
  }
  fs.mkdirSync(destination, { recursive: true });
  for (const [name, data] of bytes) {
    const target = path.join(destination, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data, { flag: 'wx' });
    fs.utimesSync(target, 0, 0);
  }
  fs.writeFileSync(path.join(destination, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n',
    { flag: 'wx' });
  fs.utimesSync(path.join(destination, 'release-manifest.json'), 0, 0);
}
