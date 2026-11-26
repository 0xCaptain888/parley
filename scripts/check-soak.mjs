import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from '../helper/src/normalize.mjs';
import { readJson } from '../helper/src/state.mjs';
import { safePath } from './operational-monitor.mjs';
import { inspectOperationsSoak } from './operations-soak.mjs';

try {
  const { positional, options: o } = parseArgs(process.argv.slice(2));
  assert.equal(positional.length, 0);
  assert.deepEqual(Object.keys(o).sort(), ['build', 'logs']);
  safePath(o.logs, { directory: true, privateMode: true });
  const records = [];
  for (const name of fs.readdirSync(o.logs).filter(n => /^(resident|health|stats)\.jsonl(?:\.[1-9]\d?)?$/.test(n))) {
    const file = safePath(path.join(o.logs, name), { privateMode: true });
    assert.ok(fs.statSync(file).size <= 10 * 1024 * 1024, 'Oversized operational log');
    records.push(...fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)));
  }
  const report = inspectOperationsSoak({ records, build: readJson(safePath(o.build), null) });
  console.log(JSON.stringify(report, null, 2));
  if (report.status === 'incomplete') process.exitCode = 2;
} catch {
  console.error(JSON.stringify({ status: 'blocked', code: 'SOAK_INSPECTION_FAILED', productionRelease: false }));
  process.exitCode = 2;
}
