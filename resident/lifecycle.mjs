export const editableStatuses = ['queued', 'previewed', 'risk_blocked', 'failed', 'cancelled'];

export function checkpointInputs(state, items) {
  state.backlog = [...new Map(items.map(item => [item.index, item])).values()];
}

export function settleProposal(state, q, summary, now) {
  // A confirmed business receipt must never be downgraded by a later lookup.
  if (q.status === 'confirmed') return;
  if (summary.status === 'confirmed') {
    q.status = 'confirmed';
    q.confirmedAt = summary.confirmedAt || now;
    for (const [effect, list] of [['gift', 'gifted'], ['welcome', 'welcomed']]) {
      const value = q.effect?.[effect];
      if (value && !state[list].includes(value)) state[list].push(value);
    }
    if (q.effect?.publicDate) {
      state.publicDate = q.effect.publicDate;
      state.publicPacketId = summary.objectId;
    }
    if (q.effect?.boardOpen) {
      state.boardOpen = true;
      state.boardId = summary.objectId;
    }
  } else if (['failed', 'approval_failed', 'approval_confirmed'].includes(summary.status)) {
    q.status = summary.status === 'approval_failed' ? 'failed' : summary.status;
  }
}

export async function executeProposal(state, q, save, execute, now) {
  if (q.status !== 'previewed') throw new Error('Only a reviewed preview can be executed.');
  // Persist intent before contacting the wallet: a lost response is not a failed transaction.
  q.status = 'broadcast_unknown';
  q.executionStartedAt = now;
  save(state);
  let result;
  try {
    result = await execute(q.preview.requestId);
  } catch (error) {
    throw new Error('Wallet execution outcome unknown. Do not retry; inspect the official wallet and settle its transaction.', { cause: error });
  }
  q.orderId = result.data?.orderId;
  q.txHash = result.data?.txHash;
  if (q.orderId || q.txHash) q.status = 'broadcast_pending';
  if (result.data?.status === 'PENDING_CONFIRMATION') q.status = 'PENDING_CONFIRMATION';
  q.walletStatus = result.data?.status || null;
  save(state);
  return result;
}
