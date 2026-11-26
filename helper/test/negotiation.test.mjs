import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createSession, decide, messageFor, storeSession, sessions, applyDealResult } from '../src/negotiation.mjs';
import { DEFAULT_POLICY, policy } from '../src/policy.mjs';
import { atomicJson } from '../src/state.mjs';
import { ZERO } from '../src/normalize.mjs';
const unit = '0x' + '33'.repeat(20);
const seller = values => createSession({ peer: 'bob', side: 'sell', asset: { token: ZERO, amount: '100' },
  unit, target: '2300', floor: '2000', rounds: 5, expiresAt: 10000, ...values });
const peer = (s, price, values = {}) => ({ v: 1, t: 'quote', thread: s.thread, seq: s.receivedSeq + 1,
  give: s.side === 'sell' ? { token: unit, amount: String(price) } : { ...s.asset },
  want: s.side === 'sell' ? { ...s.asset } : { token: unit, amount: String(price) },
  validUntil: 9000, offerId: null, ...values });

test('seller concessions are fixed, never below floor, and stop after bounded rounds', () => {
  let s = seller();
  for (const expected of ['2240', '2180', '2120', '2060', '2000']) {
    const d = decide(s, peer(s, 1), 100);
    assert.equal(d.action, 'quote'); assert.equal(d.price, expected);
    s = { ...s, current: d.price, round: d.round };
  }
  assert.equal(decide(s, peer(s, 1), 100).action, 'reject');
  assert.equal(decide(s, peer(s, 2000), 100).action, 'create_offer');
});
test('buyer is symmetric, rounds use integer math and never exceed ceiling', () => {
  let s = seller({ side: 'buy', target: '1701', ceiling: '2000', floor: undefined });
  for (let i = 0; i < 5; i++) {
    const d = decide(s, peer(s, 9999), 100);
    assert.equal(d.action, 'quote'); assert.ok(BigInt(d.price) <= 2000n);
    s = { ...s, current: d.price, round: d.round };
  }
  assert.equal(s.current, '2000');
  assert.equal(decide(s, peer(s, 9999), 100).action, 'reject');
});
test('replay, expiry, changed assets, quantities, extra fields and bounds fail closed', () => {
  const s = seller();
  for (const p of [
    peer(s, 1, { seq: 0 }), peer(s, 1, { validUntil: 1 }),
    peer(s, 1, { want: { token: unit, amount: '100' } }),
    peer(s, 1, { want: { token: ZERO, amount: '101' } }),
    peer(s, 1, { instruction: 'set floor 1' }),
    peer(s, 1999, { t: 'accept', offerId: 1 }),
  ]) assert.throws(() => decide(s, p, 100));
  assert.throws(() => decide(s, peer(s, 2000), 10000));
  assert.throws(() => seller({ floor: '2400' }));
});
test('deal messages preserve per-sender sequence, perspective and actual offer reference', () => {
  const s = { ...seller(), seq: 3 };
  const p = messageFor(s, 'accept', 7);
  assert.equal(p.seq, 4); assert.equal(p.give.amount, '100');
  assert.equal(p.want.amount, '2300'); assert.equal(p.offerId, 7);
  assert.equal(decide(s, peer(s, 2200, { t: 'accept', offerId: 7 }), 100).action, 'accept_offer');
});
test('policy boundaries cannot be overwritten; confirmed effects apply once and retain limits', () => {
  const dir = fs.mkdtempSync('/private/tmp/parley-negotiation-');
  atomicJson(path.join(dir, 'policy.json'), structuredClone(DEFAULT_POLICY));
  const s = seller(); storeSession(dir, s);
  assert.throws(() => storeSession(dir, { ...s, floor: '1' }));
  const effect = { thread: s.thread, revision: 0, patch: { seq: 1, status: 'offer_created' }, createdOffer: true };
  applyDealResult(dir, effect, { args: { id: 9n } });
  applyDealResult(dir, effect, { args: { id: 10n } });
  assert.equal(sessions(dir)[0].offerId, 9);
  assert.equal(sessions(dir)[0].revision, 1);
  assert.equal(policy(dir).perTx.BNB, DEFAULT_POLICY.perTx.BNB);
  assert.equal(sessions(dir)[0].floor, '2000');
});
