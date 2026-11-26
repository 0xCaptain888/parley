import { parseUnits } from 'viem';
import { amount, ZERO } from '../helper/src/normalize.mjs';

export function safePreview(raw) {
  if (raw?.success !== true || !raw.data?.requestId || !raw.data.parsedTx || !raw.data.expiresAt) return false;
  const d = raw.data, risks = d.risks;
  if (!risks || !Array.isArray(risks.riskDetails) || risks.riskDetails.length) return false;
  if (risks.riskBehaviors?.length) return false;
  if (Object.values(risks.addresses || {}).some(v => v.riskDetails?.length || Number(v.riskLevel || 0) > 0)) return false;
  const sim = d.simulationResult;
  if (!sim || sim.simulationCode !== '000000000' || sim.authorityChanges?.length || d.authorityChanges?.length) return false;
  return true;
}
export function withinBudget(config, ledger, value, now) {
  const n = BigInt(value);
  if (n === 0n) return true;
  const used = ledger.filter(r => !['failed', 'cancelled'].includes(r.status)
    && (r.status !== 'confirmed' || (r.confirmedAt ?? r.createdAt) > now - 86400))
    .reduce((sum, r) => sum + BigInt(r.bnb || '0'), 0n);
  return n <= amount(config.perTxBNB) && used + n <= amount(config.dailyBNB);
}
export function acceptableOffer(o, config, now) {
  if (!config.pricesUpdatedAt || now - config.pricesUpdatedAt > 86400 || config.pricesUpdatedAt > now) return false;
  if (!o.give.listed || !o.want.listed || o.expiresAt <= now) return false;
  if (!config.pricesUSD[o.give.symbol] || !config.pricesUSD[o.want.symbol]) return false;
  const value = t => BigInt(t.raw) * parseUnits(config.pricesUSD[t.symbol], 8) / 10n ** BigInt(t.decimals ?? 18);
  const give = value(o.give), want = value(o.want);
  if (give <= 0n || want <= 0n) return false;
  const cap = parseUnits(config.perTxUSD || '2', 8);
  return give <= cap && want <= cap && give * 100n >= want * 97n && give * 100n <= want * 103n;
}
export function proposals(items, state, config, now) {
  const out = [];
  for (const item of items) {
    const first = out.length;
    const h = item.from.replace(/\.ai$/, '');
    if (!/^[a-z0-9]{1,64}$/.test(h)) continue;
    if (['text','claim'].includes(item.kind) && !state.welcomed.includes(h)) {
      out.push({ key: `welcome:${h}`, index: item.index, args: ['send', '--to', h, '--text', config.welcome,
        ...(item.kind === 'claim' ? ['--with-postage'] : [])], effect: { welcome: h } });
    }
    if (!state.gifted.includes(h) && !state.pendingGifts?.includes(h)) {
      out.push({ key: `gift:${h}`, index: item.index, args: ['packet', 'create', '--to', h, '--each', config.giftEach, '--memo', '欢迎来到 Parley'], effect: { gift: h } });
    }
    if (item.request?.status === 1)
      out.push({ key: `request:${item.request.id}`, index: item.index, args: ['request', 'decline', String(item.request.id)] });
    if (item.offer?.status === 1) {
      const accepts = acceptableOffer(item.offer, config, now);
      out.push({ key: `offer:${item.offer.id}`, index: item.index, args: ['offer', accepts ? 'accept' : 'decline', String(item.offer.id)] });
    }
    if (item.claim) for (const proposal of out.slice(first)) proposal.claim = item.claim;
  }
  const date = new Date(now * 1000 + 8 * 3600000).toISOString().slice(0, 10);
  if (state.publicDate !== date)
    out.push({ key: `public:${date}`, args: ['packet', 'create', '--total', config.publicPacket.total, '--shares', String(config.publicPacket.shares),
      '--memo', 'Parley 新人红包'], effect: { publicDate: date } });
  if (!state.boardOpen && config.boardOffer) {
    const b = config.boardOffer;
    out.push({ key: `board:${state.boardId || 0}`, args: ['offer', 'create', '--give', b.give, '--give-token', b.giveToken, '--want', b.want, '--want-token', b.wantToken],
      effect: { boardOpen: true } });
  }
  return out;
}
