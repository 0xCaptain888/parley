import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { sha256, sourceSnapshot } from '../../scripts/evidence.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
assert.equal(process.argv.length, 3);
const output = path.resolve(process.argv[2]);
assert.ok(!fs.existsSync(output), 'Exclusive output required');
const directory = path.join(output, 'telegram');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
await build({ entryPoints: [path.join(here, 'telegram-watch.mjs')], bundle: true,
  platform: 'node', format: 'esm', target: 'node24', outfile: path.join(directory, 'telegram-watch.mjs') });
for (const file of ['telegram-alert.mjs', 'telegram-cli.mjs'])
  fs.copyFileSync(path.join(root, 'scripts', file), path.join(directory, file));
for (const file of ['enter-telegram.sh', 'install-telegram.sh', 'parley-telegram.service', 'parley-telegram.timer'])
  fs.copyFileSync(path.join(here, file), path.join(directory, file));
const files = Object.fromEntries(fs.readdirSync(directory).sort().map(file =>
  [file, sha256(fs.readFileSync(path.join(directory, file)))]));
fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({
  schemaVersion: 1, sourceSnapshotSha256: sourceSnapshot(root).sha256, files,
  scope: 'Staging-monitor Telegram adapter; no business deployment, wallet access or model call',
}, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
fs.writeFileSync(path.join(directory, 'SHA256SUMS'), [...Object.keys(files), 'manifest.json'].sort()
  .map(file => `${sha256(fs.readFileSync(path.join(directory, file)))}  ${file}\n`).join(''),
{ flag: 'wx', mode: 0o600 });
const archive = path.join(output, 'parley-telegram-2026-11-26.tar.gz');
execFileSync('tar', ['-czf', archive, '-C', output, 'telegram'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
console.log(JSON.stringify({ archive, sha256: sha256(fs.readFileSync(archive)),
  credentialsIncluded: false, installed: false, messageSent: false }));
