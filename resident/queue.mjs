import { checkpointInputs } from './lifecycle.mjs';
import { proposals, withinBudget } from './rules.mjs';

export async function queueTick({ state, config, now, save, inbox, claims, prepare, ack,
  alert = () => {}, emit = () => {} }) {
  const box = await inbox();
  const items = [...(state.backlog || []), ...box.summary.items];
  state.lastInboxAt = now;
  if (claims) {
    try {
      const scanned = await claims(state);
      items.push(...scanned.items);
      state.claimCursor = scanned.cursor;
      state.lastClaimAt = now;
      state.claimReaderError = false;
    } catch {
      state.claimReaderError = true;
      alert('CLAIM_READER_UNAVAILABLE');
    }
  }
  // The cursor and every corresponding input must survive the first queue save.
  checkpointInputs(state, items);
  save(state);
  const pendingGifts = state.queue.filter(q => !['failed', 'cancelled'].includes(q.status))
    .map(q => q.effect?.gift).filter(Boolean);
  const backlog = [];
  for (const proposal of proposals(items, { ...state, pendingGifts }, config, now)) {
    if (state.queue.some(q => q.key === proposal.key && !['failed', 'cancelled'].includes(q.status))) continue;
    let prepared, bnb;
    try {
      prepared = await prepare(proposal.args);
      bnb = prepared.calls.reduce((n, c) => n + BigInt(c.value), 0n);
      if (!withinBudget(config, state.queue, bnb, now)) {
        alert('BUDGET_HELD');
        const item = items.find(i => i.index === proposal.index);
        if (item) backlog.push(item);
        continue;
      }
    } catch {
      alert('PREPARATION_FAILED');
      const item = items.find(i => i.index === proposal.index);
      if (item) backlog.push(item);
      continue;
    }
    const q = { ...proposal, id: prepared.planId, planId: prepared.planId, status: 'queued',
      createdAt: now, bnb: bnb.toString(), prepared };
    state.queue.push(q);
    // Persistence failures are fatal to this tick, not preparation errors to swallow.
    save(state);
    emit(q);
  }
  checkpointInputs(state, backlog);
  save(state);
  if (box.summary.items.length) await ack(box.summary.items.at(-1).index);
  state.lastTickAt = now;
  save(state);
}
