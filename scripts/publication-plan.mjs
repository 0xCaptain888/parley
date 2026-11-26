import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './evidence.mjs';
import { publicFiles, validateSiteManifest, httpsOrigin } from './site-release.mjs';

export function inspectPublication({ root, manifest, snapshotSha256, project, origin, readFile, stats = null,
  now = Math.floor(Date.now() / 1000) }) {
  validateSiteManifest(manifest);
  assert.equal(manifest.sourceSnapshotSha256, snapshotSha256, 'Cannot publish a stale source bundle');
  assert.ok(/^[a-z0-9][a-z0-9-]{0,57}[a-z0-9]$/.test(project), 'Explicit Cloudflare Pages project required');
  assert.equal(httpsOrigin(origin), origin);
  assert.equal(origin, `https://${project}.pages.dev`, 'Project must match the authorized free Pages origin');
  assert.equal(manifest.config.site, origin, 'Bundle origin differs from publication target');
  const entries = {};
  for (const name of publicFiles) {
    const raw = readFile(name);
    assert.equal(raw.length, manifest.files[name].bytes, `Publication length mismatch: ${name}`);
    assert.equal(sha256(raw), manifest.files[name].sha256, `Publication digest mismatch: ${name}`);
    entries[name] = raw;
  }
  if (stats !== null) {
    assert.equal(manifest.mode, 'candidate', 'Staging cannot publish real metrics');
    assert.equal(stats.contract?.toLowerCase(), manifest.config.contract.toLowerCase(), 'Stats deployment mismatch');
    assert.ok(Number.isSafeInteger(stats.block) && stats.block >= manifest.config.deploymentBlock);
    assert.match(stats.blockHash || '', /^0x[0-9a-f]{64}$/i);
    assert.ok(Number.isSafeInteger(stats.updatedAt) && stats.updatedAt <= now && now - stats.updatedAt <= 1200,
      'Only fresh confirmed statistics may be published');
    assert.deepEqual(stats.excluded.map(a => a.toLowerCase()).sort(), manifest.config.excluded.map(a => a.toLowerCase()).sort());
    // Only collector-schema fields are copied; arbitrary input fields cannot leak private data.
    const keys = ['updatedAt', 'block', 'blockHash', 'contract', 'members', 'mail', 'packets', 'requests',
      'offers', 'retention', 'pairs', 'daily', 'excluded'];
    assert.deepEqual(Object.keys(stats).sort(), keys.sort(), 'Unknown statistics field refused');
    const template = {
      mail: ['text', 'deal'], packets: ['created', 'claims', 'claimsThatOpenedMailbox', 'bnb'],
      requests: ['created', 'paid'], offers: ['created', 'settled', 'publicCreated'],
      retention: ['secondAction', 'repliedAfterClaim', 'secondActionMembers', 'repliedClaimers', 'claimers'],
    };
    for (const [key, fields] of Object.entries(template))
      assert.deepEqual(Object.keys(stats[key] || {}).sort(), fields.sort(), 'Unknown statistics subfield');
    for (const field of ['members', 'pairs', ...Object.keys(template)]) {
      const values = typeof stats[field] === 'object' ? Object.values(stats[field]) : [stats[field]];
      assert.ok(values.every(v => typeof v === 'number' ? Number.isFinite(v) && v >= 0
        : typeof v === 'string' && /^(0|[1-9]\d*)$/.test(v)), 'Invalid statistics count');
    }
    assert.ok(Array.isArray(stats.daily) && stats.daily.length <= 10000);
    for (const day of stats.daily) {
      assert.deepEqual(Object.keys(day).sort(), ['date', 'newMembers', 'activeMembers', 'settled'].sort());
      assert.match(day.date || '', /^\d{4}-\d\d-\d\d$/);
      assert.ok(['newMembers', 'activeMembers', 'settled'].every(k => Number.isSafeInteger(day[k]) && day[k] >= 0));
    }
    entries['stats.json'] = Buffer.from(JSON.stringify(stats, null, 2) + '\n');
  }
  const updated = { ...manifest, files: Object.fromEntries(publicFiles.map(name => [name, {
    ...manifest.files[name], bytes: entries[name].length, sha256: sha256(entries[name]),
  }])) };
  entries['release-manifest.json'] = Buffer.from(JSON.stringify(updated, null, 2) + '\n');
  const digests = Object.fromEntries(Object.keys(entries).sort().map(name => [name, sha256(entries[name])]));
  return { report: { schemaVersion: 1, status: 'prepared-not-uploaded', project, origin,
    sourceSnapshotSha256: snapshotSha256, mode: manifest.mode, files: digests,
    publicationDigest: sha256(JSON.stringify(digests)), statsUpdated: stats !== null,
    requiresProductionGate: manifest.mode === 'candidate', publicUpload: false, productionRelease: false }, entries };
}

export function writePublication(directory, prepared) {
  assert.ok(path.isAbsolute(directory) && !fs.existsSync(directory), 'New publication directory required');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const [name, bytes] of Object.entries(prepared.entries)) {
    assert.ok([...publicFiles, 'release-manifest.json'].includes(name), 'Nonpublic file refused');
    const target = path.join(directory, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes, { mode: 0o600, flag: 'wx' });
  }
}
