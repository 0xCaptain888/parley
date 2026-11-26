import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { queueTick } from './queue.mjs';
import { atomicJson, readJson, locked } from '../helper/src/state.mjs';
import { executeProposal, settleProposal } from './lifecycle.mjs';

const now = 1795400000;
const date = new Date(now * 1000 + 8 * 3600000).toISOString().slice(0, 10);
const config = { welcome: 'hello', giftEach: '0.0001', perTxBNB: '0.002', dailyBNB: '0.002',
  publicPacket: { total: '0.002', shares: 20 } };
const fresh = () => ({ queue: [], gifted: [], welcomed: [], backlog: [], boardOpen: true, publicDate: date });
function fixture(t) {
  const dir = fs.mkdtempSync('/private/tmp/parley-queue-'), file = `${dir}/state.json`;
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const f = { state: fresh(), acked: [], emitted: [], alerts: [], counter: 0 };
  f.input = [{ index: 1, kind: 'text', from: 'alice.ai' }];
  f.save = s => atomicJson(file, s);
  f.restart = () => { f.state = readJson(file); };
  f.dependencies = () => ({
    state: f.state, config, now, save: f.save,
    inbox: async () => ({ summary: { items: f.input } }),
    claims: async () => ({ items: [{ index: 'claim:7:bob', kind: 'claim', from: 'bob.ai',
      claim: { block: '105', blockHash: 'canonical' } }], cursor: { nextBlock: '109' } }),
    prepare: async args => ({ planId: `p${++f.counter}`, calls: [{ value: args[0] === 'packet' ? '100000000000000' : '0' }] }),
    ack: async index => { f.acked.push(index); },
    emit: q => f.emitted.push(q.key), alert: code => f.alerts.push(code),
  });
  f.tick = overrides => locked(dir, () => queueTick({ ...f.dependencies(), ...overrides }));
  return f;
}

test('real disk pipeline survives queue-save crash, duplicate inbox/claim replay and restart', async t => {
  const f = fixture(t);
  let saves = 0;
  await assert.rejects(f.tick({ save: s => { if (++saves === 3) throw new Error('crash'); f.save(s); } }), /crash/);
  assert.deepEqual(f.acked, []);
  f.restart();
  assert.equal(f.state.queue.length, 1);
  assert.equal(f.state.backlog.length, 2);
  assert.equal(f.state.claimCursor.nextBlock, '109');
  await f.tick();
  f.restart();
  assert.deepEqual(f.state.queue.map(q => q.key).sort(), ['gift:alice', 'gift:bob', 'welcome:alice', 'welcome:bob']);
  await f.tick();
  assert.equal(f.state.queue.length, 4);
  assert.deepEqual(f.acked, [1, 1]);
});

test('claim RPC/reorg failure allows mailbox work without advancing claim cursor or leaking errors', async t => {
  const f = fixture(t); f.state.claimCursor = { nextBlock: '109' };
  await f.tick({ claims: async () => { throw new Error('https://secret:password@rpc.invalid'); } });
  f.restart();
  assert.equal(f.state.claimCursor.nextBlock, '109');
  assert.equal(f.state.claimReaderError, true);
  assert.equal(f.state.lastClaimAt, undefined);
  assert.equal(f.state.lastTickAt, now);
  assert.deepEqual(f.state.queue.map(q => q.key), ['welcome:alice', 'gift:alice']);
  assert.deepEqual(f.alerts, ['CLAIM_READER_UNAVAILABLE']);
});

test('budget deferral retains input, permits zero-value work and recovers without duplicate actions', async t => {
  const f = fixture(t);
  f.state.queue.push({ id: 'unknown', status: 'broadcast_unknown', key: 'prior', bnb: '2000000000000000' });
  await f.tick({ claims: null });
  f.restart();
  assert.equal(f.state.backlog.length, 1);
  assert.ok(f.state.queue.some(q => q.key === 'welcome:alice'));
  assert.ok(!f.state.queue.some(q => q.key === 'gift:alice'));
  f.state.queue[0].status = 'failed'; f.save(f.state); f.input = [];
  await f.tick({ claims: null }); f.restart();
  assert.equal(f.state.queue.filter(q => q.key === 'welcome:alice').length, 1);
  assert.equal(f.state.queue.filter(q => q.key === 'gift:alice').length, 1);
  assert.deepEqual(f.state.backlog, []);
});

test('ack failure leaves durable proposals; retry neither loses nor duplicates them', async t => {
  const f = fixture(t);
  await assert.rejects(f.tick({ ack: async () => { throw new Error('ack unavailable'); } }), /ack unavailable/);
  f.restart(); assert.equal(f.state.queue.length, 4);
  assert.equal(f.state.lastTickAt, undefined);
  await f.tick(); f.restart(); assert.equal(f.state.queue.length, 4);
});

test('inbox RPC failure does not write state or acknowledge inputs', async t => {
  const f = fixture(t); let saves = 0;
  await assert.rejects(f.tick({ inbox: async () => { throw new Error('RPC'); }, save: () => { saves++; } }), /RPC/);
  assert.equal(saves, 0); assert.deepEqual(f.acked, []);
});

test('preparation failures survive restart and preserve unrelated successful work', async t => {
  const f = fixture(t), deps = f.dependencies();
  await f.tick({ prepare: async args => { if (args[0] === 'packet') throw new Error('simulation'); return deps.prepare(args); } });
  f.restart(); assert.equal(f.state.backlog.length, 2); assert.equal(f.state.queue.length, 2);
  f.input = []; await f.tick();
  assert.equal(f.state.queue.length, 4); assert.deepEqual(f.state.backlog, []);
});

test('pipeline queues never broadcast; explicitly simulated execution timeout remains reserved after restart', async t => {
  const f = fixture(t); await f.tick({ claims: null }); f.restart();
  const gift = f.state.queue.find(q => q.key === 'gift:alice');
  gift.status = 'previewed'; gift.preview = { requestId: 'fake-preview' }; f.save(f.state);
  await assert.rejects(executeProposal(f.state, gift, f.save, async () => { throw new Error('lost response'); }, now));
  f.restart();
  const pending = f.state.queue.find(q => q.id === gift.id);
  assert.equal(pending.status, 'broadcast_unknown');
  settleProposal(f.state, pending, { status: 'confirmed', confirmedAt: now }, now);
  f.save(f.state); f.restart();
  await f.tick({ claims: null });
  assert.equal(f.state.queue.filter(q => q.key === 'gift:alice').length, 1);
  assert.deepEqual(f.state.gifted, ['alice']);
});

test('parallel queue writers are excluded by the actual state-directory lock', async t => {
  const f = fixture(t); let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const first = f.tick({ inbox: async () => { await blocked; return { summary: { items: [] } }; }, claims: null });
  try { await assert.rejects(f.tick(), e => e.code === 'STATE_BUSY'); }
  finally { release(); await first; }
});
