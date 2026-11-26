import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs } from '../helper/src/normalize.mjs';
import { readJson } from '../helper/src/state.mjs';
import { readContainedEvidence, sourceSnapshot, localEnv } from './evidence.mjs';
import { inspectPublication, writePublication } from './publication-plan.mjs';
import { inspectHosting } from './hosting-evidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const { positional, options: o } = parseArgs(process.argv.slice(2));
  assert.equal(positional.length, 1);
  const snapshot = sourceSnapshot(root);
  if (positional[0] === 'plan') {
    assert.deepEqual(Object.keys(o).filter(k => k !== 'stats').sort(), ['manifest', 'origin', 'project']);
    const manifest = JSON.parse(readContainedEvidence(root, o.manifest));
    const base = path.posix.dirname(o.manifest);
    const stats = o.stats ? readJson(path.resolve(o.stats), null) : null;
    if (o.stats) assert.ok(stats, 'Statistics file is missing');
    const prepared = inspectPublication({ root, manifest, snapshotSha256: snapshot.sha256,
      origin: o.origin, project: o.project, readFile: name => readContainedEvidence(root, `${base}/${name}`),
      stats });
    const relative = `docs/reports/publication-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const site = path.join(root, relative, 'site');
    writePublication(site, prepared);
    const report = { ...prepared.report, site: `${relative}/site`,
      command: ['wrangler', 'pages', 'deploy', site, '--project-name', o.project, '--branch', 'main'] };
    fs.writeFileSync(path.join(root, relative, 'report.json'), JSON.stringify(report, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ ...report, plan: `${relative}/report.json` }, null, 2));
  } else {
    assert.equal(positional[0], 'execute');
    assert.deepEqual(Object.keys(o).sort(), ['consent-digest', 'plan']);
    const report = JSON.parse(readContainedEvidence(root, o.plan));
    assert.equal(report.status, 'prepared-not-uploaded');
    assert.equal(report.publicationDigest, o['consent-digest'], 'Explicit exact-bundle publication consent required');
    assert.equal(report.site, `${path.posix.dirname(o.plan)}/site`, 'Unexpected publication directory');
    const manifest = JSON.parse(readContainedEvidence(root, `${report.site}/release-manifest.json`));
    const prepared = inspectPublication({ root, manifest, snapshotSha256: snapshot.sha256,
      project: report.project, origin: report.origin,
      readFile: name => readContainedEvidence(root, `${report.site}/${name}`) });
    assert.equal(prepared.report.publicationDigest, report.publicationDigest, 'Publication plan bytes changed');
    const actual = [];
    const walk = relative => {
      for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
        if (entry.isDirectory()) walk(`${relative}/${entry.name}`);
        else { assert.ok(entry.isFile(), 'Nonregular publication file'); actual.push(`${relative}/${entry.name}`.slice(report.site.length + 1)); }
      }
    };
    walk(report.site);
    assert.deepEqual(actual.sort(), Object.keys(prepared.entries).sort(), 'Unexpected files in upload directory');
    if (prepared.report.requiresProductionGate)
      execFileSync(process.execPath, ['scripts/release-check.mjs'], { cwd: root, env: localEnv(), stdio: 'pipe' });
    assert.equal(sourceSnapshot(root).sha256, snapshot.sha256);
    execFileSync('wrangler', ['pages', 'deploy', path.join(root, report.site),
      '--project-name', report.project, '--branch', 'main'],
    { cwd: root, timeout: 300000, stdio: 'pipe', maxBuffer: 4 * 1024 * 1024 });
    // An upload success alone is not hosting acceptance. Leave failures visible in the report.
    let hosting;
    try { hosting = await inspectHosting({ origin: report.origin, manifest }); }
    catch { hosting = { status: 'failed', note: 'Upload returned success, public hosting inspection failed' }; }
    const result = { schemaVersion: 1, status: hosting.status === 'passed' ? 'uploaded-and-http-checked' : 'uploaded-needs-hosting-recheck',
      origin: report.origin, publicationDigest: report.publicationDigest, uploadedAt: new Date().toISOString(),
      publicUpload: true, hosting, browserAcceptance: false, productionRelease: false };
    fs.writeFileSync(path.join(root, path.posix.dirname(o.plan), `upload-${Date.now()}.json`),
      JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify(result, null, 2));
    if (hosting.status !== 'passed') process.exitCode = 2;
  }
} catch {
  console.error(JSON.stringify({ status: 'blocked-or-failed', code: 'PUBLICATION_FAILED',
    note: 'Check current bundle, exact consent digest, release prerequisites and authorized Wrangler login; inspect provider deployment history before retrying an interrupted upload',
    productionRelease: false }));
  process.exitCode = 2;
}
