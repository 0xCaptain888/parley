import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readJson, atomicJson } from './state.mjs';
import { validatePayload } from './payload.mjs';
import { address, handle, integer } from './normalize.mjs';
import { input, fail } from './errors.mjs';

const raw = v => {
  input(typeof v === 'string' && /^[1-9][0-9]{0,38}$/.test(v)
    && BigInt(v) < (1n << 128n), '谈判数量格式不符。');
  return BigInt(v);
};
export function validateSession(s) {
  input(s && typeof s === 'object', '谈判配置不符。');
  input(/^[0-9a-f]{16}$/.test(s.thread), '谈判编号必须是 16 位十六进制。');
  input(handle(s.peer) === s.peer && ['sell', 'buy'].includes(s.side), '谈判对象或方向不符。');
  address(s.asset?.token); address(s.unit);
  input(s.asset.token !== s.unit, '谈判资产不能相同。');
  raw(s.asset.amount);
  const target = raw(s.target), limit = raw(s.side === 'sell' ? s.floor : s.ceiling);
  input(s.side === 'sell' ? limit <= target : limit >= target, '谈判目标超出用户底线。');
  integer(s.rounds, 1, 20); integer(s.expiresAt, 1);
  integer(s.seq, 0); integer(s.receivedSeq, 0); integer(s.round, 0, s.rounds); integer(s.revision, 0);
  const current = raw(s.current);
  input(s.side === 'sell' ? current >= limit && current <= target : current <= limit && current >= target,
    '当前报价超出本机边界。');
  input(['draft', 'open', 'offer_created', 'awaiting_peer', 'rejected', 'settled'].includes(s.status),
    '谈判状态不符。');
  return s;
}
export function createSession(values) {
  return validateSession({ ...values, thread: values.thread || randomBytes(8).toString('hex'),
    seq: 0, receivedSeq: 0, round: 0, current: values.target, revision: 0, status: 'draft' });
}
export function sessions(dir) {
  const p = readJson(path.join(dir, 'policy.json'), null);
  const list = p?.sessions || [];
  input(Array.isArray(list) && list.length <= 100, '谈判配置格式不符。');
  list.forEach(validateSession);
  return list;
}
export function storeSession(dir, session) {
  validateSession(session);
  const p = readJson(path.join(dir, 'policy.json'), null);
  input(p?.version === 1, '限额文件尚未初始化。');
  p.sessions = sessions(dir);
  input(!p.sessions.some(s => s.thread === session.thread), '谈判编号已存在，不允许覆盖底线。');
  input(p.sessions.length < 100, '本机最多保存 100 场谈判。');
  p.sessions.push(session);
  atomicJson(path.join(dir, 'policy.json'), p);
}
export function applyDealResult(dir, effect, event) {
  if (!effect) return;
  const p = readJson(path.join(dir, 'policy.json'), null);
  const s = p?.sessions?.find(s => s.thread === effect.thread);
  if (!s || s.revision !== effect.revision) return;
  Object.assign(s, effect.patch, { revision: s.revision + 1 });
  if (effect.createdOffer) s.offerId = Number(event.args.id);
  atomicJson(path.join(dir, 'policy.json'), p);
}
export function messageFor(s, type = 'quote', offerId = null) {
  const asset = { ...s.asset }, unit = { token: s.unit, amount: s.current };
  return validatePayload({ v: 1, t: type, thread: s.thread, seq: s.seq + 1,
    give: s.side === 'sell' ? asset : unit, want: s.side === 'sell' ? unit : asset,
    validUntil: s.expiresAt, offerId }, 'deal');
}
export function validatePeerQuote(s, p, now) {
  validatePayload(p, 'deal');
  input(p.thread === s.thread, '不是这场谈判的消息。');
  if (p.seq <= s.receivedSeq) fail('NO_NEW_QUOTE', '该报价消息已处理，未产生调用。');
  if (p.validUntil <= now) fail('EXPIRED', '报价消息已过期。');
  const a = s.side === 'sell' ? p.want : p.give;
  const u = s.side === 'sell' ? p.give : p.want;
  input(a.token === s.asset.token && a.amount === s.asset.amount && u.token === s.unit,
    '报价改变了本机约定的资产或固定数量。');
  return raw(u.amount);
}
export function decide(s, p, now) {
  validateSession(s);
  if (s.expiresAt <= now) fail('EXPIRED', '本场谈判已过期。');
  const price = validatePeerQuote(s, p, now);
  if (p.t === 'reject') return { action: 'peer_rejected' };
  if (p.t === 'accept') {
    const limit = BigInt(s.side === 'sell' ? s.floor : s.ceiling);
    input(s.side === 'sell' ? price >= limit : price <= limit, '链上报价超出用户底线。');
    return { action: 'accept_offer', price: price.toString(), offerId: p.offerId };
  }
  const current = BigInt(s.current);
  if (s.side === 'sell' ? price >= current : price <= current)
    return { action: 'create_offer', price: s.current };
  if (s.round >= s.rounds) return { action: 'reject' };
  const round = s.round + 1, target = BigInt(s.target);
  const limit = BigInt(s.side === 'sell' ? s.floor : s.ceiling);
  const delta = (s.side === 'sell' ? target - limit : limit - target) * BigInt(round) / BigInt(s.rounds);
  const next = s.side === 'sell' ? target - delta : target + delta;
  input(next > 0n && (s.side === 'sell' ? next >= limit : next <= limit), '谈判边界检查失败。');
  return { action: 'quote', round, price: next.toString() };
}
