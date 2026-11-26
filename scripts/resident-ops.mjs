import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http } from 'viem';
import { parseArgs } from '../helper/src/normalize.mjs';
import { readJson } from '../helper/src/state.mjs';
import { healthReport, recoveryPlan, inspectTransaction, validateResidentBinding, migrationPlan, inspectClaimAnchor, inspectCampaigns } from '../resident/operations.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const { positional, options: opts } = parseArgs(process.argv.slice(2));
  if (positional.length !== 1 || !['health', 'recover', 'migrate'].includes(positional[0])) throw new Error('Usage');
  if (Object.keys(opts).some(k => !['config', 'build', 'state-dir', 'stats', 'queue', 'tx', 'rpc', 'binding', 'target-dir'].includes(k))) throw new Error('Unknown option');
  const config = readJson(path.resolve(opts.config || path.join(root, 'resident/config.local.json')), null);
  const build = readJson(path.resolve(opts.build || path.join(root, 'config/build.json')), null);
  if (!opts['state-dir']) throw new Error('Explicit --state-dir required; no state directory is created');
  const dir = path.resolve(opts['state-dir']);
  for (let p = dir; p !== path.dirname(p); p = path.dirname(p)) {
    if (fs.lstatSync(p).isSymbolicLink()) throw new Error('Unsafe state directory');
  }
  const file = path.join(dir, 'state.json');
  const state = readJson(file, null);
  const binding = validateResidentBinding(build, config?.from, readJson(
    opts.binding && positional[0] === 'migrate' ? path.resolve(opts.binding) : path.join(dir, 'deployment.json'), null));
  let report;
  const publicClient = () => {
    const url = new URL(opts.rpc);
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid RPC');
    return createPublicClient({ transport: http(opts.rpc, { timeout: 10000, retryCount: 0 }) });
  };
  if (positional[0] === 'health') {
    if (opts.tx || opts.queue) throw new Error('Health does not inspect transactions');
    report = healthReport({ config, build, state, stats: readJson(path.resolve(opts.stats || path.join(root, 'web/site/stats.json')), null),
      now: Math.floor(Date.now() / 1000), lockPresent: fs.existsSync(path.join(dir, '.lock')) });
    if (opts.rpc) {
      report.campaigns = await inspectCampaigns(publicClient(), build, config.from, state);
      if (report.campaigns.checks.some(c => c.status !== 'passed')) {
        report.exitCode = Math.max(report.exitCode, 1);
        if (report.status === 'healthy') report.status = 'warning';
      }
    }
    process.exitCode = report.exitCode;
  } else if (positional[0] === 'migrate') {
    if (!opts['target-dir'] || opts.rpc || opts.tx || opts.queue) throw new Error('Offline migration plan requires --target-dir');
    const target = path.resolve(opts['target-dir']);
    report = migrationPlan(state, fs.readFileSync(file), binding,
      { chainId: build.chainId, contract: build.contract.toLowerCase(), from: config.from.toLowerCase() }, fs.existsSync(target));
  } else {
    report = recoveryPlan(state, binding, fs.readFileSync(file));
    if (opts.tx || opts.queue || opts.rpc) {
      if (!opts.rpc || (!!opts.tx !== !!opts.queue)) throw new Error('Transaction recovery requires --queue, --tx and --rpc together');
      const client = publicClient();
      report.claimAnchor = await inspectClaimAnchor(client, build, state);
      if (opts.tx) {
        const q = state.queue.find(q => q.id === opts.queue);
        if (!q) throw new Error('Unknown queue');
        report.transaction = await inspectTransaction({ client, build, from: config.from, q, txHash: opts.tx });
      }
    }
  }
  console.log(JSON.stringify(report, null, 2));
} catch {
  console.log(JSON.stringify({ status: 'blocked', code: 'RESIDENT_INSPECTION_FAILED',
    note: 'Check explicit state directory, deployment manifest, configuration and canonical transaction; raw errors omitted',
    stateModified: false, walletAccess: false, mainnetBroadcast: false }));
  process.exitCode = 2;
}
