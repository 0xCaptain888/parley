import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { encodeEventTopics, encodeAbiParameters } from 'viem';
import abi from '../../helper/src/abi.json' with { type: 'json' };
import { collect } from './collect.mjs';

const address = n => `0x${n.toString(16).padStart(40, '0')}`;
const hash = n => `0x${n.toString(16).padStart(64, '0')}`;
const config = { chainId: 31337, contract: address(1), deploymentBlock: 1, excluded: [] };
function fixture(t) {
  const root = fs.mkdtempSync('/private/tmp/parley-stats-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const state = path.join(root, 'state'), output = path.join(root, 'stats.json');
  const savedFile = path.join(state, 'events.json');
  const f = { head: 200n, logs: [], ranges: [], hashes: new Map(), state, output };
  f.blockHash = number => f.hashes.get(number) || hash(Number(number) + 1000);
  f.opened = (number, owner) => ({
    address: config.contract, blockNumber: BigInt(number), blockHash: f.blockHash(BigInt(number)),
    transactionHash: hash(number * 100 + owner), logIndex: 0, removed: false,
    topics: encodeEventTopics({ abi, eventName: 'MailboxOpened', args: { owner: address(owner) } }),
    data: encodeAbiParameters([{ type: 'bytes32' }], [hash(owner)]),
  });
  f.client = {
    getChainId: async () => config.chainId,
    getBlockNumber: async () => f.head,
    getBlock: async ({ blockNumber }) => ({
      number: blockNumber, hash: f.blockHash(blockNumber), timestamp: 1795000000n + blockNumber,
    }),
    getLogs: async ({ address: target, fromBlock, toBlock }) => {
      assert.equal(target, config.contract);
      f.ranges.push([fromBlock, toBlock]);
      return f.logs.filter(l => l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
    },
  };
  f.run = () => collect(config, { state, output, client: f.client });
  f.saved = () => JSON.parse(fs.readFileSync(savedFile));
  f.bytes = () => [fs.readFileSync(savedFile, 'utf8'), fs.readFileSync(output, 'utf8')];
  f.seed = async () => {
    f.logs = [f.opened(20, 2), f.opened(180, 3)];
    await f.run();
    f.ranges = [];
    return f.bytes();
  };
  return f;
}
test('collector publishes only confirmed blocks and persists a canonical replay anchor', async t => {
  const f = fixture(t);
  f.logs = [f.opened(20, 2), f.opened(180, 3), f.opened(195, 4)];
  const result = await f.run();
  assert.equal(result.members, 2);
  assert.equal(result.block, 188);
  assert.equal(result.blockHash, f.blockHash(188n));
  assert.deepEqual(f.saved().anchor, { block: '123', hash: f.blockHash(123n) });
  assert.equal(f.saved().events.length, 2);
  assert.equal(fs.statSync(f.output).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(path.join(f.state, '.lock')), false);
});
test('shallow reorg replaces the replay tail without double-counting old events', async t => {
  const f = fixture(t);
  await f.seed();
  f.head = 210n;
  f.hashes.set(180n, hash(9000));
  f.logs = [f.opened(20, 2), f.opened(180, 4)];
  const stats = await f.run();
  assert.equal(stats.members, 2);
  assert.equal(f.ranges[0][0], 124n);
  assert.deepEqual(f.saved().events.map(e => e.args.owner), [address(2), address(4)]);
});
test('deep reorg invalidates the retained prefix and rebuilds from deployment', async t => {
  const f = fixture(t);
  await f.seed();
  f.head = 210n;
  f.hashes.set(123n, hash(9001));
  f.logs = [f.opened(30, 4)];
  const stats = await f.run();
  assert.equal(f.ranges[0][0], 1n);
  assert.equal(stats.members, 1);
  assert.deepEqual(f.saved().events.map(e => e.args.owner), [address(4)]);
});
test('legacy state without a hash anchor is rebuilt rather than trusted', async t => {
  const f = fixture(t);
  await f.seed();
  const saved = f.saved();
  delete saved.anchor;
  fs.writeFileSync(path.join(f.state, 'events.json'), JSON.stringify(saved));
  f.logs = [f.opened(30, 4)];
  assert.equal((await f.run()).members, 1);
  assert.equal(f.ranges[0][0], 1n);
});
test('a chain-head rollback discards saved events above the new confirmed range', async t => {
  const f = fixture(t);
  await f.seed();
  f.head = 100n;
  f.logs = [f.opened(30, 4)];
  const stats = await f.run();
  assert.equal(stats.block, 88);
  assert.equal(stats.members, 1);
  assert.equal(f.ranges[0][0], 1n);
});
test('target-block changes during collection do not overwrite state or published stats', async t => {
  const f = fixture(t);
  const before = await f.seed();
  const getBlock = f.client.getBlock;
  let reads = 0;
  f.client.getBlock = async args => {
    const block = await getBlock(args);
    return args.blockNumber === 188n && ++reads > 1 ? { ...block, hash: hash(9999) } : block;
  };
  await assert.rejects(f.run(), /Chain changed/);
  assert.deepEqual(f.bytes(), before);
});
test('a previously observed log-block change is detected before committing', async t => {
  const f = fixture(t);
  const before = await f.seed();
  const getBlock = f.client.getBlock;
  let reads = 0;
  f.client.getBlock = async args => {
    const block = await getBlock(args);
    return args.blockNumber === 180n && ++reads > 1 ? { ...block, hash: hash(9999) } : block;
  };
  await assert.rejects(f.run(), /Chain changed/);
  assert.deepEqual(f.bytes(), before);
});
test('noncanonical, removed, out-of-range and foreign logs fail closed', async t => {
  const f = fixture(t);
  const before = await f.seed();
  for (const change of [{ blockHash: hash(9999) }, { removed: true }, { blockNumber: 999n },
    { address: address(8) }, { transactionHash: null }, { logIndex: -1 }]) {
    f.client.getLogs = async () => [{ ...f.opened(180, 3), ...change }];
    await assert.rejects(f.run(), /canonical|Invalid statistics log/);
    assert.deepEqual(f.bytes(), before);
  }
});
test('RPC range limits shrink batches without skipping or duplicating events', async t => {
  const f = fixture(t);
  f.head = 1200n;
  f.logs = [f.opened(20, 2), f.opened(1100, 3)];
  const getLogs = f.client.getLogs;
  let rejected = 0;
  f.client.getLogs = async args => {
    if (args.toBlock - args.fromBlock >= 200n) { rejected++; throw new Error('range too wide'); }
    return getLogs(args);
  };
  assert.equal((await f.run()).members, 2);
  assert.ok(rejected > 0);
  assert.equal(f.saved().events.length, 2);
});
test('a single-block RPC failure leaves both durable files unchanged', async t => {
  const f = fixture(t);
  const before = await f.seed();
  f.client.getLogs = async () => { throw new Error('RPC unavailable'); };
  await assert.rejects(f.run(), /RPC unavailable/);
  assert.deepEqual(f.bytes(), before);
  assert.equal(fs.existsSync(path.join(f.state, '.lock')), false);
});
test('concurrent collectors cannot overwrite one another', async t => {
  const f = fixture(t);
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  f.client.getLogs = async () => { entered(); await wait; return []; };
  const first = f.run();
  try {
    await ready;
    await assert.rejects(f.run(), e => e.code === 'STATE_BUSY');
  } finally {
    release();
    await first;
  }
});
test('unconfirmed deployment, wrong chain and invalid headers cannot publish', async t => {
  const f = fixture(t);
  f.head = 5n;
  await assert.rejects(f.run(), /12 confirmations/);
  assert.equal(fs.existsSync(f.output), false);
  f.head = 200n;
  f.client.getChainId = async () => 56;
  await assert.rejects(f.run(), /Wrong RPC chain/);
  f.client.getChainId = async () => config.chainId;
  f.client.getBlock = async ({ blockNumber }) => ({ number: blockNumber, hash: null });
  await assert.rejects(f.run(), /Invalid statistics block header/);
  assert.equal(fs.existsSync(f.output), false);
});
