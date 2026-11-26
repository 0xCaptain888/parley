import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { auditContext } from './audit-context.mjs';
import { copySiteBundle, publicFiles, siteManifest } from './site-release.mjs';
import { localEnv, sha256, sourceSnapshot } from './evidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.ok(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--candidate'),
  'Usage: prepare-site.mjs [--candidate]');
const mode = process.argv[2] ? 'candidate' : 'staging';
const context = auditContext(root);
execFileSync(process.execPath, ['helper/build.mjs'], { cwd: root, env: localEnv(), stdio: 'pipe' });
const verification = JSON.parse(fs.readFileSync(path.join(root, context.verificationPointer.report)));
assert.equal(fs.readFileSync(path.join(root, 'skill/SHA256SUMS'), 'utf8'), verification.skillManifest,
  'Rebuilt Skill differs from full-verification artifacts');
const manifest = siteManifest(root, context.snapshot, mode);
const relative = `docs/reports/site-bundle-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const destination = path.join(root, relative, 'site');
copySiteBundle(root, destination, manifest);
const archive = path.join(root, relative, 'site.zip');
execFileSync('zip', ['-X', '-q', archive, ...[...publicFiles, 'release-manifest.json'].sort()], {
  cwd: destination,
});
assert.equal(sourceSnapshot(root).sha256, context.snapshot.sha256, 'Sources changed during site packaging');
console.log(JSON.stringify({ mode, directory: `${relative}/site`, archive: `${relative}/site.zip`,
  archiveSha256: sha256(fs.readFileSync(archive)), snapshotSha256: context.snapshot.sha256,
  publicHosting: false, cleanMachineSkillInstall: false, productionRelease: false }, null, 2));
