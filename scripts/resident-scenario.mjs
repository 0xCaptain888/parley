import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { run } from '../helper/src/app.mjs';
import { makeChain } from '../helper/src/chain.mjs';
import { atomicJson, readJson, locked } from '../helper/src/state.mjs';
import { queueTick } from '../resident/queue.mjs';
import { scanClaims, verifyClaim } from '../resident/claims.mjs';
import { executeProposal, settleProposal } from '../resident/lifecycle.mjs';
import { inspectTransaction, inspectClaimAnchor } from '../resident/operations.mjs';

export async function exerciseResident(f) {
  const { alice, bob, carol, home, config: build, provider } = f;
  const command = (who, args) => run([...args, '--from', who.address, '--home', home], build);
  const checks = [];
  const pass = name => checks.push({ name, status: 'passed' });
  const act = async (who, args) => {
    const prepared = await command(who, args);
    assert.equal(prepared.calls.length, 1); assert.equal(prepared.calls[0].simulated, true);
    const c = prepared.calls[0], tx = await who.sendTransaction({ to: c.to, data: c.data, value: BigInt(c.value) });
    await tx.wait();
    return (await command(who, ['result', tx.hash, '--plan', prepared.planId])).summary;
  };
  await command(alice, ['ack', 'all']);
  await act(carol, ['send', '--to', 'alice', '--text', 'resident local fault fixture']);
  const packet = await act(alice, ['packet', 'create', '--total', '0.000002', '--shares', '2']);
  const chain = makeChain(build), anchor = await chain.client.getBlock();
  const snapshot = await provider.send('evm_snapshot', []);
  await act(bob, ['packet', 'claim', String(packet.objectId)]);
  for (let i = 0; i < 13; i++) await provider.send('evm_mine', []);
  const now = Number((await chain.client.getBlock()).timestamp);
  const config = { mode: 'manual', welcome: 'local fixture', giftEach: '0.000001', dailyBNB: '0.01', perTxBNB: '0.002',
    publicPacket: { total: '0.002', shares: 20 } };
  const dir = path.join(home, 'resident-scenario'); fs.mkdirSync(dir);
  const file = path.join(dir, 'state.json'), save = s => atomicJson(file, s);
  let state = { queue: [], gifted: [], welcomed: [], backlog: [], boardOpen: true,
    publicDate: new Date(now * 1000 + 28800000).toISOString().slice(0, 10),
    claimCursor: { nextBlock: (anchor.number + 1n).toString(), anchor: { block: anchor.number.toString(), hash: anchor.hash } } };
  const tick = () => locked(dir, () => queueTick({ state, config, now, save,
    inbox: () => command(alice, ['inbox', '--limit', '50']),
    claims: s => scanClaims(chain, build, alice.address, s),
    prepare: args => command(alice, args), ack: index => command(alice, ['ack', String(index)]),
  }));
  await tick(); state = readJson(file);
  assert.deepEqual(state.queue.map(q => q.key).sort(), ['gift:bob', 'gift:carol', 'welcome:bob', 'welcome:carol']);
  pass('real local inbox and canonical claim produce four durable proposals without broadcasting');
  await tick(); state = readJson(file); assert.equal(state.queue.length, 4);
  pass('actual helper inbox acknowledgement and claim cursor replay do not duplicate proposals');
  const claimed = state.queue.find(q => q.key === 'gift:bob');
  await verifyClaim(chain, build, alice.address, claimed.claim);
  pass('claim approval provenance verifies against actual local receipt and registry');
  assert.equal(await provider.send('evm_revert', [snapshot]), true);
  for (let i = 0; i < 20; i++) await provider.send('evm_mine', []);
  await assert.rejects(verifyClaim(chain, build, alice.address, claimed.claim));
  const recovery = await inspectClaimAnchor(chain.client, build, state);
  assert.equal(recovery.status, 'operator_reconciliation_required');
  assert.equal(recovery.cursorRewound, false);
  pass('actual local chain reorganization invalidates orphan claim and preserves recovery cursor');
  const gift = state.queue.find(q => q.key === 'gift:carol');
  const prepared = await command(alice, gift.args);
  gift.planId = prepared.planId; gift.previewCall = prepared.calls[0];
  gift.status = 'previewed'; gift.preview = { requestId: 'LOCAL-FAULT-FIXTURE-NOT-A-WALLET-PREVIEW' };
  save(state);
  let txHash;
  await assert.rejects(executeProposal(state, gift, save, async () => {
    const c = gift.previewCall;
    const tx = await alice.sendTransaction({ to: c.to, data: c.data, value: BigInt(c.value) });
    txHash = tx.hash; await tx.wait();
    throw new Error('Simulated response loss after local transaction mined');
  }, now));
  state = readJson(file);
  const unknown = state.queue.find(q => q.id === gift.id);
  assert.equal(unknown.status, 'broadcast_unknown');
  pass('lost response after actual local transaction preserves unknown status on disk');
  let called = false;
  await assert.rejects(executeProposal(state, unknown, save, async () => { called = true; }, now));
  assert.equal(called, false);
  pass('restarted unknown transaction cannot be sent again');
  for (let i = 0; i < 13; i++) await provider.send('evm_mine', []);
  const inspection = await inspectTransaction({ client: chain.client, build, from: alice.address, q: unknown, txHash });
  assert.equal(inspection.status, 'settlement_required'); assert.equal(unknown.status, 'broadcast_unknown');
  pass('canonical exact-call recovery inspection recommends settlement without modifying state');
  const result = await command(alice, ['result', txHash, '--plan', unknown.planId]);
  settleProposal(state, unknown, result.summary, now); save(state);
  settleProposal(state, unknown, (await command(alice, ['result', txHash, '--plan', unknown.planId])).summary, now);
  save(state); state = readJson(file);
  assert.equal(state.queue.find(q => q.id === gift.id).status, 'confirmed');
  assert.deepEqual(state.gifted, ['carol']);
  pass('helper event settlement and duplicate receipt apply gift effect exactly once');
  return { environment: 'LOCAL ONLY (31337)', checks, realWallet: false, mainnetBroadcast: false,
    source: 'Actual local contracts and disk state; synthetic identities, preview and transport fault' };
}
