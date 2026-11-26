import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs } from '../helper/src/normalize.mjs';
import { readJson } from '../helper/src/state.mjs';
import { sourceSnapshot, readContainedEvidence, sha256 } from './evidence.mjs';
import { currentBuild } from './build-info.mjs';
import { deploymentPlan } from './deployment-plan.mjs';
import { inspectAcceptance } from './acceptance-evidence.mjs';
import { checkSkillInstall } from './install-check.mjs';
import { residentServicePlan, linuxResidentServicePlan } from './resident-service.mjs';
import { inspectWallet } from './wallet-inspection.mjs';
import { createPublicClient, http } from 'viem';
import { httpsOrigin } from './site-release.mjs';
import { inspectAcceptanceChain } from './acceptance-chain.mjs';
import { inspectDeploymentReadiness } from './deployment-readiness.mjs';
import { submissionPlan } from './submission-plan.mjs';
import { safePath } from './operational-monitor.mjs';
import { walletEnvironment } from './wallet-runtime.mjs';
import { inspectDeploymentInputs } from './deployment-inputs.mjs';
import { acceptanceSession } from './acceptance-session.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { positional, options } = parseArgs(process.argv.slice(2));
const modes = {
  deployment: ['intent'], parameters: ['intent'], acceptance: ['record'], 'acceptance-session': ['record'],
  install: ['origin', 'manifest'], resident: ['config', 'build', 'state-dir', 'logs'],
  'resident-linux': ['config', 'build', 'state-dir', 'logs'], wallet: [],
  'acceptance-chain': ['record', 'rpc'], 'deployment-rpc': ['intent', 'rpc'], submission: ['input'],
};
const mode = positional[0];
assert.ok(positional.length === 1 && Object.hasOwn(modes, mode), 'Choose a documented launch mode');
assert.deepEqual(Object.keys(options).filter(k => !(mode === 'wallet' && k === 'runtime')).sort(),
  modes[mode].sort(), 'Explicit required options only; no defaults for operational inputs');
const snapshot = sourceSnapshot(root);
const config = readJson(path.join(root, 'config/build.json'), null);
const read = relative => readContainedEvidence(root, relative);
let report;
let walletStage = null;
const client = () => {
  httpsOrigin(options.rpc);
  return createPublicClient({ transport: http(options.rpc, { timeout: 15000, retryCount: 0 }) });
};
try {
if (mode === 'parameters') {
  report = inspectDeploymentInputs(readJson(path.resolve(options.intent), null), config);
  if (report.status === 'blocked') process.exitCode = 2;
} else if (mode === 'deployment' || mode === 'deployment-rpc') {
  report = deploymentPlan({ intent: readJson(path.resolve(options.intent), null),
    config, build: currentBuild(root), snapshotSha256: snapshot.sha256 });
  if (mode === 'deployment-rpc') report = await inspectDeploymentReadiness({
    plan: report, config, snapshotSha256: snapshot.sha256, client: client() });
} else if (mode === 'acceptance' || mode === 'acceptance-session') {
  report = (mode === 'acceptance' ? inspectAcceptance : acceptanceSession)({ plan: readJson(path.resolve(options.record), null),
    config, snapshotSha256: snapshot.sha256, readEvidence: read });
} else if (mode === 'acceptance-chain') {
  report = await inspectAcceptanceChain({ plan: readJson(path.resolve(options.record), null),
    config, snapshotSha256: snapshot.sha256, readEvidence: read, client: client() });
} else if (mode === 'submission') {
  report = submissionPlan({ input: readJson(path.resolve(options.input), null),
    snapshotSha256: snapshot.sha256, readEvidence: read });
} else if (mode === 'install') {
  const manifest = JSON.parse(read(options.manifest));
  // A historical deployed manifest may be tested, but never called current-source acceptance.
  report = await checkSkillInstall({ origin: options.origin, manifest,
    readTrusted: relative => read(`${path.posix.dirname(options.manifest)}/${relative}`) });
  report.currentSourceMatch = manifest.sourceSnapshotSha256 === snapshot.sha256;
} else if (mode === 'resident' || mode === 'resident-linux') {
  const buildPath = path.resolve(options.build), configPath = path.resolve(options.config);
  const residentConfig = readJson(configPath, null);
  const plan = mode === 'resident-linux' ? linuxResidentServicePlan : residentServicePlan;
  report = plan({ config: residentConfig, build: readJson(buildPath, null),
    operations: residentConfig?.operationsPath
      ? readJson(safePath(residentConfig.operationsPath, { privateMode: true }), null) : null,
    binding: readJson(path.join(path.resolve(options['state-dir']), 'deployment.json'), null),
    root: mode === 'resident-linux' ? '/opt/parley-business' : root,
    node: mode === 'resident-linux' ? '/opt/parley-runtime/bin/node' : process.execPath,
    configPath, buildPath, stateDir: path.resolve(options['state-dir']), logs: path.resolve(options.logs) });
} else {
  const env = walletEnvironment(options.runtime || process.execPath);
  report = await inspectWallet(async args => {
    walletStage = args.slice(0, 2).join('/');
    let result;
    try { result = execFileSync('baw', [...args, '--json'], {
      env, timeout: 15000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { throw new Error('Official wallet read failed; no raw output persisted'); }
    return JSON.parse(result);
  });
  report.runtime = fs.realpathSync(options.runtime || process.execPath);
}
} catch (error) {
  report = { schemaVersion: 1, status: 'blocked', code: `LAUNCH_${mode.toUpperCase()}_FAILED`,
    reason: walletStage ? `Official read failed at ${walletStage}; raw output omitted`
      : error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0]
      : 'Check explicit inputs and service connectivity; raw errors omitted',
    walletAccess: mode === 'wallet', mainnetBroadcast: false, productionRelease: false };
  process.exitCode = 2;
}
assert.equal(sourceSnapshot(root).sha256, snapshot.sha256, 'Source changed during operational preparation');
const directory = path.join(root, 'docs/reports', `launch-${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(directory, { mode: 0o700 });
if (report.jobs) {
  for (const [label, plist] of Object.entries(report.jobs))
    fs.writeFileSync(path.join(directory, `${label}.plist`), plist, { flag: 'wx', mode: 0o600 });
  report = { ...report, jobs: Object.keys(report.jobs) };
}
if (report.units) {
  for (const [name, unit] of Object.entries(report.units))
    fs.writeFileSync(path.join(directory, name), unit, { flag: 'wx', mode: 0o600 });
  report = { ...report, units: Object.keys(report.units) };
}
report.observedSourceSnapshotSha256 = snapshot.sha256;
const raw = JSON.stringify(report, null, 2) + '\n';
fs.writeFileSync(path.join(directory, 'report.json'), raw, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ report: path.relative(root, path.join(directory, 'report.json')),
  reportSha256: sha256(raw), status: report.status,
  mainnetBroadcast: false, productionRelease: false }, null, 2));
