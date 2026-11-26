import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { forkInputs } = createRequire(import.meta.url)('../../contracts/scripts/fork-inputs.js');
const a = `0x${'1'.repeat(40)}`, b = `0x${'a'.repeat(40)}`;
const valid = { FORK_RPC: 'https://example.invalid', FORK_BLOCK: '123', FORK_ACTORS: `${a}, ${b}` };

test('fork inputs require a fixed block and two distinct nonzero actors', () => {
  assert.deepEqual(forkInputs(valid), { block: 123, actors: [a, b] });
  for (const block of ['', '0', '-1', '1.5', '1e3', '9007199254740992'])
    assert.throws(() => forkInputs({ ...valid, FORK_BLOCK: block }), /FORK_BLOCK/);
  for (const actors of ['', a, `${a},${a}`, `${b},${b.toUpperCase().replace('0X', '0x')}`,
    `${a},0x${'0'.repeat(40)}`, `${a},${b},${a}`])
    assert.throws(() => forkInputs({ ...valid, FORK_ACTORS: actors }), /FORK_ACTORS/);
});

test('fork inputs reject missing or non-HTTP RPC without exposing credentials', () => {
  for (const rpc of ['', 'invalid', 'file:///private/secret', 'wss://example.invalid'])
    assert.throws(() => forkInputs({ ...valid, FORK_RPC: rpc }), /FORK_RPC/);
  assert.equal(forkInputs({ ...valid, FORK_RPC: 'https://user:secret@example.invalid' }).block, 123);
});
