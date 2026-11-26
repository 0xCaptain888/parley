import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { readTelegramConfig, storeTelegramConfig, telegramCommand } from './telegram-alert.mjs';

const token = `12345:${'x'.repeat(32)}`, chatId = '1473804945';
const input = Buffer.from(`${token}\n${chatId}`);

function workspace(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'parley-telegram-test-'));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, directory: path.join(root, 'telegram') };
}

test('exact hidden-helper serialization stores private configuration without networking', async t => {
  const { directory } = workspace(t);
  const result = await telegramCommand(['store', '--approve-private-storage', directory],
    Readable.from([input]));
  assert.deepEqual(result, { status: 'TELEGRAM_PRIVATE_CONFIG_STORED', networkRequests: 0 });
  assert.deepEqual(readTelegramConfig(path.join(directory, 'telegram.json')), { token, chatId });
  for (const [file, mode] of [
    [directory, 0o700], [path.join(directory, 'bot-token'), 0o600],
    [path.join(directory, 'telegram.json'), 0o600],
  ]) {
    const stat = fs.statSync(file);
    assert.equal(stat.mode & 0o777, mode);
    assert.equal(stat.uid, process.getuid());
  }
  assert.ok(!JSON.stringify(result).includes(token));
});

test('invalid or accidentally decorated input creates no directory', t => {
  const { directory } = workspace(t);
  const invalid = [
    '', `\n${chatId}`, `${token}\n`, `${token}\n ${chatId}`,
    `${token}\n\`${chatId}\``, `${token}\n${chatId}\n`,
    `${token}\r\n${chatId}`, `${token}\n${chatId}\r`,
  ];
  for (const text of invalid) {
    assert.throws(() => storeTelegramConfig(Buffer.from(text), directory));
    assert.equal(fs.existsSync(directory), false);
  }
});

test('repeated setup refuses to overwrite existing credentials', t => {
  const { directory } = workspace(t);
  storeTelegramConfig(input, directory);
  const config = path.join(directory, 'telegram.json'), secret = path.join(directory, 'bot-token');
  const before = [fs.readFileSync(config), fs.readFileSync(secret)];
  assert.throws(() => storeTelegramConfig(input, directory), { code: 'EEXIST' });
  assert.deepEqual([fs.readFileSync(config), fs.readFileSync(secret)], before);
});

test('public or symlinked storage parents are refused before any write', t => {
  const { root, directory } = workspace(t);
  fs.chmodSync(root, 0o755);
  assert.throws(() => storeTelegramConfig(input, directory));
  assert.equal(fs.existsSync(directory), false);
  fs.chmodSync(root, 0o700);
  const link = path.join(root, 'link');
  fs.symlinkSync(root, link);
  assert.throws(() => storeTelegramConfig(input, path.join(link, 'telegram')));
  assert.equal(fs.existsSync(directory), false);
});

test('oversized input and missing approval create no files', async t => {
  const { directory } = workspace(t);
  await assert.rejects(telegramCommand(['store', '--approve-private-storage', directory],
    Readable.from([Buffer.alloc(257)])));
  await assert.rejects(telegramCommand(['store', '--wrong-approval', directory],
    Readable.from([input])));
  assert.equal(fs.existsSync(directory), false);
});

test('credential reads reject weakened permissions and symlink substitution', t => {
  const { root, directory } = workspace(t);
  storeTelegramConfig(input, directory);
  const config = path.join(directory, 'telegram.json'), secret = path.join(directory, 'bot-token');
  fs.chmodSync(secret, 0o644);
  assert.throws(() => readTelegramConfig(config));
  fs.chmodSync(secret, 0o600);
  const saved = path.join(root, 'synthetic-token');
  fs.renameSync(secret, saved);
  fs.symlinkSync(saved, secret);
  assert.throws(() => readTelegramConfig(config));
});
