import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { command as inspect, assertNoFileSession } from './keyring-session.mjs';

const cli = '/opt/parley-agent-host/node_modules/@binance/agentic-wallet/dist/index.js';
const cliHash = 'e63e2dff4a6d267d2375a0bbcdf518f10ddd04b0ffaff378c265a26f0961fe4f';
const security = '/opt/parley-wallet-security';
export function allowedArguments(args) {
  const exact = [
    ['skill-check', '--skill-name', 'binance-agentic-wallet', '--current-version', '1.15.0', '--json'],
    ['cli-check', '--required-version', '1.12.0', '--json'],
    ['wallet', 'status', '--json'],
    ['wallet', 'settings', '--json'],
    ['wallet', 'address', '--json'],
    ['wallet', 'tx-lock', '--binanceChainId', '56', '--json'],
    ['auth', 'signin', '--json'],
  ];
  if (exact.some(value => JSON.stringify(value) === JSON.stringify(args))) return args;
  assert.equal(args.length, 5);
  assert.equal(args[0], 'auth');
  assert.equal(args[1], 'verify');
  assert.equal(args[2], '--qrCodeId');
  assert.match(args[3], /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.equal(args[4], '--json');
  return args;
}

export function publicOutput(result, args) {
  if (result.success !== true) {
    return { success: false, error: {
      code: result.error?.code, name: result.error?.name,
      message: result.error?.message,
    } };
  }
  const data = result.data || {};
  const mode = args.slice(0, 2).join(' ');
  const fields = mode === 'auth signin'
    ? ['status', 'pairingCode', 'urlForWeb', 'qrCodeId', 'expireAt']
    : mode === 'wallet settings'
      ? ['sessionExpireTime', 'maxSigninDuration', 'dailyLimit', 'quotaLeft',
        'developerModeQuotaUsed', 'abnormalTxnHandling', 'devMode']
      : mode === 'wallet address' ? ['address', 'addresses']
        : ['status', 'needUpdateSkill', 'latestSkillVersion', 'currentCliVersion', 'needUpdateCli'];
  const output = {};
  for (const key of fields) {
    if (!Object.hasOwn(data, key)) continue;
    if (key === 'devMode') {
      output.devMode = {};
      for (const field of ['enabled', 'expiresAt', 'dailyLimit', 'balanceExceeded'])
        if (['boolean', 'number', 'string'].includes(typeof data.devMode?.[field]))
          output.devMode[field] = data.devMode[field];
    } else if (key === 'addresses') {
      assert.ok(Array.isArray(data.addresses) && data.addresses.length <= 100);
      output.addresses = data.addresses.filter(item =>
        ['number', 'string'].includes(typeof item?.binanceChainId)
        && String(item.binanceChainId) === '56').map(item => {
        assert.match(item.address || '', /^0x[0-9a-fA-F]{40}$/);
        return { binanceChainId: item.binanceChainId, address: item.address };
      });
    } else {
      assert.ok(['boolean', 'number', 'string'].includes(typeof data[key]));
      output[key] = data[key];
    }
  }
  return { success: true, data: output };
}

async function main(args) {
  allowedArguments(args);
  await inspect(['inspect']);
  for (const file of [cli, `${security}/wallet-native-guard.cjs`]) {
    const stat = fs.lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(stat.uid, 0);
    assert.equal(stat.mode & 0o022, 0);
  }
  assert.equal(createHash('sha256').update(fs.readFileSync(cli)).digest('hex'), cliHash);
  const child = spawn('/opt/parley-runtime/bin/node',
    ['--require', `${security}/wallet-native-guard.cjs`, cli, ...args], {
      cwd: '/var/lib/parley-agent',
      env: {
        HOME: '/var/lib/parley-agent', PATH: '/opt/parley-runtime/bin:/usr/bin:/bin',
        XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
        DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
        PARLEY_REQUIRE_NATIVE_STORAGE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  let bytes = 0, output = [], overflow = false;
  // Retain only bounded stdout for parsing; never print raw CLI output or stderr.
  child.stdout.on('data', part => {
    bytes += part.length;
    if (bytes > 65536) { overflow = true; child.kill('SIGTERM'); }
    else output.push(part);
  });
  child.stderr.on('data', () => {});
  const timer = setTimeout(() => child.kill('SIGTERM'), args[1] === 'verify' ? 330000 : 30000);
  try {
    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    assertNoFileSession();
    assert.equal(overflow, false);
    const result = JSON.parse(Buffer.concat(output).toString('utf8'));
    console.log(JSON.stringify(publicOutput(result, args)));
    process.exitCode = exit === 0 && result.success ? 0 : 2;
  } finally { clearTimeout(timer); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => {
    console.error('SECURE_WALLET_COMMAND_FAILED_CLOSED_NO_RAW_OUTPUT');
    process.exitCode = 2;
  });
}
