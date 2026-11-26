import { createHash } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifyLock(lock, pins) {
  if (lock.lockfileVersion !== 3) throw new Error('Expected npm lockfile v3');
  for (const [path, pin] of Object.entries(pins.packages)) {
    const entry = lock.packages?.[path];
    if (entry?.version !== pin.version || entry?.integrity !== pin.integrity) {
      throw new Error(`Package pin mismatch: ${path}`);
    }
  }
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    if (entry.inBundle && !entry.link) {
      let ancestor = path;
      let contained = false;
      while (ancestor.includes('/node_modules/')) {
        ancestor = ancestor.slice(0, ancestor.lastIndexOf('/node_modules/'));
        const parent = lock.packages[ancestor];
        if (!parent) break;
        if (parent.integrity?.startsWith('sha512-') &&
            parent.resolved?.startsWith('https://registry.npmjs.org/') && !parent.link) {
          contained = true;
          break;
        }
        if (!parent.inBundle) break;
      }
      if (contained) continue;
      throw new Error(`Bundled dependency lacks verified archive: ${path}`);
    }
    if (entry.link || !entry.integrity?.startsWith('sha512-') ||
        !entry.resolved?.startsWith('https://registry.npmjs.org/')) {
      throw new Error(`Unpinned or non-registry dependency: ${path}`);
    }
  }
}

export async function verifySkill(root, pins) {
  for (const [name, expected] of Object.entries(pins.files)) {
    if (!['SKILL.md', 'parley.mjs'].includes(name)) throw new Error('Invalid skill filename');
    const path = resolve(root, name);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      throw new Error(`Not a standalone regular file: ${name}`);
    }
    const actual = createHash('sha256').update(await readFile(path)).digest('hex');
    if (actual !== expected) throw new Error(`Skill digest mismatch: ${name}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] || '.');
  const pins = JSON.parse(await readFile(resolve(root, 'pins.json'), 'utf8'));
  verifyLock(JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8')), pins);
  if (process.argv[3]) await verifySkill(resolve(process.argv[3]), pins);
  console.log('PINNED_ARTIFACTS_OK');
}
