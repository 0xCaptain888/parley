import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectStorage, syntheticStorageTest } from './wallet-storage.mjs';

const privateHome = { isDirectory: () => true, isSymbolicLink: () => false, uid: 996, mode: 0o40700 };
const input = () => ({ uid: 996, environment: { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/996/bus' },
  stat: p => p.endsWith('/bus') ? { ...privateHome, isSocket: () => true } : privateHome,
  nativeLoader: async () => ({ findCredentials: async service => {
    assert.equal(service, 'parley-wallet-storage-preflight'); return [];
  } }) });

test('native reachability never claims encryption, login or disabling the official fallback', async () => {
  const r = await inspectStorage(input());
  assert.equal(r.status, 'ready-for-synthetic-storage-test');
  assert.equal(r.encryptionAtRestVerified, false);
  assert.equal(r.officialCliFileFallbackDisabled, false);
  assert.equal(r.walletLoginStarted, false);
});
test('missing native module, bus, private owner or Secret Service blocks without exposing errors', async () => {
  for (const mutate of [
    i => i.nativeLoader = async () => { throw Error('PRIVATE_TOKEN'); },
    i => i.environment = {},
    i => i.environment.DBUS_SESSION_BUS_ADDRESS = 'tcp:host=example.com,port=1234',
    i => i.environment.DBUS_SESSION_BUS_ADDRESS = 'unix:path=/run/user/0/bus',
    i => i.uid = 0,
    i => i.stat = () => ({ ...privateHome, mode: 0o40755 }),
    i => i.stat = () => ({ ...privateHome, isSymbolicLink: () => true }),
    i => i.nativeLoader = async () => ({ findCredentials: async () => { throw Error('PRIVATE_TOKEN'); } }),
  ]) {
    const i = input(); mutate(i);
    const r = await inspectStorage(i);
    assert.equal(r.status, 'blocked');
    assert.ok(!JSON.stringify(r).includes('PRIVATE_TOKEN'));
  }
});
test('synthetic test requires approval and only touches its unique synthetic account', async () => {
  await assert.rejects(syntheticStorageTest({ keytar: {}, approved: false }));
  const items = new Map();
  const keytar = {
    setPassword: async (service, account, value) => {
      assert.equal(service, 'parley-wallet-storage-preflight');
      assert.match(account, /^synthetic-/);
      items.set(account, value);
    },
    getPassword: async (_service, account) => items.get(account),
    deletePassword: async (_service, account) => items.delete(account),
  };
  const r = await syntheticStorageTest({ keytar, approved: true });
  assert.equal(r.status, 'synthetic-roundtrip-passed');
  assert.equal(items.size, 0);
  assert.equal(r.secureWalletAcceptance, false);
});
test('failed synthetic reads still attempt cleanup, and failed cleanup cannot pass', async () => {
  let deleted = 0;
  const keytar = { setPassword: async () => {}, getPassword: async () => { throw Error('SECRET'); },
    deletePassword: async () => { deleted++; return true; } };
  const r = await syntheticStorageTest({ keytar, approved: true });
  assert.equal(deleted, 1); assert.equal(r.status, 'blocked');
  assert.ok(!JSON.stringify(r).includes('SECRET'));
  keytar.getPassword = async () => 'wrong';
  keytar.deletePassword = async () => false;
  assert.equal((await syntheticStorageTest({ keytar, approved: true })).status, 'blocked');
});
