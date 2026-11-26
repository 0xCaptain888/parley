import test from 'node:test';
import assert from 'node:assert/strict';
import { newKey, seal, open, OVERHEAD } from './envelope.mjs';

const ctx = { chainId: 56, contract: '0x' + '11'.repeat(20), from: '0x' + 'aa'.repeat(20), to: '0x' + 'bb'.repeat(20), kind: 1 };

test('round trip, overhead, sender re-open', () => {
  const A = newKey(), B = newKey();
  const msg = Buffer.from(JSON.stringify({ v: 1, t: 'text', body: '你好，bob' }));
  const env = seal(A, B.pub, ctx, msg);
  assert.equal(env.length, msg.length + OVERHEAD);
  assert.deepEqual(open(B, ctx, env), msg);
  const mine = Buffer.from(env); B.pub.copy(mine, 1);
  assert.deepEqual(open(A, ctx, mine), msg);
});

test('context binding and tamper detection', () => {
  const A = newKey(), B = newKey(), C = newKey();
  const env = seal(A, B.pub, ctx, Buffer.from('x'));
  assert.throws(() => open(B, { ...ctx, kind: 2 }, env));
  assert.throws(() => open(B, { ...ctx, to: '0x' + 'cc'.repeat(20) }, env));
  assert.throws(() => open(B, { ...ctx, chainId: 97 }, env));
  assert.throws(() => open(C, ctx, env));
  const bad = Buffer.from(env); bad[bad.length - 20] ^= 1;
  assert.throws(() => open(B, ctx, bad));
  assert.throws(() => seal(A, B.pub, ctx, Buffer.alloc(948)));
});
