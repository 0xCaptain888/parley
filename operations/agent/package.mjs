import { readFile, readdir, mkdir, copyFile, lstat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { verifyLock } from './verify.mjs';

const source = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.argv[2]);
const wallet = resolve(process.argv[3]);
const root = join(output, 'agent');
await mkdir(output, { recursive: true, mode: 0o700 });
await mkdir(root, { recursive: false, mode: 0o700 });
const pins = JSON.parse(await readFile(join(source, 'pins.json'), 'utf8'));
verifyLock(JSON.parse(await readFile(join(source, 'package-lock.json'), 'utf8')), pins);
const files = ['package.json', 'package-lock.json', 'pins.json', 'verify.mjs',
  'verify.test.mjs', 'install.sh', 'repair-lifecycle.sh', 'agent.sh', 'accept.mjs',
  'relay.mjs', 'relay.test.mjs', 'enter-relay-key.sh', 'README.md', 'RELAY.md',
  'oneshot.mjs', 'oneshot.test.mjs', 'ONESHOT.md', 'wallet-storage.mjs', 'wallet-storage.test.mjs',
  'enter-telegram.sh', 'prepare-wallet-storage.sh'];
for (const file of files) await copyFile(join(source, file), join(root, file));
await copyFile(join(source, '../../scripts/telegram-alert.mjs'), join(root, 'telegram-alert.mjs'));
files.push('telegram-alert.mjs');
await copyFile(join(source, '../../scripts/telegram-cli.mjs'), join(root, 'telegram-cli.mjs'));
files.push('telegram-cli.mjs');
await mkdir(join(root, 'wallet-skill/references'), { recursive: true, mode: 0o700 });
const walletFiles = ['SKILL.md'];
for (const entry of await readdir(join(wallet, 'references'), { withFileTypes: true })) {
  if (!entry.isFile() || !/^[a-z0-9-]+\.md$/.test(entry.name)) throw new Error('Unexpected wallet reference');
  walletFiles.push(`references/${entry.name}`);
}
for (const file of walletFiles.sort()) {
  const stat = await lstat(join(wallet, file));
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024) throw new Error('Invalid public wallet document');
  await copyFile(join(wallet, file), join(root, 'wallet-skill', file));
  files.push(`wallet-skill/${file}`);
}
const sums = [];
for (const file of files.sort()) {
  const hash = createHash('sha256').update(await readFile(join(root, file))).digest('hex');
  sums.push(`${hash}  ${file}`);
}
await writeFile(join(root, 'SHA256SUMS'), `${sums.join('\n')}\n`, { mode: 0o600, flag: 'wx' });
const archive = join(output, 'parley-agent-host-2026-11-26.tar.gz');
execFileSync('tar', ['-czf', archive, '-C', output, 'agent'], {
  env: { ...process.env, COPYFILE_DISABLE: '1' }
});
const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(`${archive}.sha256`, `${sha256}  ${archive.split('/').at(-1)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ archive, sha256, files: files.length, credentialsIncluded: false }, null, 2));
