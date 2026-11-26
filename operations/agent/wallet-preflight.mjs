import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { inspectWallet } from '../../scripts/wallet-inspection.mjs';

export async function secureWalletPreflight() {
  assert.equal(process.argv.length, 2, 'No arguments allowed');
  return inspectWallet(async args => {
    const bytes = execFileSync('/opt/parley-runtime/bin/node',
      ['/opt/parley-wallet-security/wallet-secure.mjs', ...args, '--json'], {
        cwd: '/var/lib/parley-agent', timeout: 40000, maxBuffer: 65536,
        env: { HOME: '/var/lib/parley-agent', PATH: '/opt/parley-runtime/bin:/usr/bin:/bin',
          XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
          DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    return JSON.parse(bytes);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await secureWalletPreflight())); }
  catch {
    console.error(JSON.stringify({ status: 'blocked', code: 'SECURE_PREFLIGHT_FAILED_NO_RAW_OUTPUT',
      walletLoginStarted: false, mainnetBroadcast: false, productionRelease: false }));
    process.exitCode = 2;
  }
}
