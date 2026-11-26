import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { sha256, sourceSnapshot } from '../../scripts/evidence.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
export const runtimeEntries = ['scripts/ops-job.mjs', 'resident/resident.mjs',
  'scripts/resident-ops.mjs', 'scripts/stats-runner.mjs'];

export async function packageBusiness(output) {
  assert.ok(path.isAbsolute(output) && !fs.existsSync(output), 'Exclusive absolute output required');
  const snapshot = sourceSnapshot(root), directory = path.join(output, 'business');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const entry of runtimeEntries) {
    await build({ entryPoints: [path.join(root, entry)], outfile: path.join(directory, entry),
      bundle: true, platform: 'node', target: 'node24', format: 'esm', legalComments: 'inline' });
  }
  // Unconfigured builds cannot run business jobs. Final configuration is a separate reviewed step.
  fs.mkdirSync(path.join(directory, 'config'), { mode: 0o700 });
  fs.copyFileSync(path.join(root, 'config/build.json'), path.join(directory, 'config/build.json'));
  for (const name of ['install-business.sh', 'README.md'])
    fs.copyFileSync(path.join(here, name), path.join(directory, name));
  const names = [...runtimeEntries, 'config/build.json', 'install-business.sh', 'README.md'].sort();
  const files = Object.fromEntries(names.map(name => [name, sha256(fs.readFileSync(path.join(directory, name)))]));
  assert.equal(sourceSnapshot(root).sha256, snapshot.sha256, 'Source changed during packaging');
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({
    schemaVersion: 1, sourceSnapshotSha256: snapshot.sha256, files,
    finalDeploymentConfigured: !!JSON.parse(fs.readFileSync(path.join(directory, 'config/build.json'))).contract,
    scope: 'Manual proposal queue, health and local statistics; no scheduled signing or public upload',
    installed: false, servicesStarted: false, productionRelease: false,
  }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(directory, 'SHA256SUMS'), [...names, 'manifest.json'].sort().map(name =>
    `${sha256(fs.readFileSync(path.join(directory, name)))}  ${name}\n`).join(''),
  { flag: 'wx', mode: 0o600 });
  const archive = path.join(output, 'parley-business-runtime.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', output, 'business'],
    { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  return { archive, sha256: sha256(fs.readFileSync(archive)), sourceSnapshotSha256: snapshot.sha256,
    credentialsIncluded: false, installed: false, servicesStarted: false, productionRelease: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, 'Explicit new output directory required');
  console.log(JSON.stringify(await packageBusiness(path.resolve(process.argv[2]))));
}
