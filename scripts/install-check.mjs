import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { httpsOrigin, validateSiteManifest } from './site-release.mjs';
import { sha256 } from './evidence.mjs';

export async function downloadExact(url, entry, fetcher = fetch) {
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, 'Download must return 200 without redirect');
  if (response.headers.get('content-length') !== null)
    assert.equal(Number(response.headers.get('content-length')), entry.bytes, 'Unexpected download length');
  const chunks = []; let size = 0;
  assert.ok(response.body, 'Empty download body');
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > entry.bytes) {
      await response.body.cancel?.().catch(() => {});
      throw new Error('Download exceeded manifest size');
    }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  assert.equal(bytes.length, entry.bytes, 'Truncated download');
  assert.equal(sha256(bytes), entry.sha256, 'Download digest differs from trusted local manifest');
  return bytes;
}

export function inspectSkillArchive(zip, files, envRoot) {
  const zipFile = path.join(envRoot, 'parley.zip');
  fs.writeFileSync(zipFile, zip, { flag: 'wx', mode: 0o600 });
  const run = args => execFileSync('unzip', args, { timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
  const entries = run(['-Z1', zipFile]).toString().trim().split('\n');
  assert.deepEqual(entries.sort(), ['SKILL.md', 'parley.mjs'], 'Archive contains unexpected or duplicate entries');
  for (const name of entries) {
    const bytes = run(['-p', zipFile, name]);
    assert.deepEqual(bytes, files[name], 'Archive and standalone download differ');
    // Write verified bytes ourselves; never let archive paths or symlinks control extraction.
    fs.writeFileSync(path.join(envRoot, name), bytes, { flag: 'wx', mode: 0o600 });
  }
}

export async function checkSkillInstall({ origin, manifest, readTrusted, fetcher = fetch, smoke = true }) {
  origin = httpsOrigin(origin);
  validateSiteManifest(manifest);
  const files = {};
  for (const name of ['SHA256SUMS', 'SKILL.md', 'parley.mjs', 'parley.zip']) {
    const relative = `skill/${name}`, entry = manifest.files[relative];
    const trusted = readTrusted(relative);
    assert.equal(sha256(trusted), entry.sha256, 'Local trusted Skill differs from manifest');
    files[name] = await downloadExact(`${origin}/${relative}`, entry, fetcher);
    assert.deepEqual(files[name], trusted, 'Downloaded Skill differs from trusted build');
  }
  const sums = files.SHA256SUMS.toString().trim().split('\n');
  assert.equal(sums.length, 3, 'Expected three checksums');
  const names = new Set();
  for (const line of sums) {
    const m = /^([0-9a-f]{64})  (SKILL\.md|parley\.mjs|parley\.zip)$/.exec(line);
    assert.ok(m && !names.has(m[2]), 'Invalid or duplicate checksum');
    names.add(m[2]);
    assert.equal(sha256(files[m[2]]), m[1], 'Checksum does not match download');
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parley-install-'));
  fs.chmodSync(dir, 0o700);
  try {
    inspectSkillArchive(files['parley.zip'], files, dir);
    if (smoke) {
      const home = path.join(dir, 'home'); fs.mkdirSync(home, { mode: 0o700 });
      const output = execFileSync(process.execPath, [path.join(dir, 'parley.mjs'), '--help'], {
        cwd: dir, timeout: 15000, maxBuffer: 1024 * 1024,
        env: { HOME: home, TMPDIR: dir, PATH: path.dirname(process.execPath), LANG: 'C', NODE_ENV: 'test' },
      }).toString();
      const help = JSON.parse(output);
      assert.ok(help.ok === true && help.command === 'help' && help.chainId === manifest.config.chainId
        && help.configured === !!manifest.config.contract, 'Downloaded helper returned unexpected help/configuration');
      assert.deepEqual(fs.readdirSync(home), [], 'Help unexpectedly wrote home state');
    }
    return { schemaVersion: 1, checkedAt: new Date().toISOString(), status: 'passed', origin,
      sourceSnapshotSha256: manifest.sourceSnapshotSha256,
      artifactSha256: Object.fromEntries(Object.entries(files).map(([n, b]) => [n, sha256(b)])),
      checks: ['bounded-HTTPS-downloads', 'trusted-local-byte-parity', 'all-checksums',
        'exact-archive-members', 'archive-content-parity', ...(smoke ? ['isolated-help-startup'] : [])],
      scope: 'Fresh temporary HOME on this host; not a separate clean machine or agent-host skill registration',
      freshHomeSmoke: smoke, cleanMachineSkillInstall: false,
      walletAccess: false, mainnetBroadcast: false, productionRelease: false };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
