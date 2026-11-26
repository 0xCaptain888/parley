import { clean, byteLength } from './normalize.mjs';
import { input, ParleyError } from './errors.mjs';

function exact(o, keys) {
  input(o !== null && typeof o === 'object' && !Array.isArray(o), '载荷必须是对象。');
  input(Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k)), '载荷字段不符合版本 1。');
}
export function validatePayload(raw, expected) {
  let p;
  try { p = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { throw new ParleyError('BAD_PAYLOAD', '格式不符，已忽略。'); }
  input(p && typeof p === 'object' && !Array.isArray(p), '载荷必须是对象。');
  if (p.v !== 1) throw new ParleyError('NEWER_VERSION', '对方使用了更新的版本。');
  if (p.t === 'text' || p.t === 'memo') {
    exact(p, ['v', 't', 'body']);
    input(p.t === expected, '载荷类型与邮件类型不符。');
    input(typeof p.body === 'string' && byteLength(p.body) <= (p.t === 'text' ? 500 : 200), '正文类型或长度不符。');
    return { v: 1, t: p.t, body: clean(p.body) };
  }
  exact(p, ['v', 't', 'thread', 'seq', 'give', 'want', 'validUntil', 'offerId']);
  input(expected === 'deal' && ['quote', 'accept', 'reject'].includes(p.t), '报价类型不符。');
  input(typeof p.thread === 'string' && /^[0-9a-f]{16}$/.test(p.thread), 'thread 不符。');
  input(Number.isSafeInteger(p.seq) && p.seq >= 1, 'seq 不符。');
  input(Number.isSafeInteger(p.validUntil) && p.validUntil > 0, 'validUntil 不符。');
  for (const asset of [p.give, p.want]) {
    exact(asset, ['token', 'amount']);
    input(typeof asset.token === 'string' && /^0x[0-9a-f]{40}$/.test(asset.token), 'token 不符。');
    input(typeof asset.amount === 'string' && /^[1-9][0-9]{0,38}$/.test(asset.amount)
      && BigInt(asset.amount) < (1n << 128n), 'amount 不符。');
  }
  input(p.offerId === null || (Number.isSafeInteger(p.offerId) && p.offerId > 0), 'offerId 不符。');
  input(p.t !== 'accept' || p.offerId !== null, '接受消息需要链上报价编号。');
  return structuredClone(p);
}
export function textPayload(body, t = 'text') {
  return Buffer.from(JSON.stringify(validatePayload({ v: 1, t, body }, t)), 'utf8');
}
