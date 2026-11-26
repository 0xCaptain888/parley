import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { editableStatuses, settleProposal, executeProposal, checkpointInputs } from './lifecycle.mjs';
import { withinBudget, proposals } from './rules.mjs';
import { stateDir } from '../helper/src/state.mjs';

test('execution intent survives timeout and cannot be resubmitted or released from budget', async () => {
  const q = { status: 'previewed', preview: { requestId: 'reviewed' }, bnb: '10' };
  const state = { queue: [q] }, saved = [];
  const save = value => saved.push(structuredClone(value));
  let calls = 0;
  const execute = async id => {
    calls++;
    assert.equal(id, 'reviewed');
    assert.equal(saved.at(-1).queue[0].status, 'broadcast_unknown');
    throw new Error('timeout');
  };
  await assert.rejects(executeProposal(state, q, save, execute, 100), /outcome unknown/);
  assert.equal(q.status, 'broadcast_unknown');
  assert.equal(editableStatuses.includes(q.status), false);
  assert.equal(withinBudget({ perTxBNB: '0.001', dailyBNB: '0.00000000000000001' }, [q], 1n, 200), false);
  await assert.rejects(executeProposal(state, q, save, execute, 101), /reviewed preview/);
  assert.equal(calls, 1);
});

test('save failure before broadcast never contacts wallet', async () => {
  let calls = 0;
  await assert.rejects(executeProposal({}, { status: 'previewed' }, () => { throw new Error('disk'); },
    async () => { calls++; }, 1), /disk/);
  assert.equal(calls, 0);
});

test('crash after wallet response leaves durable intent and prevents automatic resend', async () => {
  const q = { status: 'previewed', preview: { requestId: 'r' } }, state = { queue: [q] };
  let durable, saves = 0, broadcasts = 0;
  const save = value => {
    if (++saves === 2) throw new Error('disk unavailable');
    durable = structuredClone(value);
  };
  await assert.rejects(executeProposal(state, q, save, async () => {
    broadcasts++; return { data: { txHash: '0x123', status: 'SUCCESS' } };
  }, 1), /disk unavailable/);
  assert.equal(durable.queue[0].status, 'broadcast_unknown');
  await assert.rejects(executeProposal(durable, durable.queue[0], save, async () => { broadcasts++; }, 2));
  assert.equal(broadcasts, 1);
});

test('input checkpoint preserves all deferred actions across an intermediate queue-save crash', () => {
  const item = { index: 'claim:7:alice', from: 'alice.ai', kind: 'claim' };
  const state = { claimCursor: { nextBlock: '109' }, queue: [] };
  checkpointInputs(state, [item, structuredClone(item)]);
  state.queue.push({ key: 'welcome:alice', status: 'queued' });
  const restarted = structuredClone(state);
  assert.deepEqual(restarted.backlog, [item]);
  assert.equal(restarted.claimCursor.nextBlock, '109');
  const pending = proposals(restarted.backlog,
    { ...restarted, welcomed: [], gifted: [], publicDate: '1970-01-01', boardOpen: true },
    { welcome: 'hello', giftEach: '0.0001' }, 100);
  assert.ok(pending.some(q => q.key === 'gift:alice'));
});

test('wallet errors without a transaction remain unknown; tracked orders remain pending', async () => {
  for (const [response, status] of [
    [{ success: false, error: 'transport' }, 'broadcast_unknown'],
    [{ data: { status: 'SUCCESS', txHash: '0x123' } }, 'broadcast_pending'],
    [{ data: { status: 'PENDING_CONFIRMATION', orderId: 'order' } }, 'PENDING_CONFIRMATION'],
  ]) {
    const q = { status: 'previewed', preview: { requestId: 'r' } };
    await executeProposal({}, q, () => {}, async () => response, 1);
    assert.equal(q.status, status);
    assert.equal(editableStatuses.includes(status), false);
  }
});

test('settlement effects are idempotent and cannot downgrade a confirmed receipt', () => {
  const state = { gifted: [], welcomed: [] };
  const q = { status: 'broadcast_unknown', index: 1, effect: { gift: 'alice', welcome: 'alice', boardOpen: true } };
  settleProposal(state, q, { status: 'confirmed', confirmedAt: 123, objectId: 7 }, 124);
  settleProposal(state, q, { status: 'confirmed', confirmedAt: 130, objectId: 8 }, 130);
  settleProposal(state, q, { status: 'failed' }, 131);
  assert.deepEqual(state, { gifted: ['alice'], welcomed: ['alice'], boardOpen: true, boardId: 7 });
  assert.equal(q.status, 'confirmed');
  assert.equal(q.confirmedAt, 123);
});

test('failed approval can be reviewed again without applying business effects', () => {
  const state = { gifted: [], welcomed: [] }, q = { status: 'broadcast_unknown', effect: { gift: 'alice' } };
  settleProposal(state, q, { status: 'approval_failed' }, 100);
  assert.equal(q.status, 'failed');
  assert.deepEqual(state.gifted, []);
});

test('one confirmed action does not suppress deferred actions on the same inbox item', () => {
  const result = proposals([{ index: 1, from: 'alice.ai', kind: 'text', request: { id: 2, status: 1 } }],
    { handled: [1], welcomed: ['alice'], gifted: [], publicDate: '1970-01-01', boardOpen: true },
    { giftEach: '0.0001' }, 100);
  assert.deepEqual(result.map(q => q.key), ['gift:alice', 'request:2']);
});

test('resident state namespaces distinguish deployments and chains', () => {
  const home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'parley-resident-'));
  try {
    const from = `0x${'1'.repeat(40)}`, a = { chainId: 56, contract: `0x${'2'.repeat(40)}` };
    const first = stateDir(a, from, home);
    assert.notEqual(first, stateDir({ ...a, chainId: 97 }, from, home));
    assert.notEqual(first, stateDir({ ...a, contract: `0x${'3'.repeat(40)}` }, from, home));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
