import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { mode: 0o700 });
const directory = path.join(output, 'wallet-security');
fs.mkdirSync(directory, { mode: 0o700 });
const files = ['keyring-session.mjs', 'keyring-session.test.mjs', 'enter-keyring.sh',
  'unlock-keyring.sh', 'wallet-native-guard.cjs', 'wallet-secure.mjs', 'install-wallet-security.sh', 'KEYRING.md'];
const hashes = [];
for (const name of files) {
  const bytes = fs.readFileSync(path.join(root, name));
  fs.writeFileSync(path.join(directory, name), bytes, { flag: 'wx', mode: 0o600 });
  hashes.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
}
await build({ entryPoints: [path.join(root, 'wallet-preflight.mjs')],
  outfile: path.join(directory, 'wallet-preflight.mjs'), bundle: true,
  platform: 'node', target: 'node24', format: 'esm' });
hashes.push(`${createHash('sha256').update(fs.readFileSync(path.join(directory, 'wallet-preflight.mjs'))).digest('hex')}  wallet-preflight.mjs`);
fs.writeFileSync(path.join(directory, 'SHA256SUMS'), hashes.join('\n') + '\n', { flag: 'wx', mode: 0o600 });
const archive = path.join(output, 'parley-wallet-security-2026-11-26.tar.gz');
const result = spawnSync('tar', ['-czf', archive, '-C', output, 'wallet-security'],
  { stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' } });
assert.equal(result.status, 0);
console.log(JSON.stringify({ archive,
  sha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
  credentialsIncluded: false, walletTransactionsAllowed: false }));
