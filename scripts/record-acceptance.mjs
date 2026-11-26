import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../helper/src/normalize.mjs';
import { readJson } from '../helper/src/state.mjs';
import { recordAcceptanceStep } from './acceptance-session.mjs';
import { readContainedEvidence, sha256, sourceSnapshot } from './evidence.mjs';
import { safePath } from './operational-monitor.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const { positional, options: o } = parseArgs(process.argv.slice(2));
  assert.equal(positional.length, 0);
  assert.deepEqual(Object.keys(o).sort(), ['output', 'patch', 'record']);
  const source = fs.readFileSync(safePath(path.resolve(o.record), { privateMode: true }));
  const patch = readJson(safePath(path.resolve(o.patch), { privateMode: true }), null);
  const output = path.resolve(o.output);
  safePath(path.dirname(output), { directory: true, privateMode: true });
  const snapshot = sourceSnapshot(root);
  const result = recordAcceptanceStep({ plan: JSON.parse(source), patch,
    config: readJson(path.join(root, 'config/build.json'), null), snapshotSha256: snapshot.sha256,
    readEvidence: p => readContainedEvidence(root, p) });
  assert.equal(sourceSnapshot(root).sha256, snapshot.sha256, 'Source changed during recording');
  const record = { ...result.plan, previousRecordSha256: sha256(source),
    recordedAt: new Date().toISOString() };
  const bytes = JSON.stringify(record, null, 2) + '\n';
  fs.writeFileSync(output, bytes, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: result.inspection.status,
    completedSteps: result.inspection.completedSteps, recordSha256: sha256(bytes),
    previousRecordSha256: record.previousRecordSha256,
    chainReceiptsIndependentlyVerified: false, participantIndependenceVerified: false,
    productionRelease: false }));
} catch {
  console.error(JSON.stringify({ status: 'blocked', code: 'ACCEPTANCE_RECORD_REFUSED',
    existingRecordModified: false, walletAccess: false, productionRelease: false }));
  process.exitCode = 2;
}
