import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditContext } from './audit-context.mjs';
import { acceptancePlan } from './acceptance-plan.mjs';
import { sha256 } from './evidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.length !== 2) throw new Error('Usage: npm run prepare:acceptance');
const context = auditContext(root), build = JSON.parse(fs.readFileSync(path.join(root, 'config/build.json')));
const report = acceptancePlan(context.snapshot.sha256, { chainId: build.chainId, contract: build.contract,
  deploymentBlock: build.deploymentBlock, site: build.site });
report.createdAt = new Date().toISOString();
const relative = `docs/reports/acceptance-plan-${report.createdAt.replace(/[:.]/g, '-')}.json`;
const raw = JSON.stringify(report, null, 2) + '\n';
fs.writeFileSync(path.join(root, relative), raw, { flag: 'wx' });
console.log(JSON.stringify({ report: relative, reportSha256: sha256(raw), steps: report.steps.length,
  status: report.status, productionRelease: false }, null, 2));
