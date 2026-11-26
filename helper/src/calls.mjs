import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { encodeFunctionData } from 'viem';
import { tokenAbi, calldata } from './chain.mjs';
import { ZERO } from './normalize.mjs';
import { fail } from './errors.mjs';
import { checkPolicy, ledger } from './policy.mjs';
import { append, latestRows } from './state.mjs';

export const stringify = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
export function preview(call, from, chainId) {
  return `baw contract-call preview --binanceChainId ${chainId} --from ${from} --to ${call.to} --value ${call.value} --inputData ${call.data} --json`;
}
export async function prepare(ctx, spec) {
  const { chain, from, dir, p, now } = ctx;
  const { fn, args = [], value = 0n, spending = [], postage = 0n, pay, outbox, expect = {}, summary = {}, warnings = [], untrusted = {} } = spec;
  const business = { to: chain.config.contract, value: String(value), data: calldata(fn, args), label: fn, simulated: false };
  const semantic = createHash('sha256').update(stringify({ command: ctx.command, fn, args: spec.semantic ?? args, value })).digest('hex');
  const existing = ledger(dir).find(r => r.semantic === semantic && r.status === 'planned' && r.plannedAt > now - 600);
  // Random encryption must not change a pending preview's exact calldata on a retry.
  if (existing) business.data = existing.call.data;
  checkPolicy(p, ledger(dir).filter(r => r.id !== existing?.id), spending, now, postage);
  const balance = await chain.client.getBalance({ address: from });
  if (balance === 0n) fail('NO_GAS', '钱包没有 BNB 支付 gas。');
  if (balance <= value) fail('INSUFFICIENT_BALANCE', 'BNB 不足以同时支付本次金额和 gas。');
  for (const s of spending.filter(s => s.token.address !== ZERO)) {
    if (await chain.token(s.token.address, 'balanceOf', [from]) < s.amount) fail('INSUFFICIENT_BALANCE', '代币余额不足。');
  }
  const calls = [];
  if (pay && pay.token.address !== ZERO) {
    const allowance = await chain.token(pay.token.address, 'allowance', [from, chain.config.contract]);
    if (allowance < pay.amount) {
      const approval = {
        to: pay.token.address, value: '0',
        data: encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [chain.config.contract, pay.amount] }),
        label: '仅授权本次金额', simulated: true,
      };
      await chain.simulate(approval, from);
      calls.push(approval);
    } else if (allowance > pay.amount) warnings.push('现有授权超过本次金额；本脚本不会增加授权。建议在官方钱包检查并撤销多余授权。');
  }
  if (!calls.length) { await chain.simulate(business, from); business.simulated = true; }
  calls.push(business);
  const gasPrice=await chain.client.getGasPrice();
  for(const c of calls.filter(c=>c.simulated)){
    const estimate=await chain.client.estimateGas({account:from,to:c.to,data:c.data,value:BigInt(c.value)});
    if(balance<=BigInt(c.value)+estimate*gasPrice*120n/100n)
      fail('INSUFFICIENT_BALANCE','BNB 不足以支付本次金额和预估 gas（含 20% 余量）。');
  }
  const id = existing?.id || randomUUID();
  const record = {
    id, semantic, status: 'planned', command: ctx.command, fn, plannedAt: now,
    call: business, approval: calls.length === 2 ? calls[0] : null,
    ...(existing?.approvalConfirmed && calls.length === 1 ? { approvalConfirmed: true, approvalTxHash: existing.approvalTxHash } : {}),
    spending: spending.map(s => ({ address: s.token.address, symbol: s.token.symbol, amount: String(s.amount) })),
    expect: existing?.expect || JSON.parse(stringify(expect)), summary: JSON.parse(stringify(summary)),
    ...((spec.deal || ctx.deal) ? { deal: existing?.deal || spec.deal || ctx.deal } : {}),
  };
  append(path.join(dir, 'ledger.jsonl'), record);
  if (outbox) {
    const saved = existing && latestRows(path.join(dir, 'outbox.jsonl')).find(r => r.id === id);
    append(path.join(dir, 'outbox.jsonl'), { ...(saved || outbox), id, status: 'planned', plannedAt: now });
  }
  return {
    ok: true, command: ctx.command, planId: id, summary, warnings, untrusted,
    calls: calls.map((c, i) => ({ ...c, step: i + 1, of: calls.length, baw: preview(c, from, chain.config.chainId) })),
    next: calls.length === 2
      ? '第 1 步预览、逐笔确认并上链后，重新运行同一条命令。不要执行未模拟的第 2 步。'
      : `执行成功后运行：node parley.mjs result <txHash> --plan ${id} --from ${from}`,
  };
}
