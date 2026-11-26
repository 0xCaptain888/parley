import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeEventTopics, encodeAbiParameters } from 'viem';
import { abi } from '../helper/src/chain.mjs';
import { scanClaims, verifyClaim } from './claims.mjs';
import { proposals } from './rules.mjs';

const wallet = `0x${'1'.repeat(40)}`, claimer = `0x${'2'.repeat(40)}`;
const build = { contract: `0x${'3'.repeat(40)}`, registry: `0x${'4'.repeat(40)}`, deploymentBlock: 100 };
const hash = number => `0x${BigInt(number).toString(16).padStart(64, '0')}`;
function fixture() {
  const f = { head: 120n, hashes: new Map(), logs: [], queries: [], reads: [], owner: claimer, creator: wallet };
  f.blockHash = number => f.hashes.get(number) || hash(number + 1000n);
  f.log = number => ({
    address: build.contract, blockNumber: number, blockHash: f.blockHash(number),
    transactionHash: hash(42), logIndex: 1, removed: false,
    topics: encodeEventTopics({ abi, eventName: 'PacketClaimed', args: { id: 7n, claimer } }),
    data: encodeAbiParameters([{ type: 'uint128' }, { type: 'bool' }], [1n, true]),
  });
  const client = {
    getBlockNumber: async () => f.head,
    getBlock: async ({ blockNumber }) => ({ number: blockNumber, hash: f.blockHash(blockNumber) }),
    getLogs: async query => { f.queries.push(query); return f.logs; },
    readContract: async query => {
      f.reads.push(query);
      if (query.functionName === 'packets') return [f.creator];
      if (query.functionName === 'handleOf') return 'alice';
      if (query.functionName === 'ownerOfHandle') return f.owner;
      throw new Error('Unexpected read');
    },
    getTransactionReceipt: async () => ({
      status: 'success', blockNumber: 105n, blockHash: f.blockHash(105n), logs: f.logs,
    }),
  };
  f.chain = { client, verify: async () => {} };
  f.logs = [f.log(105n)];
  return f;
}

test('claim scanner waits 12 blocks, pins reads and stores canonical cursor/provenance', async () => {
  const f = fixture(), result = await scanClaims(f.chain, build, wallet, {});
  assert.equal(f.queries[0].fromBlock, 100n);
  assert.equal(f.queries[0].toBlock, 108n);
  assert.equal(f.queries[0].event.name, 'PacketClaimed');
  assert.ok(f.reads.every(q => q.blockNumber === 108n));
  assert.deepEqual(result.cursor, { nextBlock: '109', anchor: { block: '108', hash: f.blockHash(108n) } });
  assert.equal(result.items[0].claim.blockHash, f.blockHash(105n));
  const state = { welcomed: [], gifted: [], publicDate: '1970-01-01', boardOpen: true };
  const queued = proposals(result.items, state, { welcome: 'hello', giftEach: '0.0001' }, 100);
  assert.equal(queued.length, 2);
  assert.ok(queued.every(q => q.claim === result.items[0].claim));
});

test('canonical cursor resumes; legacy height is replayed and duplicate logs dedupe', async () => {
  const f = fixture(), first = await scanClaims(f.chain, build, wallet, { claimBlock: 999 });
  assert.equal(f.queries[0].fromBlock, 100n);
  f.logs.push(structuredClone(f.logs[0]));
  assert.equal((await scanClaims(f.chain, build, wallet, {})).items.length, 1);
  f.head = 121n; f.logs = [];
  await scanClaims(f.chain, build, wallet, { claimCursor: first.cursor });
  assert.equal(f.queries.at(-1).fromBlock, 109n);
});

test('changed cursor anchor stops without mutating state; ordinary mailbox can retain it', async () => {
  const f = fixture(), first = await scanClaims(f.chain, build, wallet, {});
  const state = { claimCursor: first.cursor }, before = structuredClone(state);
  f.hashes.set(108n, hash(9999));
  await assert.rejects(scanClaims(f.chain, build, wallet, state), /operator reconciliation/);
  assert.deepEqual(state, before);
});

test('unconfirmed deployment and malformed, removed, foreign or noncanonical logs fail closed', async () => {
  const f = fixture(); f.head = 111n;
  await assert.rejects(scanClaims(f.chain, build, wallet, {}), /12 confirmations/);
  for (const patch of [
    { removed: true }, { blockNumber: 109n }, { address: wallet }, { blockHash: hash(9999) },
    { transactionHash: null }, { logIndex: -1 }, { data: '0x' },
  ]) {
    const g = fixture(); Object.assign(g.logs[0], patch);
    await assert.rejects(scanClaims(g.chain, build, wallet, {}));
  }
});

test('chain changes during scanning never commit mixed-branch results', async () => {
  const f = fixture(), original = f.chain.client.readContract;
  f.chain.client.readContract = async query => {
    const result = await original(query);
    f.hashes.set(108n, hash(9999));
    return result;
  };
  await assert.rejects(scanClaims(f.chain, build, wallet, {}), /changed during reading/);
});

test('foreign packets and transferred or unregistered names do not produce gifts', async () => {
  const f = fixture(); f.creator = claimer;
  assert.deepEqual((await scanClaims(f.chain, build, wallet, {})).items, []);
  f.creator = wallet; f.owner = wallet;
  assert.deepEqual((await scanClaims(f.chain, build, wallet, {})).items, []);
  const original = f.chain.client.readContract;
  f.chain.client.readContract = query => query.functionName === 'handleOf' ? '(unknown)' : original(query);
  assert.deepEqual((await scanClaims(f.chain, build, wallet, {})).items, []);
});

test('claim approval rechecks canonical receipt, confirmations, packet and current handle owner', async () => {
  const f = fixture(), claim = (await scanClaims(f.chain, build, wallet, {})).items[0].claim;
  await verifyClaim(f.chain, build, wallet, claim);
  f.owner = wallet;
  await assert.rejects(verifyClaim(f.chain, build, wallet, claim), /another wallet/);
  f.owner = claimer; f.creator = claimer;
  await assert.rejects(verifyClaim(f.chain, build, wallet, claim), /resident packet/);
  f.creator = wallet; f.head = 116n;
  await assert.rejects(verifyClaim(f.chain, build, wallet, claim), /12 confirmations/);
  f.head = 120n; f.hashes.set(105n, hash(9999));
  await assert.rejects(verifyClaim(f.chain, build, wallet, claim), /changed branch/);
});

test('claim approval rejects mismatched or missing receipt events and changed log hashes', async () => {
  for (const patch of [{ logIndex: 2 }, { transactionHash: hash(99) }, { blockHash: hash(99) }]) {
    const f = fixture(), claim = (await scanClaims(f.chain, build, wallet, {})).items[0].claim;
    Object.assign(f.logs[0], patch);
    await assert.rejects(verifyClaim(f.chain, build, wallet, claim), /missing or changed branch/);
  }
  const f = fixture(), claim = (await scanClaims(f.chain, build, wallet, {})).items[0].claim;
  await assert.rejects(verifyClaim(f.chain, build, wallet, { ...claim, id: '8' }), /does not match/);
  f.chain.client.getTransactionReceipt = async () => ({ status: 'reverted', blockNumber: 105n, blockHash: f.blockHash(105n) });
  await assert.rejects(verifyClaim(f.chain, build, wallet, claim), /not canonical/);
});
