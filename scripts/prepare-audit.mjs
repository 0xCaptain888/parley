import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditContext } from './audit-context.mjs';
import { auditRequest } from './audit-request.mjs';
import { readContainedEvidence, sha256, validateAuditBinding } from './evidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const context = auditContext(root);
if (process.argv[2] === '--validate') {
  const raw = readContainedEvidence(root, process.argv[3]);
  validateAuditBinding({ snapshotSha256: context.snapshot.sha256, reportSha256: sha256(raw) },
    JSON.parse(raw), context.snapshot, raw, context);
  console.log('Audit evidence structure and integrity passed. Reviewer provenance still requires human verification.');
} else {
  if (process.argv.length > 2) throw new Error('Usage: prepare-audit.mjs [--validate <project-relative-report>]');
  const report = auditRequest(context);
  const relative = `docs/reports/audit-request-${report.createdAt.replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(path.join(root, relative), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ report: relative, reportSha256: sha256(fs.readFileSync(path.join(root, relative))),
    findings: report.findings.length, observations: report.observations.length,
    independentAudit: 'pending', productionRelease: false }, null, 2));
}
