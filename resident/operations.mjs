import assert from 'node:assert/strict';
import { amount, address } from '../helper/src/normalize.mjs';
import { sha256 } from '../scripts/evidence.mjs';
import { abi, offer, packet } from '../helper/src/chain.mjs';

const pending = new Set(['broadcast_unknown', 'broadcast_pending', 'PENDING_CONFIRMATION']);
const known = new Set(['queued', 'previewed', 'risk_blocked', 'failed', 'cancelled', 'confirmed', 'approval_confirmed', ...pending]);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const hash = value => /^0x[0-9a-f]{64}$/i.test(value || '');
const addresses = values => Array.isArray(values) && values.every(a => /^0x[0-9a-f]{40}$/i.test(a || ''))
  ? JSON.stringify(values.map(a => a.toLowerCase()).sort()) : null;
export function validateResidentState(state) {
  assert.ok(state && typeof state === 'object' && !Array.isArray(state), 'Invalid resident state');
  for (const key of ['queue', 'gifted', 'welcomed']) assert.ok(Array.isArray(state[key]), `Missing state array: ${key}`);
  assert.ok(new Set(state.queue.map(q => q.id)).size === state.queue.length, 'Duplicate queue ID');
  for (const q of state.queue) {
    assert.ok(typeof q.id === 'string' && q.id && typeof q.key === 'string', 'Invalid queue identity');
    assert.ok(known.has(q.status), 'Unknown queue status; manual reconciliation required');
    assert.match(q.bnb || '0', /^(0|[1-9][0-9]*)$/, 'Invalid queue budget');
    assert.ok(Number.isSafeInteger(q.createdAt) && q.createdAt >= 0, 'Invalid queue creation time');
  }
}
export function validateResidentBinding(build, from, manifest) {
  assert.ok(Number.isSafeInteger(build.chainId) && build.chainId > 0, 'Invalid chain ID');
  const expected = { chainId: build.chainId, contract: address(build.contract), from: address(from) };
  assert.deepEqual(manifest, expected, 'Resident deployment binding mismatch');
  return expected;
}

export function healthReport({ config, build, state, stats, now, lockPresent = false }) {
  const checks = [];
  const check = (code, ok, severity = 'critical') => checks.push({ code, status: ok ? 'passed' : severity });
  const configured = !!config?.from && !!build?.contract && build.deploymentBlock !== null;
  check('CONFIGURED', configured);
  check('MANUAL_MODE', config?.mode === 'manual');
  let valid = false, reserved = 0n, limit = 0n;
  try {
    validateResidentState(state);
    valid = true;
    limit = amount(config.dailyBNB);
    const perTx = amount(config.perTxBNB);
    check('BUDGET_CONFIG', perTx <= limit);
    for (const q of state.queue) if (!['failed', 'cancelled'].includes(q.status)
      && (q.status !== 'confirmed' || (q.confirmedAt ?? q.createdAt) > now - 86400)) reserved += BigInt(q.bnb || '0');
    check('BUDGET_AVAILABLE', reserved < limit, 'warning');
  } catch { check('STATE_OR_BUDGET_INVALID', false); }
  const recent = (value, max) => Number.isSafeInteger(value) && value <= now && now - value <= max;
  check('TICK_FRESH', valid && recent(state.lastTickAt, 180));
  check('INBOX_FRESH', valid && recent(state.lastInboxAt, 180));
  check('STATE_LOCK_PRESENT', !lockPresent, 'warning');
  check('PRICES_FRESH', recent(config?.pricesUpdatedAt, 86400), 'warning');
  let pricesValid = false;
  try { for (const symbol of ['BNB', 'USDT', 'USDC']) amount(config.pricesUSD[symbol], 8); pricesValid = true; } catch { /* Fail closed. */ }
  check('PRICES_VALID', pricesValid, 'warning');
  if (config?.logRpc) {
    check('CLAIM_READER_HEALTHY', valid && state.claimReaderError === false && recent(state.lastClaimAt, 180));
  }
  const queue = valid ? state.queue : [];
  check('NO_UNKNOWN_BROADCAST', !queue.some(q => q.status === 'broadcast_unknown'));
  check('NO_OVERDUE_PENDING', !queue.some(q => pending.has(q.status)
    && !recent(q.executionStartedAt ?? q.createdAt, 600)));
  check('QUEUE_RESPONSE_SLA', !queue.some(q => ['queued', 'previewed', 'approval_confirmed'].includes(q.status)
    && !recent(q.createdAt, 600)), 'warning');
  check('NO_RISK_BLOCKED', !queue.some(q => q.status === 'risk_blocked'), 'warning');
  check('NO_BACKLOG', valid && (!state.backlog || state.backlog.length === 0), 'warning');
  const date = new Date(now * 1000 + 8 * 3600000).toISOString().slice(0, 10);
  check('PUBLIC_PACKET_TODAY', valid && state.publicDate === date, 'warning');
  if (config?.boardOffer) check('BOARD_RECORDED_OPEN', valid && state.boardOpen === true && !!state.boardId, 'warning');
  check('STATS_FRESH', recent(stats?.updatedAt, 1200));
  check('STATS_DEPLOYMENT', configured && same(stats?.contract, build.contract)
    && Number.isSafeInteger(stats?.block) && stats.block >= build.deploymentBlock && hash(stats?.blockHash)
    && addresses(stats?.excluded) !== null && addresses(stats?.excluded) === addresses(build.excluded));
  const exitCode = checks.some(c => c.status === 'critical') ? 2 : checks.some(c => c.status === 'warning') ? 1 : 0;
  return { schemaVersion: 1, checkedAt: now, mode: 'local-read-only', status: ['healthy', 'warning', 'critical'][exitCode],
    exitCode, checks, reservedBNBWei: reserved.toString(), dailyBNBWei: limit.toString(),
    queue: { total: queue.length, pending: queue.filter(q => pending.has(q.status)).length },
    limitations: ['Recorded board/packet status is not a live expiry check', 'No gas or token balance observation',
      'A local report is not uptime or real-user evidence'], productionRelease: false };
}

export function migrationPlan(state, stateRaw, sourceBinding, targetBinding, targetExists) {
  validateResidentState(state);
  assert.deepEqual(sourceBinding, targetBinding, 'Cross-deployment migration is prohibited');
  assert.equal(targetExists, false, 'Never overwrite existing resident state');
  return { schemaVersion: 1, mode: 'manual-migration-plan', deployment: targetBinding,
    sourceStateSha256: sha256(stateRaw), preserveQueueEntries: state.queue.length,
    preserveReservedBNBWei: state.queue.filter(q => !['failed', 'cancelled'].includes(q.status))
      .reduce((n, q) => n + BigInt(q.bnb || '0'), 0n).toString(),
    preserveBacklogItems: state.backlog?.length || 0, preserveClaimCursor: state.claimCursor || null,
    requirements: ['Stop the resident and reconcile outstanding official-wallet orders',
      'Independently establish the legacy state deployment; a supplied manifest alone is not proof',
      'Back up the exact source bytes and verify this SHA256 before copying',
      'Copy all state fields without resetting queues, effects or budgets; write the exact deployment manifest',
      'Keep the source as a backup outside the legacy active path; never merge or overwrite a target',
      'Recheck the complete destination and only then decide whether to restart'],
    sourceModified: false, targetCreated: false, migrationApproved: false };
}

export async function inspectClaimAnchor(client, build, state) {
  assert.equal(await client.getChainId(), build.chainId, 'Wrong RPC chain');
  if (!state.claimCursor) return { status: 'replay_from_deployment', fromBlock: String(build.deploymentBlock),
    note: 'No authenticated cursor; old number-only heights are not trusted', stateModified: false };
  const anchor = state.claimCursor.anchor;
  const block = BigInt(anchor.block), head = await client.getBlockNumber({ cacheTime: 0 });
  assert.ok(block >= BigInt(build.deploymentBlock) && hash(anchor.hash), 'Invalid claim anchor');
  assert.equal(BigInt(state.claimCursor.nextBlock), block + 1n, 'Invalid next claim block');
  if (head < block + 12n) return { status: 'wait_for_confirmations', stateModified: false };
  const actual = await client.getBlock({ blockNumber: block });
  assert.equal(actual.number, block, 'Wrong block header');
  assert.ok(hash(actual.hash), 'Invalid block hash');
  const stable = await client.getBlock({ blockNumber: block });
  assert.equal(actual.hash, stable.hash, 'Chain changed during recovery');
  return { status: actual.hash === anchor.hash ? 'anchor_matches' : 'operator_reconciliation_required',
    block: block.toString(), savedHash: anchor.hash, canonicalHash: actual.hash,
    proposedReplayFrom: String(build.deploymentBlock),
    claimQueueToReview: state.queue.filter(q => String(q.index).startsWith('claim:')).map(q => ({
      queueId: q.id, status: q.status, mustNotResend: pending.has(q.status) || q.status === 'confirmed' })),
    stateModified: false, cursorRewound: false };
}

export async function inspectCampaigns(client, build, from, state) {
  assert.equal(await client.getChainId(), build.chainId, 'Wrong RPC chain');
  const head = await client.getBlockNumber({ cacheTime: 0 });
  assert.ok(head >= 12n, 'Insufficient confirmations');
  const blockNumber = head - 12n, block = await client.getBlock({ blockNumber });
  assert.ok(block.number === blockNumber && hash(block.hash), 'Invalid campaign block');
  const now = Number(block.timestamp);
  assert.ok(Number.isSafeInteger(now) && now > 0, 'Invalid block timestamp');
  const checks = [];
  const read = (functionName, id) => client.readContract({ address: build.contract, abi,
    functionName, args: [BigInt(id)], blockNumber });
  if (state.boardId) {
    const o = offer(await read('offers', state.boardId));
    checks.push({ code: 'LIVE_BOARD', status: same(o.maker, from) && Number(o.status) === 1
      && Number(o.expiry) > now ? 'passed' : 'warning' });
    checks.push({ code: 'BOARD_RENEWAL_WINDOW', status: Number(o.expiry) > now + 86400 ? 'passed' : 'warning' });
  } else checks.push({ code: 'LIVE_BOARD', status: 'warning' });
  if (state.publicPacketId) {
    const p = packet(await read('packets', state.publicPacketId));
    checks.push({ code: 'LIVE_PUBLIC_PACKET', status: same(p.creator, from) && !p.direct
      && Number(p.expiry) > now && BigInt(p.remaining) > 0n ? 'passed' : 'warning' });
    checks.push({ code: 'PACKET_RENEWAL_WINDOW', status: Number(p.expiry) > now + 86400 ? 'passed' : 'warning' });
  } else checks.push({ code: 'LIVE_PUBLIC_PACKET', status: 'warning' });
  assert.equal((await client.getBlock({ blockNumber })).hash, block.hash, 'Campaign chain changed during inspection');
  return { mode: 'public-chain-read-only', block: blockNumber.toString(), blockHash: block.hash,
    checkedAtChainTime: now, checks, mainnetBroadcast: false };
}

export function recoveryPlan(state, binding, stateRaw) {
  validateResidentState(state);
  return { schemaVersion: 1, mode: 'read-only-plan', deployment: binding, stateSha256: sha256(stateRaw),
    pending: state.queue.filter(q => pending.has(q.status)).map(q => ({
      queueId: q.id, planId: q.planId || null, status: q.status, reservedBNBWei: q.bnb || '0',
      orderId: q.orderId || null, txHash: hash(q.txHash) ? q.txHash : null,
      next: hash(q.txHash) ? 'VERIFY_TRANSACTION_THEN_SETTLE' : 'LOOK_UP_OFFICIAL_WALLET_ORDER_DO_NOT_RETRY',
    })),
    claimCursor: state.claimCursor || null,
    actions: ['Do not delete state or locks while an operator/process may be active',
      'For a changed claim anchor, review every queued claim against canonical receipts before any rewind',
      'For legacy migration, retain all queues, budget reservations, inputs and receipt provenance',
      'No automatic cancel, retry, migration or cursor rewind is authorized by this plan'],
    stateModified: false, walletAccess: false, mainnetBroadcast: false, productionRelease: false };
}

export async function inspectTransaction({ client, build, from, q, txHash }) {
  assert.ok(hash(txHash), 'Invalid transaction hash');
  assert.ok(pending.has(q.status), 'Only unresolved broadcast entries need recovery');
  const call = q.previewCall;
  assert.ok(call && /^0x[0-9a-f]*$/i.test(call.data) && q.planId, 'Exact preview call and plan ID are required');
  assert.equal(await client.getChainId(), build.chainId, 'Wrong RPC chain');
  let receipt;
  try { receipt = await client.getTransactionReceipt({ hash: txHash }); }
  catch (e) {
    if (e.name === 'TransactionReceiptNotFoundError') return { status: 'pending', next: 'WAIT_DO_NOT_RETRY', stateModified: false };
    throw e;
  }
  const tx = await client.getTransaction({ hash: txHash });
  assert.ok(same(tx.hash, txHash) && same(receipt.transactionHash, txHash), 'RPC returned another transaction');
  assert.ok(same(tx.from, from) && same(receipt.from, from), 'Transaction sender mismatch');
  assert.ok(same(tx.to, call.to) && same(receipt.to, call.to)
    && same(tx.input, call.data) && BigInt(tx.value) === BigInt(call.value), 'Transaction does not match exact reviewed call');
  assert.ok(receipt.blockNumber !== null && hash(receipt.blockHash), 'Invalid receipt block');
  assert.ok(['success', 'reverted'].includes(receipt.status), 'Invalid receipt status');
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  assert.ok(block.number === receipt.blockNumber && block.hash === receipt.blockHash, 'Receipt is not canonical');
  const head = await client.getBlockNumber({ cacheTime: 0 });
  if (head < receipt.blockNumber + 12n) return { status: 'confirming', next: 'WAIT_DO_NOT_RETRY', stateModified: false };
  const recheck = await client.getBlock({ blockNumber: receipt.blockNumber });
  assert.equal(recheck.hash, block.hash, 'Chain changed during recovery');
  return { status: 'settlement_required', receiptStatus: receipt.status, txHash, queueId: q.id, planId: q.planId,
    block: receipt.blockNumber.toString(), blockHash: block.hash,
    nextArguments: ['--settle', txHash, '--plan', q.planId, '--once'],
    note: 'Run the existing helper-backed settlement to validate business events; this inspection does not apply effects',
    stateModified: false, walletAccess: false, mainnetBroadcast: false };
}
