import assert from 'node:assert/strict';
import path from 'node:path';
import { zeroAddress } from 'viem';
import { amount, address } from '../helper/src/normalize.mjs';
import { httpsOrigin } from './site-release.mjs';
import { validateResidentBinding } from '../resident/operations.mjs';
import { sha256 } from './evidence.mjs';
import { validateOperations } from './operational-monitor.mjs';

const xml = value => String(value).replace(/[<>&"']/g, c =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
const absolute = p => assert.ok(typeof p === 'string' && path.isAbsolute(p) && !/[\x00-\x1f]/.test(p),
  'Explicit absolute filesystem path required');
const job = (label, args, cwd, logs, interval) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array>${args.map(a => `<string>${xml(a)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(cwd)}</string>
<key>RunAtLoad</key><false/>
<key>StartInterval</key><integer>${interval}</integer>
<key>ProcessType</key><string>Background</string>
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>/dev/null</string>
<key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>
`;

export function residentServicePlan({ config, build, binding, root, node, configPath, buildPath,
  stateDir, logs, operations = null, now = Math.floor(Date.now() / 1000) }) {
  for (const p of [root, node, configPath, buildPath, stateDir, logs]) absolute(p);
  assert.equal(config.mode, 'manual', 'Only manual per-proposal execution is allowed');
  validateResidentBinding(build, config.from, binding);
  assert.equal(build.chainId, 56, 'Resident service must target BSC');
  assert.ok(address(config.from) !== zeroAddress, 'Zero resident wallet');
  assert.notEqual(address(build.contract), zeroAddress, 'Zero resident contract');
  if (config.stateRoot) absolute(config.stateRoot);
  assert.equal(stateDir, path.join(config.stateRoot || path.join(root, 'resident/state'),
    `${build.chainId}-${build.contract.slice(2, 10).toLowerCase()}`, address(config.from)), 'Health state differs from resident state');
  assert.ok(config.home && path.isAbsolute(config.home), 'Explicit private helper home required');
  assert.ok(/^[a-z0-9]{1,64}$/.test(build.resident || ''), 'Resident handle required');
  assert.ok(build.excluded?.some(a => address(a) === address(config.from)), 'Exclude resident from public growth');
  assert.equal(httpsOrigin(build.site), build.site, 'Canonical public site required');
  assert.ok(Number.isSafeInteger(build.deploymentBlock) && build.deploymentBlock > 0, 'Deployment block required');
  for (const rpc of [config.rpc, config.logRpc].filter(Boolean)) httpsOrigin(rpc);
  assert.ok(config.logRpc, 'Explicit log RPC required');
  const daily = amount(config.dailyBNB), perTx = amount(config.perTxBNB);
  assert.ok(perTx <= daily && amount(config.giftEach) <= perTx
    && amount(config.publicPacket?.total) <= perTx, 'Campaign exceeds native budget');
  assert.ok(Number.isSafeInteger(config.publicPacket.shares) && config.publicPacket.shares >= 1
    && config.publicPacket.shares <= 500, 'Invalid public shares');
  assert.equal(amount(config.publicPacket.total) % BigInt(config.publicPacket.shares), 0n, 'Shares must divide exactly');
  amount(config.perTxUSD, 8);
  assert.ok(Number.isSafeInteger(config.pricesUpdatedAt) && config.pricesUpdatedAt <= now
    && config.pricesUpdatedAt > now - 86400, 'Fresh operator-supplied reference prices required');
  for (const t of ['BNB', 'USDT', 'USDC']) amount(config.pricesUSD?.[t], 8);
  assert.ok(typeof config.welcome === 'string' && Buffer.byteLength(config.welcome) <= 500,
    'Welcome exceeds message limit');
  if (config.operationsPath) {
    absolute(config.operationsPath);
    validateOperations(operations);
  } else assert.equal(operations, null, 'Operations file must be explicitly bound in resident configuration');
  const jobs = Object.fromEntries([['resident', 60], ['health', 120], ['stats', 300]].map(([name, interval]) =>
    [`dev.parley.${name}`, job(`dev.parley.${name}`,
      [node, path.join(root, 'scripts/ops-job.mjs'), name, '--config', configPath, '--build', buildPath,
        '--state-dir', stateDir, '--logs', logs], root, logs, interval)]));
  const suffix = sha256(JSON.stringify(binding)).slice(0, 16);
  for (const label of Object.keys(jobs)) jobs[label] = jobs[label].replaceAll(label, `${label}.${suffix}`);
  return { schemaVersion: 1, status: 'prepared-not-installed', jobs,
    prerequisites: ['Canonical final deployment independently verified', 'Resident handle matches the wallet on chain',
      'Private state/home/config/log directories with restricted permissions',
      'Fresh prices and operator budgets agreed', 'Operator reviews private logs and health exit codes',
      'Separate consent before installing jobs; manual preview/approval for every proposal'],
    walletAccess: false, serviceInstalled: false, serviceStarted: false, automaticSigning: false,
    alertDeliveryConfigured: !!operations?.alerts.enabled, statisticsPublicationConfigured: false,
    logRotationPrepared: true,
    statisticsCollectionPrepared: true, productionRelease: false };
}

export function linuxResidentServicePlan(input) {
  const validated = residentServicePlan(input);
  const { config, root, node, configPath, buildPath, stateDir, logs } = input;
  // Keep mutable queue/statistics data outside the immutable application tree.
  assert.equal(root, '/opt/parley-business');
  assert.equal(node, '/opt/parley-runtime/bin/node');
  assert.equal(config.stateRoot, '/var/lib/parley-business/resident');
  assert.equal(config.statsState, '/var/lib/parley-business/stats');
  assert.equal(config.statsOutput, '/var/lib/parley-business/stats.json');
  assert.equal(config.home, '/var/lib/parley-business/helper');
  assert.equal(logs, '/var/lib/parley-business/logs');
  assert.equal(configPath, '/var/lib/parley-business/config.json');
  assert.equal(buildPath, '/opt/parley-business/config/build.json');
  for (const value of [root, node, configPath, buildPath, stateDir, logs])
    assert.match(value, /^\/[A-Za-z0-9_./-]+$/, 'Unsafe systemd path');
  assert.ok(!Object.hasOwn(config, 'authorization') || config.authorization === null,
    'Scheduled queue worker must not carry signing authorization');
  const units = {};
  const suffix = sha256(JSON.stringify(input.binding)).slice(0, 16);
  for (const [name, interval] of [['resident', 60], ['health', 120], ['stats', 300]]) {
    const label = `parley-business-${name}-${suffix}`;
    units[`${label}.service`] = `[Unit]
Description=Parley manual-mode ${name}
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=parley-agent
Group=parley-agent
WorkingDirectory=${root}
Environment=HOME=/var/lib/parley-business/helper
Environment=PATH=/opt/parley-runtime/bin:/usr/bin:/bin
ExecStart=${node} ${root}/scripts/ops-job.mjs ${name} --config ${configPath} --build ${buildPath} --state-dir ${stateDir} --logs ${logs}
UMask=0077
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
ReadWritePaths=/var/lib/parley-business
InaccessiblePaths=/var/lib/parley-agent /run/user
MemoryMax=512M
CPUQuota=50%
TasksMax=32
TimeoutStartSec=100
StandardOutput=null
StandardError=null
`;
    units[`${label}.timer`] = `[Unit]
Description=Parley manual-mode ${name} schedule

[Timer]
OnActiveSec=${interval}s
OnUnitInactiveSec=${interval}s
AccuracySec=1s
RandomizedDelaySec=5s
Persistent=false
Unit=${label}.service

[Install]
WantedBy=timers.target
`;
  }
  const { jobs: _macJobs, ...report } = validated;
  return { ...report, platform: 'linux-systemd', units,
    walletAccess: false, modelRequests: 0,
    scope: 'Queue preparation, health and local statistics only; no preview, signing, broadcasting or public upload' };
}
