import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'docs/reports');
fs.mkdirSync(directory, { recursive: true });
const summary = [];
for (const [name, cwd] of [['runtime', root], ['contracts-dev', path.join(root, 'contracts')]]) {
  const result = spawnSync('npm', ['audit', '--json'], {
    cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
  });
  let report;
  try { report = JSON.parse(result.stdout); }
  catch { throw new Error(`No valid audit JSON for ${name}: ${result.stderr}`); }
  if (!report.metadata || report.error) throw new Error(`Audit unavailable for ${name}: ${result.stderr}`);
  fs.writeFileSync(path.join(directory, `npm-audit-${name}.json`), JSON.stringify(report, null, 2) + '\n');
  const vulnerabilities = report.metadata.vulnerabilities;
  summary.push({ name, vulnerabilities, exit: result.status });
  console.log(`${name}: ${JSON.stringify(vulnerabilities)}`);
}
fs.writeFileSync(path.join(directory, 'dependency-audit.json'), JSON.stringify({
  checkedAt: new Date().toISOString(), summary,
  note: 'npm advisory data is not a source-code audit. Contract dev dependencies are not shipped in the Skill.',
}, null, 2) + '\n');
