import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { inspectHosting } from './hosting-evidence.mjs';
import { readContainedEvidence, sha256, sourceSnapshot } from './evidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(process.argv.length, 4, 'Usage: check-hosting.mjs <HTTPS-origin> <project-relative-manifest>');
const manifestRaw = readContainedEvidence(root, process.argv[3]);
const manifest = JSON.parse(manifestRaw);
const snapshot = sourceSnapshot(root);
assert.equal(manifest.sourceSnapshotSha256, snapshot.sha256, 'Site manifest does not cover current sources');
const report = await inspectHosting({ origin: process.argv[2], manifest });
assert.equal(sourceSnapshot(root).sha256, snapshot.sha256, 'Sources changed during hosting checks');
report.manifestFileSha256 = sha256(manifestRaw);
const relative = `docs/reports/hosting-${report.checkedAt.replace(/[:.]/g, '-')}.json`;
fs.writeFileSync(path.join(root, relative), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ report: relative, status: report.status, checks: report.checks,
  cleanMachineSkillInstall: false, productionRelease: false }, null, 2));
process.exitCode = report.status === 'passed' ? 0 : 1;
