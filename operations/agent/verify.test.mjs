import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyLock, verifySkill } from './verify.mjs';

const pins = { packages: { 'node_modules/host': { version: '1', integrity: 'sha512-good' } } };
const lock = () => ({ lockfileVersion: 3, packages: {
  '': {},
  'node_modules/host': { version: '1', integrity: 'sha512-good', resolved: 'https://registry.npmjs.org/host/-/host-1.tgz' }
} });
test('accepts exact package and registry pins', () => assert.doesNotThrow(() => verifyLock(lock(), pins)));
test('rejects version drift', () => {
  const l = lock(); l.packages['node_modules/host'].version = '2';
  assert.throws(() => verifyLock(l, pins), /pin mismatch/);
});
test('rejects integrity drift', () => {
  const l = lock(); l.packages['node_modules/host'].integrity = 'sha512-other';
  assert.throws(() => verifyLock(l, pins), /pin mismatch/);
});
test('rejects dependency URL substitution', () => {
  const l = lock(); l.packages['node_modules/host'].resolved = 'https://evil.invalid/a';
  assert.throws(() => verifyLock(l, pins), /non-registry/);
});
test('rejects linked dependency', () => {
  const l = lock(); l.packages['node_modules/host'].link = true;
  assert.throws(() => verifyLock(l, pins), /Unpinned/);
});
test('rejects dependency without integrity', () => {
  const l = lock(); l.packages['node_modules/extra'] = { resolved: 'https://registry.npmjs.org/extra' };
  assert.throws(() => verifyLock(l, pins), /Unpinned/);
});
test('accepts bundled dependencies covered by a verified parent tarball', () => {
  const l = lock();
  l.packages['node_modules/host/node_modules/child'] = { version: '1', inBundle: true };
  assert.doesNotThrow(() => verifyLock(l, pins));
});
test('rejects bundled dependency outside a verified parent', () => {
  const l = lock(); l.packages['node_modules/orphan'] = { version: '1', inBundle: true };
  assert.throws(() => verifyLock(l, pins), /lacks verified archive/);
});
test('verifies skill bytes and rejects tampering and symlinks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'parley-agent-test-'));
  try {
    const body = 'test';
    const p = { files: { 'SKILL.md': createHash('sha256').update(body).digest('hex') } };
    await writeFile(join(dir, 'SKILL.md'), body);
    await verifySkill(dir, p);
    await writeFile(join(dir, 'SKILL.md'), 'tampered');
    await assert.rejects(verifySkill(dir, p), /digest mismatch/);
    await rm(join(dir, 'SKILL.md'));
    await writeFile(join(dir, 'target'), body);
    await symlink(join(dir, 'target'), join(dir, 'SKILL.md'));
    await assert.rejects(verifySkill(dir, p), /standalone/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
