import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from '../helper/src/normalize.mjs';
import { readJson } from '../helper/src/state.mjs';
import { httpsOrigin } from './site-release.mjs';
import { collect } from '../web/stats/collect-core.mjs';

const { positional, options } = parseArgs(process.argv.slice(2));
try {
  assert.equal(positional.length, 0);
  assert.deepEqual(Object.keys(options).sort(), ['build', 'output', 'rpc', 'state-dir']);
  for (const key of ['build', 'output', 'state-dir']) assert.ok(path.isAbsolute(options[key]));
  const build = readJson(options.build, null);
  assert.ok(build?.chainId === 56 && build.contract && Number.isSafeInteger(build.deploymentBlock)
    && build.deploymentBlock > 0 && build.excluded?.length > 0, 'Final deployment/exclusions required');
  httpsOrigin(options.rpc);
  // Reject existing symlink ancestors before the collector creates directories.
  for (const target of [options.output, options['state-dir']]) {
    for (let p = target; p !== path.dirname(p); p = path.dirname(p))
      if (fs.existsSync(p)) assert.ok(!fs.lstatSync(p).isSymbolicLink(), 'Symlink output/state path refused');
  }
  const result = await collect(build, { rpc: options.rpc, output: options.output, state: options['state-dir'] });
  console.log(JSON.stringify({ status: 'collected-locally', block: result.block, blockHash: result.blockHash,
    updatedAt: result.updatedAt, publicUpload: false, walletAccess: false }));
} catch {
  console.error(JSON.stringify({ status: 'failed', code: 'STATS_COLLECTION_FAILED',
    publicUpload: false, walletAccess: false, note: 'Existing output is not replaced with fictional metrics' }));
  process.exitCode = 2;
}
