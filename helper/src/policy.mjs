import path from 'node:path';
import { readJson, atomicJson, latestRows } from './state.mjs';
import { amount } from './normalize.mjs';
import { input, fail } from './errors.mjs';

export const DEFAULT_POLICY = {
  version: 1, perTx: { BNB: '0.02', USDT: '20', USDC: '20' },
  perDay: { BNB: '0.1', USDT: '100', USDC: '100' }, unlistedTokens: 'deny', maxPostage: '0.002',
};
export function policy(dir) {
  const file = path.join(dir, 'policy.json');
  let p = readJson(file, null);
  if (!p) { p = structuredClone(DEFAULT_POLICY); atomicJson(file, p); }
  input(p.version === 1, '不支持的限额文件版本。');
  for (const group of ['perTx', 'perDay']) for (const symbol of ['BNB', 'USDT', 'USDC'])
    amount(p[group]?.[symbol], 18, (1n << 256n) - 1n, false);
  amount(p.maxPostage, 18, (1n << 64n) - 1n, false);
  input(['deny', 'allow'].includes(p.unlistedTokens), '自定义代币限额配置不合法。');
  return p;
}
export function setPolicy(dir, key, value) {
  const p = policy(dir);
  if (key === 'unlistedTokens') {
    input(['allow', 'deny'].includes(value), '只能设置 allow 或 deny。'); p[key] = value;
  } else if (key === 'maxPostage') {
    amount(value, 18, (1n << 64n) - 1n, false); p[key] = value;
  } else {
    input(/^(perTx|perDay)\.(BNB|USDT|USDC)$/.test(key), '不允许修改这个限额键。');
    amount(value, 18, (1n << 256n) - 1n, false);
    const [g, s] = key.split('.'); p[g][s] = value;
  }
  atomicJson(path.join(dir, 'policy.json'), p);
  return p;
}
export function checkPolicy(p, ledger, spending, now, postage = 0n) {
  if (postage > amount(p.maxPostage, 18, undefined, false))
    fail('POSTAGE_TOO_HIGH', '对方设置的邮资超过你的本地上限。');
  const totals = new Map();
  for (const s of spending) totals.set(s.token.address, { ...s, amount: (totals.get(s.token.address)?.amount || 0n) + s.amount });
  for (const { token, amount: n } of totals.values()) {
    if (!token.listed) {
      if (p.unlistedTokens === 'deny') fail('UNLISTED_TOKEN_DENIED', '本地设置禁止使用未列出的代币。');
      continue;
    }
    const max = amount(p.perTx[token.symbol], token.decimals, undefined, false);
    if (n > max) fail('OVER_POLICY_TX', `${token.symbol} 超过本地单笔限额。`);
    const spent = ledger.filter(r => (r.status === 'confirmed' && r.confirmedAt > now - 86400)
      || (r.status === 'planned' && r.plannedAt > now - 600)).reduce((sum, r) =>
      sum + (r.spending || []).filter(s => s.address === token.address).reduce((v, s) => v + BigInt(s.amount), 0n), 0n);
    if (spent + n > amount(p.perDay[token.symbol], token.decimals, undefined, false))
      fail('OVER_POLICY_DAY', `${token.symbol} 超过过去 24 小时的本地限额（含最近 10 分钟待确认计划）。`);
  }
}
export function ledger(dir) { return latestRows(path.join(dir, 'ledger.jsonl')); }
