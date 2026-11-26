import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const host = '/opt/parley-agent-host';
const home = '/var/lib/parley-agent';
const loadNative = () => createRequire(`${host}/node_modules/@binance/agentic-wallet/package.json`)('@github/keytar');

export async function inspectStorage({ nativeLoader = loadNative, environment = process.env,
  directory = home, uid = process.getuid(), stat = fs.lstatSync } = {}) {
  const checks = [];
  const add = (code, passed) => checks.push({ code, passed: !!passed });
  let privateHome = false;
  try {
    const s = stat(directory);
    privateHome = s.isDirectory() && !s.isSymbolicLink() && s.uid === uid && (s.mode & 0o077) === 0;
  } catch { /* Missing or unreadable storage must not lead to login. */ }
  add('DEDICATED_PRIVATE_HOME', privateHome && uid !== 0);
  let privateBus = false;
  const bus = `/run/user/${uid}/bus`;
  if (new RegExp(`^unix:path=${bus}(?:,guid=[a-f0-9]+)?$`).test(environment.DBUS_SESSION_BUS_ADDRESS || '')) {
    try {
      const parent = stat(path.dirname(bus)), socket = stat(bus);
      privateBus = parent.isDirectory() && !parent.isSymbolicLink() && parent.uid === uid
        && (parent.mode & 0o077) === 0 && socket.isSocket() && !socket.isSymbolicLink() && socket.uid === uid;
    } catch { /* Reject another account's bus and unverified sockets. */ }
  }
  add('PRIVATE_DBUS_SESSION', privateBus);
  let keytar = null;
  try {
    keytar = await nativeLoader();
    add('NATIVE_KEYTAR_LOAD', typeof keytar?.findCredentials === 'function');
  } catch { add('NATIVE_KEYTAR_LOAD', false); }
  let reachable = false;
  if (keytar && checks.every(c => c.passed)) {
    try {
      // Query only our synthetic namespace, never the wallet's actual service/accounts.
      const result = await keytar.findCredentials('parley-wallet-storage-preflight');
      reachable = Array.isArray(result);
    } catch { /* Never print native errors or credential-bearing results. */ }
  }
  add('SECRET_SERVICE_REACHABLE', reachable);
  return { schemaVersion: 1, status: checks.every(c => c.passed) ? 'ready-for-synthetic-storage-test' : 'blocked',
    checks, walletSessionRead: false, walletLoginStarted: false, walletOperations: false,
    secureStorageVerified: false, encryptionAtRestVerified: false,
    officialCliFileFallbackDisabled: false,
    note: 'Native reachability does not prove persistent encryption or disable the official CLI file fallback.' };
}

export async function syntheticStorageTest({ keytar, approved = false } = {}) {
  assert.equal(approved, true, 'Explicit synthetic keyring write/read/delete approval required');
  const service = 'parley-wallet-storage-preflight', account = `synthetic-${randomUUID()}`;
  const value = randomBytes(32).toString('hex');
  let stored = false, matched = false, removed = false;
  try {
    await keytar.setPassword(service, account, value);
    stored = true;
    matched = await keytar.getPassword(service, account) === value;
  } catch { /* Sanitized outcome only; never expose a backend exception or value. */ }
  finally {
    if (stored) {
      try { removed = await keytar.deletePassword(service, account) === true; } catch { /* Operator review needed. */ }
    }
  }
  return { schemaVersion: 1, status: stored && matched && removed ? 'synthetic-roundtrip-passed' : 'blocked',
    syntheticStored: stored, syntheticReadMatched: matched, syntheticRemoved: removed,
    realWalletCredentialsAccessed: false, walletLoginStarted: false,
    encryptionAtRestVerified: false, secureWalletAcceptance: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.platform, 'linux');
    assert.ok(process.getuid() !== 0);
    assert.equal(process.env.HOME, home);
    const args = process.argv.slice(2), preflight = await inspectStorage();
    if (args.length === 1 && args[0] === 'inspect') {
      console.log(JSON.stringify(preflight));
      process.exitCode = preflight.status === 'blocked' ? 2 : 0;
    } else {
      assert.deepEqual(args, ['test', '--approve-synthetic-keyring-write-read-delete']);
      assert.equal(preflight.status, 'ready-for-synthetic-storage-test');
      const result = await syntheticStorageTest({ keytar: loadNative(), approved: true });
      console.log(JSON.stringify(result));
      process.exitCode = result.status === 'blocked' ? 2 : 0;
    }
  } catch {
    console.error('WALLET_STORAGE_CHECK_FAILED_CLOSED');
    process.exitCode = 2;
  }
}
