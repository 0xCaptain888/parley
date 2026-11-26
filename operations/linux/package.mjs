import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { sha256, sourceSnapshot } from '../../scripts/evidence.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const destination = path.resolve(process.argv[2] || '');
assert.ok(process.argv[2] && !fs.existsSync(destination));
const snapshot = sourceSnapshot(root);
const releasePath = 'docs/reports/publication-2026-11-24T01-28-11-438Z/site/release-manifest.json';
const release = fs.readFileSync(path.join(root, releasePath));
assert.equal(JSON.parse(release).sourceSnapshotSha256, snapshot.sha256);
fs.mkdirSync(path.join(destination, 'lib'), { recursive: true });
for (const file of ['monitor.mjs', 'parley-monitor.service', 'parley-monitor.timer', 'install.sh'])
  fs.copyFileSync(path.join(here, file), path.join(destination, file));
for (const file of ['hosting-evidence.mjs', 'site-release.mjs', 'evidence.mjs'])
  fs.copyFileSync(path.join(root, 'scripts', file), path.join(destination, 'lib', file));
fs.writeFileSync(path.join(destination, 'release-manifest.json'), release, { flag: 'wx' });
const names = ['monitor.mjs', 'parley-monitor.service', 'parley-monitor.timer', 'release-manifest.json',
  'lib/hosting-evidence.mjs', 'lib/site-release.mjs', 'lib/evidence.mjs'];
const files = Object.fromEntries(names.sort().map(name => [name, sha256(fs.readFileSync(path.join(destination, name)))]));
fs.writeFileSync(path.join(destination, 'bundle.json'), JSON.stringify({
  schemaVersion: 1, applicationSnapshotSha256: snapshot.sha256, files,
  scope: 'Separately versioned Linux staging monitor; prior application review does not cover this adapter',
}, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(path.join(destination, 'SHA256SUMS'), [...names, 'bundle.json', 'install.sh'].sort()
  .map(name => `${sha256(fs.readFileSync(path.join(destination, name)))}  ${name}\n`).join(''), { flag: 'wx' });
console.log(JSON.stringify({ destination, applicationSnapshotSha256: snapshot.sha256,
  bundleSha256: sha256(fs.readFileSync(path.join(destination, 'bundle.json'))) }));
