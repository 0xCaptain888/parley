import { makeChain, packet, request, offer, mailbox } from './chain.mjs';
import { prepare } from './calls.mjs';
import { stateDir, locked } from './state.mjs';
import { policy, setPolicy, ledger } from './policy.mjs';
import { ensureKey, rotateKey, activeKey } from './keys.mjs';
import { seal } from './envelope.mjs';
import { textPayload } from './payload.mjs';
import { inbox, readMail, ack, cursor, decrypt } from './inbox.mjs';
import { createSession, sessions, storeSession, messageFor, decide, applyDealResult } from './negotiation.mjs';
import { result } from './result.mjs';
import { handle, address, integer, amount, human, packetId, clean, byteLength, ttl, parseArgs, ZERO, ZERO_KEY } from './normalize.mjs';
import { getToken, tokenView, tokenWarnings, untrustedTokens, RISK } from './tokens.mjs';
import { fail, input } from './errors.mjs';
import { localize } from './i18n.mjs';

const eq = (a, b) => a.toLowerCase() === b.toLowerCase();
const response = (ctx, summary = {}, untrusted = {}, warnings = []) => ({ ok: true, command: ctx.command, summary, untrusted, warnings, calls: [] });
const optionSets = {
  status: [], open: [], 'key.rotate': [], result: ['plan'], inbox: ['limit'], read: [], ack: [],
  send: ['to', 'text', 'with-postage'],
  'packet.create': ['to', 'each', 'total', 'shares', 'ttl', 'memo'], 'packet.claim': [],
  'packet.refund': [], 'packet.show': [], 'packet.list': ['mine'],
  'request.create': ['payer', 'amount', 'token', 'ttl', 'memo', 'with-postage'],
  'request.pay': [], 'request.decline': [], 'request.cancel': [], 'request.list': ['mine'],
  'offer.create': ['to', 'give', 'give-token', 'want', 'want-token', 'ttl', 'memo', 'with-postage'],
  'offer.counter': ['give', 'want', 'ttl', 'memo', 'with-postage'], 'offer.accept': ['pay'],
  'offer.decline': [], 'offer.cancel': [], 'offer.show': [], 'offer.board': ['limit'],
  'contact.allow': [], 'contact.block': [], 'contact.unblock': [], 'postage.set': [], 'stamp.reclaim': [],
  withdraw: [], 'policy.show': [], 'policy.set': [],
  watch: ['limit', 'interval', 'once'],
  'deal.start': ['to', 'side', 'asset-token', 'asset-amount', 'unit', 'target', 'floor', 'ceiling', 'rounds', 'ttl', 'thread', 'with-postage'],
  'deal.next': ['with-postage'],
};
const argCounts = {
  result: 1, read: 1, ack: 1, 'packet.claim': 1, 'packet.refund': 1, 'packet.show': 1,
  'request.pay': 1, 'request.decline': 1, 'request.cancel': 1,
  'offer.accept': 1, 'offer.decline': 1, 'offer.cancel': 1, 'offer.counter': 1, 'offer.show': 1,
  'contact.allow': 1, 'contact.block': 1, 'contact.unblock': 1, 'stamp.reclaim': 1, 'postage.set': 1, 'policy.set': 2, 'deal.next': 1,
};
export async function run(argv, config, runtime = {}) {
  const { options: o, positional: pos } = parseArgs(argv);
  const first = pos.shift();
  const group = ['packet', 'request', 'offer', 'contact', 'postage', 'stamp', 'policy', 'key', 'deal'].includes(first);
  const command = group ? `${first}.${pos.shift()}` : first;
  input(Object.hasOwn(optionSets, command), '未知命令。请用 --help 查看命令。');
  const permitted = new Set([...(optionSets[command] || []), 'from', 'home', 'rpc', 'lang']);
  for (const k of Object.keys(o)) input(permitted.has(k), `命令不接受 --${k}。`);
  input(pos.length === (argCounts[command] || 0), '位置参数数量不正确。');
  input(!o.lang || ['zh', 'en'].includes(o.lang), '--lang 只能是 zh 或 en。');
  const required = {
    send: ['to', 'text'], 'request.create': ['payer', 'amount', 'token'],
    'offer.create': ['give', 'give-token', 'want', 'want-token'], 'offer.counter': ['give', 'want'],
    'deal.start': ['to', 'side', 'asset-token', 'asset-amount', 'unit', 'target'],
  };
  for (const k of required[command] || []) input(typeof o[k] === 'string' && o[k].length > 0, `缺少 --${k}。`);
  const from = address(o.from);
  if (!config.contract) fail('NOT_CONFIGURED', '尚未部署。请先配置真实部署或运行本地演示构建。');
  const dir = stateDir(config, from, o.home);
  return locked(dir, async () => {
    const chain = makeChain(config, o.rpc), p = policy(dir);
    const ctx = { chain, from, dir, p, command };
    if (command === 'policy.show') return response(ctx, p);
    if (command === 'policy.set') return response(ctx, setPolicy(dir, pos[0], pos[1]), {}, ['仅用户本人可以要求修改本地限额。']);
    await chain.verify();
    ctx.now = await chain.now();
    ctx.me = await chain.registry('handleOf', [from]);
    if (command === 'result') return response(ctx, await result(ctx, pos[0], o.plan));
    if (command === 'inbox') return inbox(ctx, integer(o.limit ?? '20', 1, 50));
    if (command === 'watch') {
      integer(o.interval ?? '15', 5, 3600);
      return { ...await inbox(ctx, integer(o.limit ?? '50', 1, 50), runtime.watchFrom), command: 'watch' };
    }
    if (command === 'read') return readMail(ctx, pos[0]);
    if (command === 'ack') return response(ctx, await ack(ctx, pos[0]));
    if (command === 'status') {
      const [mb, n, stamp, pending, count] = await chain.batch([
        { name: 'mailboxes', args: [from] }, { name: 'inboxLength', args: [from] },
        { name: 'postageOf', args: [from] }, { name: 'pending', args: [from] }, { name: 'dealsDone', args: [from] },
      ]);
      const m = mailbox(mb);
      return response(ctx, { from: ctx.me ? `${ctx.me}.ai` : null, hasAgentId: !!ctx.me, mailboxOpen: m.openedAt > 0,
        unread: Math.max(0, Number(n) - cursor(dir)), postage: human(stamp), pending: human(pending), completed: count,
        quotaLeft: m.quotaDay === Math.floor(ctx.now / 86400) ? 20 - Number(m.quotaUsed) : 20, policy: p });
    }
    ctx.bnb = await getToken(chain);
    if (command === 'open') {
      if (await chain.read('isMember', [from])) fail('ALREADY_OPEN', '信箱已经开通过了。');
      if (await chain.registry('balanceOf', [from]) === 0n) fail('NO_AGENT_ID', '这个钱包还没有 Agent ID。');
      const pub = ensureKey(dir);
      return prepare(ctx, { fn: 'openMailbox', args: [pub], summary: { mailbox: `${ctx.me}.ai` },
        expect: { event: 'MailboxOpened', fields: { owner: from, pubKey: pub } } });
    }
    if (command === 'key.rotate') {
      await member(ctx);
      const pub = rotateKey(dir);
      return prepare(ctx, { fn: 'setKey', args: [pub], summary: { publicKey: pub },
        warnings: ['旧密钥保留用于解密历史邮件。新公钥成功上链后才启用。'],
        expect: { event: 'KeyChanged', fields: { owner: from, pubKey: pub } } });
    }
    if (command.startsWith('packet.')) return packets(ctx, command.slice(7), pos, o);
    if (command === 'send') {
      await member(ctx);
      const h = handle(o.to), dest = await reach(ctx, h, o['with-postage']);
      input(typeof o.text === 'string', '缺少 --text。');
      const body = textPayload(o.text);
      const sealed = await encrypt(ctx, dest, body, 1);
      return prepare(ctx, { fn: 'sendMessage', args: [h, 1, sealed], semantic: [h, clean(o.text)], value: dest.postage,
        spending: spend(ctx.bnb, dest.postage), postage: dest.postage,
        summary: { to: `${h}.ai`, postage: human(dest.postage), bytes: body.length },
        outbox: { to: h, recipientPublicKey: dest.pubKey, plaintext: body.toString(), data: sealed },
        expect: { event: 'Mail', fields: { to: dest.address, from, kind: 1, data: sealed } } });
    }
    if (command.startsWith('request.')) return requests(ctx, command.slice(8), pos, o);
    if (command.startsWith('offer.')) return offers(ctx, command.slice(6), pos, o);
    if (command.startsWith('deal.')) return deals(ctx, command.slice(5), pos, o);
    if (command.startsWith('contact.')) {
      await member(ctx);
      const h = handle(pos[0]), a = await chain.registry('ownerOfHandle', [h]);
      checkTarget(ctx, a);
      const fn = { allow: 'allow', block: 'blockHandle', unblock: 'unblockHandle' }[command.slice(8)];
      return prepare(ctx, { fn, args: [h], summary: { name: `${h}.ai` },
        expect: { event: 'ContactSet', fields: { owner: from, other: a } } });
    }
    if (command === 'postage.set') {
      await member(ctx); const n = amount(pos[0], 18, (1n << 64n) - 1n, false);
      input(n <= await chain.read('MAX_POSTAGE'), '超过合约邮资上限。');
      return prepare(ctx, { fn: 'setPostage', args: [n], summary: { postage: human(n) },
        expect: { event: 'PostageSet', fields: { owner: from, postage: n } } });
    }
    if (command === 'stamp.reclaim') {
      const h = handle(pos[0]), a = await chain.registry('ownerOfHandle', [h]); checkTarget(ctx, a);
      const [n, sentAt] = await chain.read('stamps', [a, from]);
      if (n === 0n) fail('NOTHING_TO_DO', '没有可以取回的邮资。');
      if (ctx.now < Number(sentAt) + 259200) fail('NOT_EXPIRED', '第一笔邮资起尚未满 72 小时。');
      return prepare(ctx, { fn: 'reclaimStamp', args: [h], summary: { from: `${h}.ai`, amount: human(n) },
        expect: { event: 'StampReclaimed', fields: { from, to: a, amount: n } } });
    }
    if (command === 'withdraw') {
      const n = await chain.read('pending', [from]);
      if (!n) fail('NOTHING_TO_DO', '没有待提金额。');
      return prepare(ctx, { fn: 'withdraw', summary: { amount: human(n) },
        expect: { event: 'Withdrawn', fields: { to: from, amount: n } } });
    }
  }).then(r => localize(r,o.lang));
}
async function deals(ctx, action, pos, o) {
  await member(ctx);
  let s;
  if (action === 'start') {
    input(['sell', 'buy'].includes(o.side), '--side 只能是 sell 或 buy。');
    input(o.side === 'sell' ? !!o.floor && !o.ceiling : !!o.ceiling && !o.floor,
      'sell 必须给 --floor，buy 必须给 --ceiling。');
    const [asset, unit] = await Promise.all([getToken(ctx.chain, o['asset-token']), getToken(ctx.chain, o.unit)]);
    tokenWarnings([asset, unit], ctx.p);
    const values = { peer: handle(o.to), side: o.side,
      asset: { token: asset.address, amount: amount(o['asset-amount'], asset.decimals).toString() },
      unit: unit.address, target: amount(o.target, unit.decimals).toString(),
      ...(o.side === 'sell' ? { floor: amount(o.floor, unit.decimals).toString() } : { ceiling: amount(o.ceiling, unit.decimals).toString() }),
      rounds: integer(o.rounds ?? '5', 1, 20), expiresAt: ctx.now + ttl(o.ttl, 3600), ...(o.thread ? { thread: o.thread } : {}) };
    const old = o.thread && sessions(ctx.dir).find(v => v.thread === o.thread);
    if (old) {
      input(old.status === 'draft' && ['peer', 'side', 'unit', 'target', 'floor', 'ceiling', 'rounds']
        .every(k => old[k] === values[k]) && JSON.stringify(old.asset) === JSON.stringify(values.asset),
      '已有谈判不允许重设对象或底线。');
      s = old;
    } else {
      s = createSession(values);
      storeSession(ctx.dir, s);
    }
  } else {
    s = sessions(ctx.dir).find(v => v.thread === pos[0]);
    if (!s) fail('NOT_FOUND', '本机没有这场谈判；不能从来信自动建立底线。');
    if (['settled', 'rejected'].includes(s.status)) fail('NOT_OPEN', '本场谈判已结束。');
    if (ledger(ctx.dir).some(r => r.status === 'planned' && !r.approvalConfirmed && r.deal?.thread === s.thread && r.plannedAt > ctx.now - 600))
      fail('DEAL_PENDING', '这场谈判有待确认调用，请先核对回执。');
  }
  if (ctx.now >= s.expiresAt) fail('EXPIRED', '本场谈判已过期。');
  const effect = patch => ({ thread: s.thread, revision: s.revision, patch });
  if (s.status === 'awaiting_peer') {
    const current = offer(await ctx.chain.read('offers', [BigInt(s.offerId)]));
    if (current.status !== 1) {
      const status = current.status === 2 ? 'settled' : 'rejected';
      applyDealResult(ctx.dir, effect({ status }), null);
      return response(ctx, { thread: s.thread, status, offerId: s.offerId });
    }
  }
  async function sendDeal(state, type, patch, offerId = null) {
    const dest = await reach(ctx, s.peer, o['with-postage']);
    const payload = messageFor(state, type, offerId);
    const plaintext = Buffer.from(JSON.stringify(payload));
    const encrypted = await encrypt(ctx, dest, plaintext, 2);
    const [asset, unit] = await Promise.all([getToken(ctx.chain, s.asset.token), getToken(ctx.chain, s.unit)]);
    return prepare(ctx, { fn: 'sendMessage', args: [s.peer, 2, encrypted], semantic: [s.thread, payload],
      value: dest.postage, postage: dest.postage, spending: spend(ctx.bnb, dest.postage),
      summary: { thread: s.thread, to: `${s.peer}.ai`, type, round: state.round, rounds: s.rounds,
        give: tokenView(s.side === 'sell' ? asset : unit, BigInt(payload.give.amount)),
        want: tokenView(s.side === 'sell' ? unit : asset, BigInt(payload.want.amount)),
        expiresAt: s.expiresAt, offerId, binding: false },
      warnings: [...tokenWarnings([asset, unit], ctx.p), RISK,
        '谈判消息不成交、不授权；每一轮、创建报价及最终接受仍须分别预览和确认。'],
      untrusted: { tokens: untrustedTokens([asset, unit]) },
      outbox: { to: s.peer, recipientPublicKey: dest.pubKey, plaintext: plaintext.toString(), data: encrypted },
      deal: effect({ ...patch, seq: payload.seq }),
      expect: { event: 'Mail', fields: { from: ctx.from, to: dest.address, kind: 2, data: encrypted } } });
  }
  if (action === 'start' || s.status === 'draft') return sendDeal(s, 'quote', { status: 'open' });
  if (s.status === 'offer_created') {
    const v = await offerView(ctx, s.offerId);
    if (v.o.status !== 1 || Number(v.o.expiry) <= ctx.now) fail('NOT_OPEN', '链上报价已结束，不能发送接受通知。');
    const expected = messageFor(s);
    input(eq(v.o.giveToken, expected.give.token) && eq(v.o.wantToken, expected.want.token)
      && String(v.o.giveAmount) === expected.give.amount && String(v.o.wantAmount) === expected.want.amount,
    '实际托管数量与谈判不同；转账税代币不支持定量谈判。');
    return sendDeal(s, 'accept', { status: 'awaiting_peer' }, s.offerId);
  }
  const peerAddress = await ctx.chain.registry('ownerOfHandle', [s.peer]);
  const length = Number(await ctx.chain.read('inboxLength', [ctx.from]));
  let latest;
  for (let start = length; start > 0 && !latest;) {
    const begin = Math.max(0, start - 50);
    const mail = await ctx.chain.read('getMail', [ctx.from, BigInt(begin), BigInt(start - begin)]);
    for (const item of [...mail].reverse()) {
      if (Number(item.kind) !== 2 || !eq(item.from, peerAddress)) continue;
      try {
        const p = decrypt(ctx, item, 'deal');
        if (p.thread === s.thread && p.seq > s.receivedSeq && (!latest || p.seq > latest.seq)) latest = p;
      } catch { /* Malformed encrypted content cannot authorize a negotiation step. */ }
    }
    start = begin;
  }
  if (!latest) fail('NO_NEW_QUOTE', '没有新的有效报价消息，未产生调用。');
  const d = decide(s, latest, ctx.now), receivedSeq = latest.seq;
  if (d.action === 'peer_rejected') {
    applyDealResult(ctx.dir, effect({ status: 'rejected', receivedSeq }), null);
    return response(ctx, { thread: s.thread, status: 'rejected', peer: `${s.peer}.ai` });
  }
  if (d.action === 'quote') return sendDeal({ ...s, current: d.price, round: d.round }, 'quote',
    { current: d.price, round: d.round, receivedSeq, status: 'open' });
  if (d.action === 'reject') return sendDeal(s, 'reject', { status: 'rejected', receivedSeq });
  if (d.action === 'accept_offer') {
    const v = await offerView(ctx, d.offerId);
    input(eq(v.o.maker, peerAddress) && eq(v.o.taker, ctx.from) && Number(v.o.expiry) > ctx.now
      && eq(v.o.giveToken, latest.give.token) && eq(v.o.wantToken, latest.want.token)
      && String(v.o.giveAmount) === latest.give.amount && String(v.o.wantAmount) === latest.want.amount,
    '接受消息与真实链上报价不匹配。');
    ctx.deal = effect({ receivedSeq, status: 'settled' });
    return offers(ctx, 'accept', [String(d.offerId)], {});
  }
  ctx.deal = { ...effect({ receivedSeq, status: 'offer_created' }), createdOffer: true };
  const asset = await getToken(ctx.chain, s.asset.token), unit = await getToken(ctx.chain, s.unit);
  return offers(ctx, 'create', [], { to: s.peer,
    give: human(s.side === 'sell' ? s.asset.amount : d.price, s.side === 'sell' ? asset.decimals : unit.decimals),
    'give-token': s.side === 'sell' ? s.asset.token : s.unit,
    want: human(s.side === 'sell' ? d.price : s.asset.amount, s.side === 'sell' ? unit.decimals : asset.decimals),
    'want-token': s.side === 'sell' ? s.unit : s.asset.token,
    ttl: String(Math.min(604800, s.expiresAt - ctx.now, latest.validUntil - ctx.now)), 'with-postage': o['with-postage'] });
}
const spend = (token, n) => n > 0n ? [{ token, amount: n }] : [];
async function member(ctx) {
  if (!await ctx.chain.read('isMember', [ctx.from])) fail('NO_MAILBOX', '你还没有开通信箱。');
}
function checkTarget(ctx, a) {
  if (eq(a, ZERO)) fail('UNKNOWN_HANDLE', '没有这个名字的 Agent ID。');
  if (eq(a, ctx.from)) fail('SELF_TARGET', '不能对自己操作。');
}
async function reach(ctx, h, withPostage, needsMailbox = true) {
  const r = await ctx.chain.read('reach', [ctx.from, h]);
  if (!r[0]) fail('UNKNOWN_HANDLE', '没有这个名字的 Agent ID。');
  const a = await ctx.chain.registry('ownerOfHandle', [h]); checkTarget(ctx, a);
  if (needsMailbox && !r[1]) fail('RECIPIENT_NO_MAILBOX', '对方还没有开通信箱，可以先发定向红包。');
  if (r[2]) fail('BLOCKED', '对方拒收你的消息。');
  if (!r[3] && r[6] === 0n) fail('QUOTA_EXCEEDED', '今天的陌生人配额已用完。');
  if (needsMailbox && r[4] > 0n && !withPostage)
    fail('POSTAGE_REQUIRED', `第一次联系 ${h}.ai 需要附 ${human(r[4])} BNB 邮资。对方回应后归对方，72 小时未回应可取回。`, '先向用户说明并征得同意，再加 --with-postage。');
  return { address: a, pubKey: r[5], free: r[3], quota: Number(r[6]), postage: needsMailbox ? r[4] : 0n };
}
async function encrypt(ctx, dest, payload, kind) {
  const mb = mailbox(await ctx.chain.read('mailboxes', [ctx.from]));
  return `0x${seal(activeKey(ctx.dir, mb.pubKey), Buffer.from(dest.pubKey.slice(2), 'hex'),
    { chainId: ctx.chain.config.chainId, contract: ctx.chain.config.contract, from: ctx.from, to: dest.address, kind }, payload).toString('hex')}`;
}
async function memo(ctx, dest, text, kind) {
  if (!text) return { data: '0x' };
  const plaintext = textPayload(text, 'memo');
  const data = await encrypt(ctx, dest, plaintext, kind);
  return { data, saved: { to: dest.handle, recipientPublicKey: dest.pubKey, plaintext: plaintext.toString(), data } };
}
async function capCheck(ctx, token, n) {
  const cap = await ctx.chain.read('cap', [token.address]);
  if (cap > 0n && n > cap) fail('OVER_CAP', '超过合约单笔上限。');
}
async function packetView(ctx, id) {
  const p = packet(await ctx.chain.read('packets', [BigInt(id)]));
  if (eq(p.creator, ZERO)) fail('NOT_FOUND', '没有这个红包。');
  return { p, summary: { packetId: id, from: await ctx.chain.name(p.creator), amount: human(p.perShare), symbol: 'BNB',
    total: human(p.perShare * BigInt(p.shares)), remaining: human(p.remaining), sharesLeft: p.perShare ? Number(p.remaining / p.perShare) : 0,
    shares: Number(p.shares), claimed: Number(p.claimed), direct: p.direct, expiresAt: Number(p.expiry) },
    untrusted: { memo: clean(await ctx.chain.read('packetMemo', [BigInt(id)])) } };
}
async function packets(ctx, action, pos, o) {
  const { chain, from } = ctx;
  if (action === 'list') {
    const count = Number(await chain.read('packetCount'));
    const ids = o.mine ? ledger(ctx.dir).filter(r => r.fn === 'createPacket' && r.objectId).map(r => r.objectId)
      : Array.from({ length: Math.min(count, 200) }, (_, i) => count - i);
    const data = await chain.batch(ids.map(id => ({ name: 'packets', args: [BigInt(id)] })));
    const values = [];
    for (let i = 0; i < data.length; i++) {
      const p = packet(data[i]);
      if (!o.mine && (p.direct || Number(p.expiry) <= ctx.now || p.remaining === 0n)) continue;
      values.push(await packetView(ctx, ids[i]));
    }
    return response(ctx, { packets: values.map(v => v.summary), scanned: ids.length },
      { packets: values.map(v => ({ packetId: v.summary.packetId, ...v.untrusted })) });
  }
  if (action === 'create') {
    await member(ctx);
    input(!o.to || (!o.total && !o.shares), '定向红包使用 --each，不使用 --total/--shares。');
    input(!!o.to || !o.each, '公开红包使用 --total 和 --shares。');
    const handles = o.to ? o.to.split(',').map(handle) : [];
    input(new Set(handles).size === handles.length && handles.length <= 50, '定向名字重复或超过 50 个。');
    const shares = handles.length || integer(o.shares, 1, 500);
    const total = handles.length ? amount(o.each) * BigInt(shares) : amount(o.total);
    if (total % BigInt(shares)) fail('BAD_INPUT', `总额必须按 wei 整除份数。最近的可用总额：${human(total - total % BigInt(shares))} BNB。`);
    const min = await chain.read('MIN_SHARE');
    input(total / BigInt(shares) >= min, `每份至少 ${human(min)} BNB。`);
    const greeting = clean(o.memo || ''); input(byteLength(greeting) <= 280, '祝福语最多 280 字节。');
    await capCheck(ctx, ctx.bnb, total);
    let strangers = 0, quota = 20;
    for (const h of handles) {
      const r = await reach(ctx, h, false, false); quota = r.quota;
      if (!r.free) strangers++;
    }
    if (strangers > quota) fail('QUOTA_EXCEEDED', '定向红包中的陌生人数超过今日剩余配额。');
    return prepare(ctx, { fn: 'createPacket', args: [handles.length ? 0 : shares, ttl(o.ttl, 86400), handles, greeting],
      value: total, spending: spend(ctx.bnb, total),
      summary: { direct: !!handles.length, to: handles.map(h => `${h}.ai`), total: human(total), shares, perShare: human(total / BigInt(shares)) },
      untrusted: { memo: greeting },
      expect: { event: 'PacketCreated', fields: { creator: from, direct: !!handles.length, shares, perShare: total / BigInt(shares), memo: greeting } } });
  }
  const id = packetId(pos[0]), v = await packetView(ctx, id), { p } = v;
  if (action === 'show') return response(ctx, v.summary, v.untrusted);
  if (action === 'claim') {
    if (eq(from, p.creator)) fail('SELF_TARGET', '不能领取自己发的红包。');
    if (ctx.now >= Number(p.expiry)) fail('EXPIRED', '红包已过期。');
    if (p.remaining < p.perShare) fail('EMPTY', '红包已被领完。');
    const st = Number(await chain.read('packetState', [BigInt(id), from]));
    if (st === 2) fail('ALREADY_CLAIMED', '你已经领过了。');
    if (p.direct && st !== 1) fail('NOT_ELIGIBLE', '定向红包名单里没有你。');
    const open = !await chain.read('isMember', [from]);
    if (open && await chain.registry('balanceOf', [from]) === 0n) fail('NO_AGENT_ID', '这个钱包还没有 Agent ID。');
    const pub = open ? ensureKey(ctx.dir) : ZERO_KEY;
    return prepare(ctx, { fn: 'claimPacket', args: [BigInt(id), pub], summary: { ...v.summary, willOpenMailbox: open }, untrusted: v.untrusted,
      expect: { event: 'PacketClaimed', fields: { id, claimer: from } } });
  }
  if (!eq(p.creator, from)) fail('NOT_YOURS', '只能取回自己发的红包。');
  if (ctx.now < Number(p.expiry)) fail('NOT_EXPIRED', '红包还没过期。');
  if (p.remaining === 0n) fail('NOTHING_TO_DO', '没有剩余可退款金额。');
  return prepare(ctx, { fn: 'refundPacket', args: [BigInt(id)], summary: { packetId: id, amount: human(p.remaining) },
    expect: { event: 'PacketRefunded', fields: { id, creator: from } } });
}
async function requests(ctx, action, pos, o) {
  const { chain, from } = ctx;
  if (action === 'list') {
    const count = Number(await chain.read('requestCount'));
    const ids = o.mine ? ledger(ctx.dir).filter(r => r.fn === 'requestPayment' && r.objectId).map(r => r.objectId)
      : Array.from({ length: Math.min(count, 200) }, (_, i) => count - i);
    const list = [];
    for (const id of ids) {
      const r = request(await chain.read('requests', [BigInt(id)]));
      if (!eq(r.payee, from) && !eq(r.payer, from)) continue;
      const t = await getToken(chain, r.token);
      list.push({ id, from: await chain.name(r.payee), to: await chain.name(r.payer), amount: tokenView(t, r.amount),
        status: Number(r.status), expiresAt: Number(r.expiry) });
    }
    return response(ctx, { requests: list });
  }
  if (action === 'create') {
    await member(ctx);
    const h = handle(o.payer), dest = await reach(ctx, h, o['with-postage']); dest.handle = h;
    const token = await getToken(chain, o.token), n = amount(o.amount, token.decimals);
    const warnings = tokenWarnings([token], ctx.p); await capCheck(ctx, token, n);
    const m = await memo(ctx, dest, o.memo, 20);
    return prepare(ctx, { fn: 'requestPayment', args: [h, token.address, n, ttl(o.ttl, 259200), m.data],
      semantic: [h, token.address, n, ttl(o.ttl, 259200), o.memo || ''], value: dest.postage,
      postage: dest.postage, spending: spend(ctx.bnb, dest.postage), outbox: m.saved,
      summary: { payer: `${h}.ai`, amount: tokenView(token, n), postage: human(dest.postage) },
      warnings, untrusted: { tokens: untrustedTokens([token]) },
      expect: { event: 'RequestCreated', fields: { payee: from, payer: dest.address, token: token.address, amount: n } } });
  }
  const id = integer(pos[0], 1), r = request(await chain.read('requests', [BigInt(id)]));
  if (Number(r.status) !== 1) fail('NOT_OPEN', '收款请求不存在或已结束。');
  const target = action === 'cancel' ? r.payee : r.payer;
  if (!eq(target, from)) fail('NOT_YOURS', '你没有权限处理这份收款请求。');
  const fn = { pay: 'payRequest', decline: 'declineRequest', cancel: 'cancelRequest' }[action];
  const fields = { id, status: action === 'pay' ? 2 : action === 'decline' ? 3 : 4 };
  if (action !== 'pay') return prepare(ctx, { fn, args: [BigInt(id)], summary: { requestId: id }, expect: { event: 'RequestClosed', fields } });
  if (ctx.now >= Number(r.expiry)) fail('EXPIRED', '收款请求已过期。');
  const token = await getToken(chain, r.token), warnings = tokenWarnings([token], ctx.p);
  return prepare(ctx, { fn, args: [BigInt(id)], value: token.address === ZERO ? r.amount : 0n,
    spending: spend(token, r.amount), pay: { token, amount: r.amount },
    summary: { requestId: id, to: await chain.name(r.payee), pay: tokenView(token, r.amount) },
    warnings, untrusted: { tokens: untrustedTokens([token]) }, expect: { event: 'RequestClosed', fields } });
}
async function offerView(ctx, id) {
  const o = offer(await ctx.chain.read('offers', [BigInt(id)]));
  if (eq(o.maker, ZERO)) fail('NOT_FOUND', '没有这个报价。');
  const [give, want] = await Promise.all([getToken(ctx.chain, o.giveToken), getToken(ctx.chain, o.wantToken)]);
  return { o, give, want, summary: { offerId: id, maker: await ctx.chain.name(o.maker),
    to: eq(o.taker, ZERO) ? null : await ctx.chain.name(o.taker), give: tokenView(give, o.giveAmount),
    want: tokenView(want, o.wantAmount), expiresAt: Number(o.expiry), status: Number(o.status),
    completed: await ctx.chain.read('dealsDone', [o.maker]) } };
}
async function offers(ctx, action, pos, options) {
  const { chain, from } = ctx;
  let o = { ...options };
  if (action === 'board') {
    const count = Number(await chain.read('offerCount')), limit = integer(o.limit ?? '20', 1, 200);
    const ids = Array.from({ length: Math.min(count, 200) }, (_, i) => count - i);
    const data = await chain.batch(ids.map(id => ({ name: 'offers', args: [BigInt(id)] })));
    const views = [];
    for (let i = 0; i < data.length && views.length < limit; i++) {
      const v = offer(data[i]);
      if (v.status === 1 && eq(v.taker, ZERO) && Number(v.expiry) > ctx.now) views.push(await offerView(ctx, ids[i]));
    }
    return response(ctx, { offers: views.map(v => v.summary), scanned: ids.length },
      { tokens: untrustedTokens(views.flatMap(v => [v.give, v.want])) }, [RISK]);
  }
  if (action === 'show') {
    const v = await offerView(ctx, integer(pos[0], 1));
    return response(ctx, v.summary, { tokens: untrustedTokens([v.give, v.want]) }, [RISK]);
  }
  await member(ctx);
  let ref = 0n;
  if (action === 'counter') {
    const id = integer(pos[0], 1), v = await offerView(ctx, id);
    if (v.o.status !== 1) fail('NOT_OPEN', '原报价已结束。');
    if (!eq(v.o.taker, from)) fail('NOT_YOURS', '只有指定收件人可以还价。');
    if (ctx.now >= Number(v.o.expiry)) fail('EXPIRED', '原报价已过期。');
    o = { ...o, to: (await chain.registry('handleOf', [v.o.maker])), 'give-token': v.o.wantToken, 'want-token': v.o.giveToken };
    ref = BigInt(id);
  }
  if (action === 'create' || action === 'counter') {
    input(o.to || (!o.memo && !o['with-postage']), '公开报价不能带备注或邮资。');
    const dest = o.to ? await reach(ctx, handle(o.to), o['with-postage']) : null;
    const h = o.to ? handle(o.to) : '';
    if (dest) dest.handle = h;
    const [give, want] = await Promise.all([getToken(chain, o['give-token']), getToken(chain, o['want-token'])]);
    input(!eq(give.address, want.address), '报价两种资产不能相同。');
    const g = amount(o.give, give.decimals), w = amount(o.want, want.decimals);
    const warnings = [...tokenWarnings([give, want], ctx.p), RISK, '创建报价会托管你拿出的资产，直到成交、拒绝或撤回；过期后仍需发起撤回。'];
    await capCheck(ctx, give, g); await capCheck(ctx, want, w);
    const m = dest ? await memo(ctx, dest, o.memo, 30) : { data: '0x' };
    const stamp = dest?.postage || 0n, duration = ttl(o.ttl, 3600);
    const params = { toHandle: h, giveToken: give.address, giveAmount: g, wantToken: want.address, wantAmount: w,
      ttl: duration, stamp, refOfferId: ref, memo: m.data };
    return prepare(ctx, { fn: 'createOffer', args: [params], semantic: [{ ...params, memo: o.memo || '' }],
      value: (give.address === ZERO ? g : 0n) + stamp, postage: stamp,
      spending: [...spend(give, g), ...spend(ctx.bnb, stamp)], pay: { token: give, amount: g }, outbox: m.saved,
      summary: { to: h ? `${h}.ai` : null, give: tokenView(give, g), want: tokenView(want, w), postage: human(stamp), ttl: duration, counterTo: Number(ref) || null },
      warnings, untrusted: { tokens: untrustedTokens([give, want]) },
      expect: { event: 'OfferCreated', fields: { maker: from, taker: dest?.address || ZERO, giveToken: give.address, wantToken: want.address, wantAmount: w, refOfferId: ref } } });
  }
  const id = integer(pos[0], 1), v = await offerView(ctx, id), { o: deal } = v;
  if (deal.status !== 1) fail('NOT_OPEN', '报价已结束。');
  if (action === 'cancel' || action === 'decline') {
    if (!eq(action === 'cancel' ? deal.maker : deal.taker, from)) fail('NOT_YOURS', '你没有权限处理该报价。');
    return prepare(ctx, { fn: action === 'cancel' ? 'cancelOffer' : 'declineOffer', args: [BigInt(id)],
      summary: { offerId: id }, warnings: [RISK],
      expect: { event: 'OfferClosed', fields: { id, status: action === 'cancel' ? 4 : 3 } } });
  }
  if (ctx.now >= Number(deal.expiry)) fail('EXPIRED', '报价已过期。');
  if (!eq(deal.taker, ZERO) && !eq(deal.taker, from)) fail('NOT_YOURS', '报价不是发给你的。');
  if (eq(deal.maker, from)) fail('SELF_TARGET', '不能接受自己的报价。');
  if (eq(deal.taker, ZERO) && await chain.read('blocked', [deal.maker, from])) fail('BLOCKED', '对方拒绝与你交换。');
  const n = o.pay ? amount(o.pay, v.want.decimals) : deal.wantAmount;
  input(n >= deal.wantAmount, '支付数量不能小于对方要求。');
  input(v.want.address !== ZERO || !o.pay || n === deal.wantAmount, 'BNB 支付数量必须等于报价。');
  const warnings = [...tokenWarnings([v.give, v.want], ctx.p), RISK];
  return prepare(ctx, { fn: 'acceptOffer', args: [BigInt(id), n], value: v.want.address === ZERO ? n : 0n,
    spending: spend(v.want, n), pay: { token: v.want, amount: n },
    summary: { offerId: id, counterparty: v.summary.maker, completed: v.summary.completed, expiresAt: Number(deal.expiry),
      pay: tokenView(v.want, n), receive: tokenView(v.give, deal.giveAmount) },
    warnings, untrusted: { tokens: untrustedTokens([v.give, v.want]) },
    expect: { event: 'OfferSettled', fields: { id, taker: from } } });
}
