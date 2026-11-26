import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const home = '/var/lib/parley-agent';
const host = '/opt/parley-agent-host';
const service = 'parley-wallet-storage-preflight';
const magic = Buffer.from('GnomeKeyring\n\r\0\n');
const keytar = () => createRequire(`${host}/package.json`)('@github/keytar');
const digest = value => createHash('sha256').update(value).digest('hex');

export function privateMetadata(stat, uid, directory = false) {
  assert.ok(directory ? stat.isDirectory() : stat.isFile());
  assert.equal(stat.isSymbolicLink(), false);
  assert.equal(stat.uid, uid);
  assert.equal(stat.mode & 0o077, 0);
  if (!directory) assert.equal(stat.nlink, 1);
}

export function validateHeader(header) {
  assert.equal(header.length, magic.length);
  assert.ok(header.equals(magic), 'Encrypted GNOME binary-format header required');
}

export function parseCollection(output) {
  const match = output.trim().match(/^\(objectpath '(\/org\/freedesktop\/secrets\/collection\/[A-Za-z0-9_]+)',\)$/);
  assert.ok(match, 'Existing default collection required');
  return match[1];
}

export function parseLocked(output) {
  const match = output.trim().match(/^\(<(true|false)>,\)$/);
  assert.ok(match, 'Exact boolean Locked property required');
  return match[1] === 'true';
}

function environment() {
  assert.equal(process.platform, 'linux');
  assert.equal(process.env.HOME, home);
  const uid = process.getuid();
  assert.notEqual(uid, 0);
  const runtime = `/run/user/${uid}`;
  assert.equal(process.env.XDG_RUNTIME_DIR, runtime);
  assert.equal(process.env.DBUS_SESSION_BUS_ADDRESS, `unix:path=${runtime}/bus`);
  for (const dir of [home, runtime]) privateMetadata(fs.lstatSync(dir), uid, true);
  const socket = fs.lstatSync(`${runtime}/bus`);
  assert.ok(socket.isSocket() && !socket.isSymbolicLink() && socket.uid === uid);
  return { uid, runtime };
}

export function dbus(method, object, args = []) {
  const result = spawnSync('/usr/bin/gdbus', [
    'call', '--session', '--dest', 'org.freedesktop.secrets',
    '--object-path', object, '--method', method, ...args,
  ], { encoding: 'utf8', timeout: 5000, maxBuffer: 16384 });
  assert.equal(result.status, 0, 'Secret Service call failed');
  return result.stdout;
}

function collectionState(expectedLocked) {
  const collection = parseCollection(dbus('org.freedesktop.Secret.Service.ReadAlias',
    '/org/freedesktop/secrets', ['default']));
  const locked = parseLocked(dbus('org.freedesktop.DBus.Properties.Get', collection,
    ['org.freedesktop.Secret.Collection', 'Locked']));
  assert.equal(locked, expectedLocked, 'Unexpected keyring lock state');
  return collection;
}

function encryptedFile(uid) {
  for (const dir of [`${home}/.local`, `${home}/.local/share`]) {
    const stat = fs.lstatSync(dir);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === uid);
  }
  const directory = `${home}/.local/share/keyrings`;
  privateMetadata(fs.lstatSync(directory), uid, true);
  const file = `${directory}/login.keyring`;
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    privateMetadata(fs.fstatSync(fd), uid);
    const header = Buffer.alloc(magic.length);
    assert.equal(fs.readSync(fd, header, 0, header.length, 0), header.length);
    validateHeader(header);
  } finally { fs.closeSync(fd); }
}

export function assertNoFileSession(file = `${home}/.baw/session.json`) {
  if (!fs.existsSync(file)) return;
  privateMetadata(fs.lstatSync(path.dirname(file)), process.getuid(), true);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    privateMetadata(stat, process.getuid());
    assert.ok(stat.size <= 16384);
    const raw = fs.readFileSync(fd);
    assert.ok(raw.length <= 16384);
    const record = JSON.parse(raw);
    assert.equal(Object.hasOwn(record, 'sessionId'), false, 'File-backed wallet session refused');
  } finally { fs.closeSync(fd); }
}

export async function command(args) {
  assert.equal(args.length, 1);
  const mode = args[0], { uid, runtime } = environment();
  const testFile = `${runtime}/parley-keyring-acceptance.json`;
  const readTest = () => {
    const fd = fs.openSync(testFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd);
      privateMetadata(stat, uid);
      assert.ok(stat.size <= 1024);
      const raw = fs.readFileSync(fd);
      assert.ok(raw.length <= 1024);
      const record = JSON.parse(raw);
      assert.deepEqual(Object.keys(record).sort(), ['account', 'digest', 'lockedChecks']);
      assert.match(record.account, /^synthetic-[0-9a-f-]{36}$/);
      assert.match(record.digest, /^[0-9a-f]{64}$/);
      assert.ok(Number.isInteger(record.lockedChecks)
        && record.lockedChecks >= 0 && record.lockedChecks <= 2);
      return record;
    } finally { fs.closeSync(fd); }
  };
  assert.ok(['seed', 'locked', 'finish', 'inspect', 'inspect-locked', 'first-setup'].includes(mode));
  assertNoFileSession();
  if (mode === 'first-setup') {
    assert.equal(fs.existsSync(`${home}/.local/share/keyrings/login.keyring`), false,
      'Existing keyring must not be replaced');
    assert.equal(fs.existsSync(testFile), false);
    return { status: 'FIRST_SETUP_ALLOWED', walletLoginStarted: false };
  }
  encryptedFile(uid);
  const collection = collectionState(mode === 'locked' || mode === 'inspect-locked');
  assert.equal(collection, '/org/freedesktop/secrets/collection/login');
  if (mode === 'inspect-locked')
    return { status: 'EXISTING_ENCRYPTED_KEYRING_LOCKED', walletLoginStarted: false };
  if (mode === 'locked') {
    const record = readTest();
    assert.ok(record.lockedChecks < 2);
    record.lockedChecks++;
    const fd = fs.openSync(testFile, fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW);
    try {
      privateMetadata(fs.fstatSync(fd), uid);
      fs.ftruncateSync(fd, 0);
      fs.writeFileSync(fd, JSON.stringify(record));
    } finally { fs.closeSync(fd); }
    return { status: 'KEYRING_LOCKED_CONFIRMED', lockedChecks: record.lockedChecks };
  }
  if (mode === 'inspect')
    return { status: 'ENCRYPTED_KEYRING_UNLOCKED', secureWalletAcceptance: false };
  const native = keytar();
  if (mode === 'seed') {
    assert.equal(fs.existsSync(testFile), false);
    const account = `synthetic-${randomUUID()}`, secret = randomBytes(32).toString('hex');
    // Keep only a digest outside the keyring, in the account's private runtime.
    fs.writeFileSync(testFile, JSON.stringify({ account, digest: digest(secret), lockedChecks: 0 }),
      { flag: 'wx', mode: 0o600 });
    await native.setPassword(service, account, secret);
    assert.equal(digest(await native.getPassword(service, account)), digest(secret));
    return { status: 'SYNTHETIC_KEYRING_ITEM_STORED', realWalletCredentialsAccessed: false };
  }
  const record = readTest();
  assert.equal(record.lockedChecks, 2, 'Both locked-state observations required');
  assert.equal(digest(await native.getPassword(service, record.account)), record.digest);
  assert.equal(await native.deletePassword(service, record.account), true);
  assert.equal(await native.getPassword(service, record.account), null);
  fs.unlinkSync(testFile);
  return { status: 'KEYRING_SYNTHETIC_ACCEPTANCE_PASSED', encryptedBinaryHeader: true,
    persistedAcrossLockUnlock: true, syntheticRemoved: true,
    walletLoginStarted: false, realWalletCredentialsAccessed: false,
    independentSecurityReview: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await command(process.argv.slice(2)))); }
  catch {
    console.error('KEYRING_CHECK_FAILED_CLOSED_NO_LOGIN');
    process.exitCode = 2;
  }
}
