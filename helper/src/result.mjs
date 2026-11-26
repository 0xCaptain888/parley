import path from 'node:path';
import { decodeEventLog } from 'viem';
import { tokenAbi } from './chain.mjs';
import { ledger } from './policy.mjs';
import { append, latestRows } from './state.mjs';
import { input, fail } from './errors.mjs';
import { activeKey } from './keys.mjs';
import { applyDealResult } from './negotiation.mjs';

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
export async function result(ctx, hash, planId) {
  input(/^0x[0-9a-f]{64}$/i.test(hash), '需要完整的交易哈希。');
  const { chain, from, dir } = ctx;
  let receipt;
  try { receipt = await chain.client.getTransactionReceipt({ hash }); }
  catch (e) {
    if (e.name === 'TransactionReceiptNotFoundError') return { status: 'pending' };
    throw e;
  }
  input(same(receipt.from, from), '这笔交易不是由 --from 指定的钱包发出。');
  const events = chain.events(receipt);
  const transaction = await chain.client.getTransaction({ hash });
  const all = ledger(dir);
  const known = all.find(r => same(r.txHash, hash));
  if (known) {
    if (planId && planId !== known.id) fail('UNMATCHED_RECEIPT', '交易已关联到另一份计划，未修改账本。');
    if (known.status === 'confirmed') applyDealResult(dir, known.deal,
      events.find(e => e.eventName === known.expect.event));
    return { status: known.status, planId: known.id, objectId: known.objectId };
  }
  const candidates = all.filter(r => (!planId || r.id === planId) && r.status === 'planned'
    && [r.call,r.approval].filter(Boolean).some(c => same(receipt.to,c.to)
      && same(transaction.input,c.data) && BigInt(transaction.value)===BigInt(c.value)));
  if (planId && !candidates.length) fail('PLAN_NOT_FOUND', '没有匹配的待确认计划，或该计划已处理。');
  let matches = candidates.filter(r => {
    if (receipt.status === 'reverted') return true;
    if (r.approval && same(receipt.to, r.approval.to)) {
      return receipt.logs.some(l => {
        if (!same(l.address, r.approval.to)) return false;
        try {
          const d = decodeEventLog({ abi: tokenAbi, topics: l.topics, data: l.data });
          return d.eventName === 'Approval' && same(d.args.owner, from) && same(d.args.spender, chain.config.contract)
            && same(d.args.value, r.spending.find(s => same(s.address, r.approval.to))?.amount);
        } catch { return false; }
      });
    }
    return events.some(e => e.eventName === r.expect.event
      && Object.entries(r.expect.fields || {}).every(([k, v]) => same(e.args[k], v)));
  });
  if (matches.length > 1) fail('AMBIGUOUS_RECEIPT', '多份计划匹配，请用 --plan <planId> 指定。');
  const record = matches[0];
  if (!record) fail('UNMATCHED_RECEIPT', '回执与本地计划的目标或事件不匹配，未修改账本。');
  if (record.approval && same(receipt.to, record.approval.to)) {
    if (receipt.status === 'reverted') return { status: 'approval_failed', planId: record.id };
    append(path.join(dir, 'ledger.jsonl'), { ...record, approvalConfirmed: true, approvalTxHash: hash });
    return { status: 'approval_confirmed', planId: record.id, next: '授权已上链；重新运行原命令，重新预览并逐笔确认业务调用。' };
  }
  const event = events.find(e => e.eventName === record.expect.event
    && Object.entries(record.expect.fields || {}).every(([k, v]) => same(e.args[k], v)));
  const confirmedAt = Number((await chain.client.getBlock({ blockNumber: receipt.blockNumber })).timestamp);
  const updated = {
    ...record, status: receipt.status === 'reverted' ? 'failed' : 'confirmed', txHash: hash, confirmedAt,
    ...(event?.args.id !== undefined ? { objectId: Number(event.args.id) } : {}),
  };
  append(path.join(dir, 'ledger.jsonl'), updated);
  if (updated.status === 'confirmed') applyDealResult(dir, record.deal, event);
  const sent = latestRows(path.join(dir, 'outbox.jsonl')).find(r => r.id === record.id);
  if (sent) append(path.join(dir, 'outbox.jsonl'), { ...sent, status: updated.status, txHash: hash });
  if (updated.status === 'confirmed' && ['setKey', 'openMailbox', 'claimPacket'].includes(record.fn)) {
    const mb = await chain.read('mailboxes', [from]);
    // Activation only follows a mined key registration; retained keys remain available.
    try { activeKey(dir, mb[0]); } catch { /* Claim by an existing member does not need a local key. */ }
  }
  const out = { status: updated.status, planId: record.id, objectId: updated.objectId,
    block: Number(receipt.blockNumber), confirmedAt, txHash: hash, confirmations: '已入块；最终性取决于链，尚不视为审计证明。' };
  if (event?.eventName === 'PacketCreated') {
    const name = await chain.name(from);
    out.share = `${name} 发了一个 Parley 红包 #${event.args.id}\n只有 Agent ID 持有者能领，每人一份。\n对你的 Agent 说：领 Parley 红包 #${event.args.id}`
      + (chain.config.site ? `\n${chain.config.site}/p/${event.args.id}` : '');
  }
  return out;
}
