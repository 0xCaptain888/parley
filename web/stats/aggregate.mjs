const lower = a => a?.toLowerCase();
const stamp = e => Number(e.timestamp);
const actorFor = {
  MailboxOpened: 'owner', Mail: 'from', PacketCreated: 'creator', PacketClaimed: 'claimer',
  RequestCreated: 'payee', OfferCreated: 'maker', OfferSettled: 'taker', ContactSet: 'owner', PostageSet: 'owner',
};
export function aggregate(events, config, block, now) {
  const excluded = new Set(config.excluded.map(lower));
  const good = a => a && !excluded.has(lower(a));
  const sorted = [...events].sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber) || a.logIndex - b.logIndex);
  const stats = {
    updatedAt: now, block: Number(block), contract: config.contract, members: 0,
    mail: { text: 0, deal: 0 }, packets: { created: 0, claims: 0, claimsThatOpenedMailbox: 0, bnb: '0' },
    requests: { created: 0, paid: 0 }, offers: { created: 0, settled: 0, publicCreated: 0 },
    retention: { secondAction: 0, repliedAfterClaim: 0, secondActionMembers: 0, repliedClaimers: 0, claimers: 0 },
    pairs: 0, daily: [], excluded: config.excluded,
  };
  const members = new Map(), actions = new Map(), claims = new Map(), replied = new Set(), directions = new Set();
  const packets = new Map(), requests = new Map(), offers = new Map(), days = new Map();
  let bnb = 0n;
  const dayFor = t => {
    const date = new Date(t * 1000 + 8 * 3600000).toISOString().slice(0, 10);
    if (!days.has(date)) days.set(date, { date, newMembers: 0, active: new Set(), settled: 0 });
    return days.get(date);
  };
  const seenLogs = new Set();
  for (const e of sorted) {
    const key = `${e.transactionHash}:${e.logIndex}`;
    if (seenLogs.has(key)) continue;
    seenLogs.add(key);
    const a = e.args, n = e.eventName, day = dayFor(stamp(e));
    const actor = a[actorFor[n]];
    if (good(actor)) {
      const k = lower(actor);
      if (!actions.has(k)) actions.set(k, new Map());
      actions.get(k).set(e.transactionHash, e.blockNumber);
      day.active.add(k);
    }
    if (n === 'MailboxOpened' && good(a.owner) && !members.has(lower(a.owner))) {
      members.set(lower(a.owner), e.transactionHash); day.newMembers++;
    }
    if (n === 'PacketCreated') {
      packets.set(String(a.id), a);
      if (good(a.creator)) stats.packets.created++;
    }
    if (n === 'PacketClaimed' && good(a.claimer)) {
      stats.packets.claims++; bnb += BigInt(a.amount);
      if (a.openedMailbox) stats.packets.claimsThatOpenedMailbox++;
      const k = lower(a.claimer), p = packets.get(String(a.id));
      if (!claims.has(k)) claims.set(k, []);
      if (p) claims.get(k).push({ creator: lower(p.creator), order: [Number(e.blockNumber), e.logIndex] });
    }
    if (n === 'Mail' && good(a.from)) {
      if (Number(a.kind) === 1) stats.mail.text++;
      if (Number(a.kind) === 2) stats.mail.deal++;
      const from = lower(a.from), to = lower(a.to);
      if (good(to)) directions.add(`${from}|${to}`);
      if ((claims.get(from) || []).some(c => c.creator === to &&
        (Number(e.blockNumber) > c.order[0] || e.logIndex > c.order[1]))) replied.add(from);
    }
    if (n === 'RequestCreated') { requests.set(String(a.id), a); if (good(a.payee)) stats.requests.created++; }
    if (n === 'RequestClosed' && Number(a.status) === 2) {
      const r = requests.get(String(a.id));
      if (r && good(r.payer)) { stats.requests.paid++; day.settled++; }
    }
    if (n === 'OfferCreated') {
      offers.set(String(a.id), a);
      if (good(a.maker)) {
        stats.offers.created++;
        if (/^0x0{40}$/i.test(a.taker)) stats.offers.publicCreated++;
      }
    }
    if (n === 'OfferSettled' && good(a.taker)) { stats.offers.settled++; day.settled++; }
  }
  stats.members = members.size; stats.packets.bnb = bnb.toString();
  const second = [...members].filter(([who, opening]) => [...(actions.get(who)?.keys() || [])].some(tx => tx !== opening)).length;
  stats.retention = { secondAction: members.size ? second / members.size : 0,
    repliedAfterClaim: claims.size ? replied.size / claims.size : 0,
    secondActionMembers: second, repliedClaimers: replied.size, claimers: claims.size };
  stats.pairs = [...directions].filter(k => { const [a, b] = k.split('|'); return a < b && directions.has(`${b}|${a}`); }).length;
  stats.daily = [...days.values()].map(({ active, ...d }) => ({ ...d, activeMembers: active.size }));
  return stats;
}
