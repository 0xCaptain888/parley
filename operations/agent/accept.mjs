import { spawnSync } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { verifyLock, verifySkill } from './verify.mjs';

const dest = '/opt/parley-agent-host';
const home = '/var/lib/parley-agent';
const node = '/opt/parley-runtime/bin/node';
const skill = `${home}/workspace/skills/parley`;
const path = `${dest}/node_modules/.bin:/opt/parley-runtime/bin:/usr/bin:/bin`;
const checks = [];
const add = (name, passed, detail = {}) => checks.push({ name, passed: !!passed, ...detail });
function run(program, args) {
  const result = spawnSync(program, args, {
    encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024,
    env: { PATH: '/opt/parley-runtime/bin:/usr/sbin:/usr/bin:/sbin:/bin', HOME: '/root' }
  });
  return { code: result.status, stdout: result.stdout || '', error: result.error?.code || null };
}
function asAgent(program, args) {
  return run('/usr/bin/sudo', ['-u', 'parley-agent', 'env', '-i',
    `HOME=${home}`, `PATH=${path}`, `OPENCLAW_STATE_DIR=${home}/.openclaw`,
    'OPENCLAW_NO_RESPAWN=1', program, ...args]);
}
function host(args) { return run(`${dest}/bin/parley-agent`, args); }
function parse(result) { try { return JSON.parse(result.stdout); } catch { return null; } }

if (process.platform !== 'linux' || process.getuid() !== 0) throw new Error('Run acceptance as root on the server');
const pins = JSON.parse(await readFile(`${dest}/pins.json`, 'utf8'));
verifyLock(JSON.parse(await readFile(`${dest}/package-lock.json`, 'utf8')), pins);
await verifySkill(skill, pins);
add('pinned_software_and_published_skill', true);
const id = asAgent('/usr/bin/id', ['-un']);
add('dedicated_nonroot_account', id.code === 0 && id.stdout.trim() === 'parley-agent');
const version = host(['--version']);
add('openclaw_starts', version.code === 0 && version.stdout.includes('2026.11.10'),
  { exitCode: version.code });
const baw = asAgent(`${dest}/node_modules/.bin/baw`, ['cli-check', '--required-version', '1.12.0', '--json']);
const bawData = parse(baw);
add('wallet_cli_starts', baw.code === 0 && bawData?.success === true && bawData?.data?.needUpdateCli === false,
  { exitCode: baw.code, credentialCheckPerformed: false });
for (const name of ['parley', 'binance-agentic-wallet']) {
  const info = host(['skills', 'info', name, '--json']);
  const data = parse(info);
  // Preserve only public readiness fields, never raw config or provider output.
  add(`host_discovers_${name}`, info.code === 0 && data?.name === name,
    { exitCode: info.code, eligible: data?.eligible ?? null, disabled: data?.disabled ?? null });
  add(`host_prerequisites_satisfied_${name}`, info.code === 0 &&
    data?.name === name && data?.eligible === true && data?.disabled !== true);
}
const skillCheck = host(['skills', 'check', '--json']);
add('host_readiness_check_runs', skillCheck.code === 0 && parse(skillCheck) !== null,
  { exitCode: skillCheck.code });
const help = asAgent(node, [`${skill}/parley.mjs`, '--help']);
const helpData = parse(help);
add('helper_executes', help.code === 0 && helpData?.ok === true &&
  helpData?.command === 'help' && helpData?.chainId === 56 && helpData?.configured === false,
  { exitCode: help.code });
const staging = asAgent(node, [`${skill}/parley.mjs`, 'status', '--from',
  '0x0000000000000000000000000000000000000001']);
const refused = parse(staging);
add('staging_fails_closed', refused?.ok === false && refused?.code === 'NOT_CONFIGURED' &&
  (!refused?.calls || refused.calls.length === 0),
  { exitCode: staging.code, reasonCode: refused?.code ?? null });
const dir = await stat(home);
add('private_home', (dir.mode & 0o777) === 0o700 && dir.uid !== 0);
const code = await stat(`${dest}/node_modules/openclaw/openclaw.mjs`);
add('root_owned_host_code', code.uid === 0 && (code.mode & 0o022) === 0);
const monitor = run('/usr/bin/systemctl', ['is-active', 'parley-monitor.timer']);
add('existing_monitor_timer_active', monitor.code === 0 && monitor.stdout.trim() === 'active');
const services = run('/usr/bin/systemctl', ['show', 'parley-monitor.service',
  '--property=Result', '--property=ExecMainStatus']);
add('existing_monitor_last_run_success', services.code === 0 &&
  services.stdout.includes('Result=success') && services.stdout.includes('ExecMainStatus=0'));
const report = {
  schemaVersion: 1, collectedAt: new Date().toISOString(),
  scope: 'Actual isolated Agent host and Skill bootstrap; not monitor deployment',
  checks, bootstrapPassed: checks.every(c => c.passed),
  modelInference: { verified: false, reason: 'No provider selected or authorized on this host' },
  walletSession: { migrated: false, connectedVerified: false },
  businessAcceptance: { verified: false, reason: 'Staging has no production contract' },
  automaticTransactionsEnabled: false
};
const output = process.argv[2] || '/var/lib/parley-agent/host-acceptance.json';
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.bootstrapPassed ? 0 : 1;
