import path from 'node:path';
import fs from 'node:fs';
import { newKey } from './envelope.mjs';
import { readJson, atomicJson } from './state.mjs';
import { fail } from './errors.mjs';

const stored = k => ({ pub: `0x${k.pub.toString('hex')}`, sec: k.sec.toString('base64'), createdAt: Math.floor(Date.now() / 1000) });
const loaded = k => ({ pub: Buffer.from(k.pub.slice(2), 'hex'), sec: Buffer.from(k.sec, 'base64') });
export function keyFile(dir) { return path.join(dir, 'keys.json'); }
export function readKeys(dir) {
  const keys = readJson(keyFile(dir), null);
  if (keys) {
    fs.chmodSync(keyFile(dir), 0o600);
    if (keys.version !== 1 || !Array.isArray(keys.previous))
      fail('BAD_KEY_FILE', '信箱密钥文件格式不符，请从私人备份恢复。');
    for (const k of [keys.current, keys.pending, ...keys.previous].filter(Boolean)) {
      if (!/^0x[0-9a-f]{64}$/i.test(k.pub) || typeof k.sec !== 'string'
        || Buffer.from(k.sec, 'base64').length !== 32)
        fail('BAD_KEY_FILE', '信箱密钥文件格式不符，请从私人备份恢复。');
    }
  }
  return keys;
}
export function ensureKey(dir) {
  let keys = readKeys(dir);
  if (!keys) { keys = { version: 1, current: stored(newKey()), previous: [] }; atomicJson(keyFile(dir), keys); }
  return keys.current.pub;
}
export function rotateKey(dir) {
  const keys = readKeys(dir) || { version: 1, current: null, previous: [] };
  // Keep an unconfirmed rotation staged: a rejected transaction must not discard the active key.
  if (!keys.pending) keys.pending = stored(newKey());
  atomicJson(keyFile(dir), keys);
  return keys.pending.pub;
}
export function activeKey(dir, onChainPub) {
  let keys = readKeys(dir);
  if (!keys) fail('KEY_MISSING', '缺少信箱密钥。请复制原来的 ~/.parley 目录或运行 key rotate。');
  if (keys.pending?.pub.toLowerCase() === onChainPub.toLowerCase()) {
    if (keys.current) keys.previous.unshift(keys.current);
    keys.current = keys.pending;
    delete keys.pending;
    atomicJson(keyFile(dir), keys);
  }
  if (keys.current?.pub.toLowerCase() !== onChainPub.toLowerCase())
    fail('KEY_MISMATCH', '本机公钥与链上不符。请复制原来的 ~/.parley 目录或运行 key rotate。');
  return loaded(keys.current);
}
export function decryptionKeys(dir) {
  const keys = readKeys(dir);
  if (!keys) fail('KEY_MISSING', '缺少信箱密钥，历史邮件无法解密。');
  return [keys.current, ...(keys.previous || []), keys.pending].filter(Boolean).map(loaded);
}
