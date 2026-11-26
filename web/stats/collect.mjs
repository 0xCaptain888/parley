import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collect } from './collect-core.mjs';
import { stringify } from '../../helper/src/calls.mjs';

export { collect };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config/build.json'), 'utf8'));
  try { console.log(stringify(await collect(config, { rpc: process.env.STATS_RPC }))); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
