import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { parseCollection, parseLocked, validateHeader, privateMetadata } from './keyring-session.mjs';
import { allowedArguments, publicOutput } from './wallet-secure.mjs';

const { wrapNative } = createRequire(import.meta.url)('./wallet-native-guard.cjs');
test('only exact local collection and boolean replies are accepted', () => {
  assert.equal(parseCollection("(objectpath '/org/freedesktop/secrets/collection/login',)"),
    '/org/freedesktop/secrets/collection/login');
  assert.equal(parseLocked('(<true>,)'), true);
  assert.equal(parseLocked('(<false>,)'), false);
  for (const value of ["(objectpath '/',)", '/remote', "(objectpath '/x',)", '(<false>,) trailing']) {
    assert.throws(() => parseCollection(value));
  }
  for (const value of ['false', '(<false>,) trailing', '(<0>,)', ''])
    assert.throws(() => parseLocked(value));
});
test('encrypted format header refuses plaintext and truncated files', () => {
  validateHeader(Buffer.from('GnomeKeyring\n\r\0\n'));
  for (const value of ['[keyring]\nplaintext', '', 'GnomeKeyring'])
    assert.throws(() => validateHeader(Buffer.from(value)));
});
test('metadata requires private owner, no symlink and one regular-file link', () => {
  const stat = { uid: 996, mode: 0o100600, nlink: 1, isFile: () => true,
    isDirectory: () => false, isSymbolicLink: () => false };
  privateMetadata(stat, 996);
  for (const patch of [{ uid: 0 }, { mode: 0o100644 }, { nlink: 2 },
    { isSymbolicLink: () => true }, { isFile: () => false }])
    assert.throws(() => privateMetadata({ ...stat, ...patch }, 996));
});
test('native failures invoke termination before a caller can fall back', async () => {
  const names = ['getPassword', 'setPassword', 'deletePassword', 'findPassword', 'findCredentials'];
  for (const failure of names) {
    let fatals = 0;
    const native = Object.fromEntries(names.map(name => [name, async () => {
      if (name === failure) throw Error('SECRET_BACKEND_DETAILS');
      return 'ok';
    }]));
    wrapNative(native, () => { fatals++; throw Error('FATAL_SENTINEL'); });
    await assert.rejects(native[failure]('baw', 'agentSessionId'), /FATAL_SENTINEL/);
    assert.equal(fatals, 1);
    for (const name of names.filter(name => name !== failure))
      assert.equal(await native[name](), 'ok');
  }
  assert.throws(() => wrapNative({}, () => {}), /NATIVE_METHOD_MISSING/);
});
test('a locked collection fails before touching a native credential method', async () => {
  let touched = false;
  const native = Object.fromEntries(['getPassword', 'setPassword', 'deletePassword',
    'findPassword', 'findCredentials'].map(name => [name, async () => { touched = true; }]));
  wrapNative(native, () => { throw Error('FATAL_LOCKED'); }, () => { throw Error('LOCKED'); });
  await assert.rejects(native.getPassword('baw', 'agentSessionId'), /FATAL_LOCKED/);
  assert.equal(touched, false);
});
test('real process exit prevents a catch-and-file-fallback continuation', () => {
  const guard = createRequire(import.meta.url).resolve('./wallet-native-guard.cjs');
  const source = `
    const {wrapNative}=require(${JSON.stringify(guard)});
    const names=['getPassword','setPassword','deletePassword','findPassword','findCredentials'];
    const native=Object.fromEntries(names.map(n=>[n,async()=>{throw Error('PRIVATE_NATIVE_ERROR');}]));
    wrapNative(native,()=>process.exit(70));
    native.setPassword('baw','agentSessionId','SYNTHETIC').catch(()=>console.log('FILE_FALLBACK'));
  `;
  const result = spawnSync(process.execPath, ['-e', source], { encoding: 'utf8' });
  assert.equal(result.status, 70);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});
test('secure wallet entry refuses transactions, unbounded flags and arbitrary commands', () => {
  for (const args of [
    ['wallet', 'status', '--json'], ['wallet', 'settings', '--json'],
    ['wallet', 'tx-lock', '--binanceChainId', '56', '--json'],
    ['auth', 'signin', '--json'],
    ['auth', 'verify', '--qrCodeId', 'a191884d-0e05-435b-a887-336bc242fafc', '--json'],
  ]) assert.deepEqual(allowedArguments(args), args);
  for (const args of [
    ['wallet', 'send', '--json'], ['contract-call', 'execute', '--json'],
    ['auth', 'signout', '--json'], ['auth', 'verify', '--qrCodeId', 'bad', '--json'],
    ['wallet', 'status', '--json', '--extra'], ['wallet', 'settings'],
    ['wallet', 'tx-lock', '--binanceChainId', '1', '--json'],
  ]) assert.throws(() => allowedArguments(args));
});
test('nested wallet settings and addresses cannot carry credential fields into the public preflight', () => {
  const output = publicOutput({ success: true, data: { dailyLimit: '100', quotaLeft: '99',
    developerModeQuotaUsed: '1', abnormalTxnHandling: 'AutoReject',
    devMode: { enabled: true, expiresAt: 1796000000, balanceExceeded: false, dailyLimit: '10',
      sessionId: 'SECRET', arbitrary: { token: 'SECRET' } } } }, ['wallet', 'settings']);
  assert.equal(output.data.dailyLimit, '100');
  assert.equal(output.data.devMode.balanceExceeded, false);
  assert.ok(!JSON.stringify(output).includes('SECRET'));
  const address = `0x${'1'.repeat(40)}`;
  assert.deepEqual(publicOutput({ success: true, data: {
    addresses: [
      { address: 'SolanaPublicAddressNotEvm', binanceChainId: 'CT_501', sessionId: 'SECRET' },
      { address, binanceChainId: '1', sessionId: 'SECRET' },
      { address, binanceChainId: 56, sessionId: 'SECRET' },
    ],
  } }, ['wallet', 'address']).data.addresses, [{ address, binanceChainId: 56 }]);
  assert.throws(() => publicOutput({ success: true, data: {
    addresses: [{ address: 'invalid-bsc-address', binanceChainId: 56 }],
  } }, ['wallet', 'address']));
});
test('existing-keyring recovery prompts privately and never resets or saves a password', () => {
  const file = new URL('./unlock-keyring.sh', import.meta.url);
  const source = fs.readFileSync(file, 'utf8');
  assert.equal(spawnSync('bash', ['-n', file.pathname]).status, 0);
  assert.match(source, /inspect-locked/);
  assert.match(source, /read -r -s/);
  assert.match(source, /printf '%s' "\$password" \|/);
  assert.ok(!/\b(rm|tee|reset|export password)\b/.test(source.replace(/^#.*$/gm, '')));
  assert.ok(!/--password|--login|auth signin/.test(source));
});
test('public results omit session credentials and preserve the pairing link verbatim', () => {
  const data = { pairingCode: '654321', urlForWeb: 'https://web3.binance.com/en/agent-login?url=A%2FB',
    qrCodeId: 'public-id', sessionId: 'SECRET_SESSION', clientId: 'SECRET_CLIENT', token: 'SECRET' };
  const output = publicOutput({ success: true, data }, ['auth', 'signin']);
  assert.equal(output.data.urlForWeb, data.urlForWeb);
  assert.equal(output.data.pairingCode, data.pairingCode);
  assert.ok(!JSON.stringify(output).includes('SECRET'));
  assert.deepEqual(publicOutput({ success: false, error: {
    code: 10002004, name: 'AUTH_REJECTED', message: 'QR code does not exist or expired', token: 'SECRET',
  } }, ['auth', 'verify']), { success: false, error: {
    code: 10002004, name: 'AUTH_REJECTED', message: 'QR code does not exist or expired',
  } });
});
