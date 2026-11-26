import { ZERO, address, clean, integer, human } from './normalize.mjs';
import { fail } from './errors.mjs';

export const RISK = '风险提示：数字资产价格波动大。点对点交换一经成交无法撤销。自定义代币可能没有任何价值。请自行核对合约地址并独立判断。';
export async function getToken(chain, raw = 'BNB') {
  const name = raw.toUpperCase();
  if (name === 'BNB' || raw.toLowerCase() === ZERO) return { address: ZERO, symbol: 'BNB', decimals: 18, listed: true };
  const a = address(chain.config.tokens[name] || raw);
  const entry = Object.entries(chain.config.tokens).find(([, v]) => v.toLowerCase() === a);
  let decimals, symbol;
  try { [decimals, symbol] = await Promise.all([chain.token(a, 'decimals'), chain.token(a, 'symbol')]); }
  catch { fail('TOKEN_METADATA_UNAVAILABLE', '无法读取代币 decimals 或 symbol，停止构造交易。'); }
  integer(String(decimals), 0, 255);
  return { address: a, symbol: entry?.[0] || 'CUSTOM', decimals: Number(decimals), listed: !!entry,
    ...(!entry ? { untrusted: { symbol: clean(String(symbol)).slice(0, 80) } } : {}) };
}
export function tokenView(token, quantity) {
  return { amount: human(quantity, token.decimals), raw: String(quantity), symbol: token.symbol, decimals: token.decimals,
    listed: token.listed, ...(token.address !== ZERO ? { contract: token.address } : {}) };
}
export function tokenWarnings(tokens, p) {
  return [...new Map(tokens.map(t => [t.address, t])).values()].flatMap(t => {
    if (t.listed) return [];
    if (p.unlistedTokens === 'deny') fail('UNLISTED_TOKEN_DENIED', '本地设置禁止使用未列出的代币。');
    return [`未列出的代币 ${t.address}：可能没有价值；不设本地金额上限。不支持 rebase；转账税可能减少实际到账。`];
  });
}
export function untrustedTokens(tokens) {
  return tokens.filter(t => !t.listed).map(t => ({ contract: t.address, ...t.untrusted }));
}
