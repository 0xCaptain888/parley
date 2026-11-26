import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inspectFork, REGISTRY, USDT } from '../../scripts/fork-preflight.mjs';
const actors = [`0x${'1'.repeat(40)}`, `0x${'2'.repeat(40)}`];
const block = 135178626;
const blockHash = `0x${'a'.repeat(64)}`;
const evidence = JSON.parse(fs.readFileSync(new URL('../../docs/reports/registry-sourcify-2026-11-23.json', import.meta.url)));
function fixture(overrides = {}) {
  const calls = [];
  const client = {
    getChainId: async () => 56,
    getBlock: async () => ({ number: BigInt(block), hash: blockHash, timestamp: 1795000000n }),
    getBytecode: async ({ address }) => address === REGISTRY ? evidence.runtimeBytecode.onchainBytecode : '0x6000',
    readContract: async args => {
      calls.push(args);
      const { address, functionName, args: params } = args;
      if (functionName === 'decimals') return 18;
      if (address === REGISTRY) {
        if (functionName === 'balanceOf') return 1n;
        if (functionName === 'handleOf') return params[0] === actors[0] ? 'alice' : 'bob';
        if (functionName === 'ownerOfHandle') return params[0] === 'alice' ? actors[0] : actors[1];
      }
      return 10n ** 18n;
    },
    ...overrides,
  };
  return { client, calls };
}
test('preflight binds every state read to a fixed block and only needs a read client', async () => {
  const { client, calls } = fixture();
  const report = await inspectFork(client, { block, actors });
  assert.equal(report.status, 'passed');
  assert.equal(report.forkBlockHash, blockHash);
  assert.equal(report.checks.length, 6);
  assert.ok(calls.every(call => call.blockNumber === BigInt(block)));
  assert.equal(report.mainnetBroadcast, false);
});
test('preflight rejects a wrong chain before any contract reads', async () => {
  const { client, calls } = fixture({ getChainId: async () => 97 });
  const report = await inspectFork(client, { block, actors });
  assert.equal(report.status, 'failed');
  assert.equal(calls.length, 0);
});
test('preflight rejects missing code and a changed registry runtime', async () => {
  for (const code of [undefined, '0x', '0x6000']) {
    const { client } = fixture({ getBytecode: async () => code });
    const report = await inspectFork(client, { block, actors });
    assert.equal(report.status, 'failed');
    assert.equal(report.checks.at(-1).name, 'deployed registry and token code');
  }
});
test('preflight preserves exact insufficient balances without pretending readiness', async () => {
  const { client } = fixture();
  const read = client.readContract;
  client.readContract = async args => args.address === USDT && args.functionName === 'balanceOf' ? 1n : read(args);
  const report = await inspectFork(client, { block, actors });
  assert.equal(report.status, 'failed');
  assert.equal(report.startingBalances.bUsdt, '1');
  assert.match(report.checks.at(-1).reason, /Insufficient/);
});
test('preflight rejects mismatched ownership and pre-Osaka blocks', async () => {
  const { client } = fixture();
  const read = client.readContract;
  client.readContract = async args => args.functionName === 'ownerOfHandle' ? actors[1] : read(args);
  assert.equal((await inspectFork(client, { block, actors })).status, 'failed');
  const old = fixture({ getBlock: async () => ({ number: BigInt(block), hash: blockHash, timestamp: 1n }) });
  assert.equal((await inspectFork(old.client, { block, actors })).status, 'failed');
});
test('preflight detects a block-hash change', async () => {
  let count = 0;
  const { client } = fixture({ getBlock: async () => ({
    number: BigInt(block), hash: ++count === 1 ? blockHash : `0x${'b'.repeat(64)}`, timestamp: 1795000000n,
  }) });
  const report = await inspectFork(client, { block, actors });
  assert.equal(report.status, 'failed');
  assert.match(report.checks.at(-1).reason, /hash changed/);
});
test('preflight does not leak RPC credentials from transport exceptions', async () => {
  const { client } = fixture({ getChainId: async () => {
    throw new Error('https://user:secret@example.invalid/private-token Authorization: Bearer session');
  } });
  const report = await inspectFork(client, { block, actors });
  assert.equal(report.status, 'failed');
  assert.doesNotMatch(JSON.stringify(report), /secret|private-token|Bearer|session/);
});
