import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeChain } from '../helper/src/chain.mjs';
import { currentBuild } from './build-info.mjs';
import { inspectDeployment } from './deployment-evidence.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
const file=process.argv[2];
if(!file)throw new Error('Usage: node scripts/post-deploy.mjs <deployment.json>');
const d=JSON.parse(fs.readFileSync(file,'utf8')),a=d.constructorArgs;
if(!Array.isArray(a)||a.length!==7)throw new Error('Invalid deployment record');
const config={chainId:d.chainId,contract:d.address,registry:a[0],rpcs:[process.env.BSC_RPC||'https://bsc-dataseed.binance.org'],tokens:{},multicall:null};
const chain=makeChain(config);
const report = await inspectDeployment({ client: chain.client, build: currentBuild(root), record: d,
  intendedConfig: d.chainId === 56 ? JSON.parse(fs.readFileSync(path.join(root, 'config/build.json'))) : undefined,
  minimumConfirmations: d.chainId === 31337 ? 0 : 12 });
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'passed') process.exitCode = 1;
} catch {
  console.log(JSON.stringify({ status: 'failed', code: 'DEPLOYMENT_INSPECTION_FAILED',
    note: 'Check record, compiled source, canonical block, runtime and constructor parameters; raw RPC errors omitted',
    mainnetBroadcast: false, productionRelease: false }));
  process.exitCode = 1;
}
