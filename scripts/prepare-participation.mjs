import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../helper/src/normalize.mjs';
import { readJson } from '../helper/src/state.mjs';
import { participationKit } from './participation-kit.mjs';
import { sourceSnapshot, sha256 } from './evidence.mjs';
import { safePath } from './operational-monitor.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const { positional, options: o } = parseArgs(process.argv.slice(2));
  assert.equal(positional.length, 0);
  assert.deepEqual(Object.keys(o).sort(), ['intent', 'output', 'participants']);
  const snapshot = sourceSnapshot(root);
  const result = participationKit({
    intent: readJson(safePath(path.resolve(o.intent)), null),
    participants: readJson(safePath(path.resolve(o.participants)), null),
    config: readJson(path.join(root, 'config/build.json'), null), snapshotSha256: snapshot.sha256,
  });
  const output = path.resolve(o.output);
  safePath(path.dirname(output), { directory: true });
  fs.mkdirSync(output, { mode: 0o700 });
  const hashes = {};
  for (const [relative, data] of Object.entries(result.files)) {
    const file = path.join(output, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const bytes = JSON.stringify(data, null, 2) + '\n';
    fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
    hashes[relative] = sha256(bytes);
  }
  assert.equal(sourceSnapshot(root).sha256, snapshot.sha256, 'Source changed during preparation');
  const { files: _files, ...report } = result;
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({
    ...report, sourceSnapshotSha256: snapshot.sha256, files: hashes,
  }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ ...report, filesPrepared: Object.keys(hashes).length,
    sourceSnapshotSha256: snapshot.sha256 }));
} catch {
  console.error(JSON.stringify({ status: 'blocked', code: 'PARTICIPATION_KIT_REFUSED',
    walletAccess: false, productionRelease: false }));
  process.exitCode = 2;
}
