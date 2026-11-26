import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { healthReport, recoveryPlan, migrationPlan, inspectTransaction, inspectClaimAnchor, inspectCampaigns, validateResidentBinding } from './operations.mjs';

const now = 1795400000, address = digit => `0x${digit.repeat(40)}`, hash = digit => `0x${digit.repeat(64)}`;
const build = { chainId: 56, contract: address('1'), registry: address('2'), deploymentBlock: 100, excluded: [address('3')] };
const config = { from: address('4'), mode: 'manual', dailyBNB: '0.01', perTxBNB: '0.002',
  pricesUpdatedAt: now, pricesUSD: { BNB: '600', USDT: '1', USDC: '1' }, logRpc: 'https://rpc.invalid', boardOffer: {} };
const binding = { chainId: 56, contract: build.contract, from: config.from };
const state = () => ({ queue: [], gifted: [], welcomed: [], backlog: [], boardOpen: true, boardId: 7,
  publicDate: new Date(now * 1000 + 28800000).toISOString().slice(0, 10),
  lastTickAt: now, lastInboxAt: now, lastClaimAt: now, claimReaderError: false });
const stats = { updatedAt: now, contract: build.contract, block: 110, blockHash: hash('1'), excluded: build.excluded };
const q = () => ({ id: 'q', key: 'gift:alice', planId: 'p', status: 'broadcast_unknown', createdAt: now,
  bnb: '100', previewCall: { to: build.contract, data: '0x1234', value: '100' } });
function rpc() {
  const f = { chainId: 56, head: 120n, tx: { hash: hash('2'), from: config.from, to: build.contract, input: '0x1234', value: 100n },
    receipt: { transactionHash: hash('2'), from: config.from, to: build.contract, blockNumber: 105n, blockHash: hash('3'), status: 'success' } };
  f.client = { getChainId: async () => f.chainId, getTransactionReceipt: async () => f.receipt,
    getTransaction: async () => f.tx, getBlockNumber: async () => f.head,
    getBlock: async ({ blockNumber }) => ({ number: blockNumber, hash: hash('3') }) };
  return f;
}

test('health checks pass only with fresh bound state, stats, prices and operating controls', () => {
  assert.equal(healthReport({ config, build, state: state(), stats, now }).exitCode, 0);
  for (const change of [
    s => s.lastTickAt = now - 181, s => s.lastInboxAt = now + 1, s => s.claimReaderError = true,
    s => s.queue.push(q()),
  ]) {
    const s = state(); change(s);
    assert.equal(healthReport({ config, build, state: s, stats, now }).exitCode, 2);
  }
  assert.equal(healthReport({ config, build, state: state(), stats: { ...stats, updatedAt: now - 1201 }, now }).exitCode, 2);
  assert.equal(healthReport({ config, build, state: state(), stats: { ...stats, excluded: [42] }, now }).exitCode, 2);
  assert.equal(healthReport({ config, build, state: state(), stats: { ...stats, blockHash: null }, now }).exitCode, 2);
});

test('health warns on price, response SLA, backlog, lock and campaign state without leaking private inputs', () => {
  const s = state(); s.backlog = [{ body: 'SECRET_MAIL' }]; s.publicDate = null; s.boardOpen = false;
  s.queue = [{ ...q(), status: 'queued', createdAt: now - 601 }];
  const r = healthReport({ config: { ...config, pricesUpdatedAt: now - 86401 }, build, state: s, stats, now, lockPresent: true });
  assert.equal(r.exitCode, 1);
  assert.doesNotMatch(JSON.stringify(r), /SECRET_MAIL|0x1234|rpc.invalid/);
  assert.ok(r.checks.filter(c => c.status === 'warning').length >= 5);
});

test('unknown broadcasts reserve budget even when very old; malformed state cannot report healthy', () => {
  const s = state(); s.queue = [{ ...q(), createdAt: 1, bnb: '10000000000000000' }];
  const r = healthReport({ config, build, state: s, stats, now });
  assert.equal(r.reservedBNBWei, '10000000000000000');
  assert.equal(r.exitCode, 2);
  s.queue[0].status = 'invented';
  assert.equal(healthReport({ config, build, state: s, stats, now }).exitCode, 2);
});

test('recovery and migration are hash-bound read-only plans and cannot discard reservations', () => {
  const s = state(); s.queue.push(q());
  const raw = Buffer.from(JSON.stringify(s)), before = structuredClone(s);
  const r = recoveryPlan(s, binding, raw);
  assert.equal(r.pending[0].next, 'LOOK_UP_OFFICIAL_WALLET_ORDER_DO_NOT_RETRY');
  assert.equal(r.pending[0].reservedBNBWei, '100');
  assert.equal(r.stateModified, false);
  assert.equal(migrationPlan(s, raw, binding, binding, false).preserveReservedBNBWei, '100');
  assert.throws(() => migrationPlan(s, raw, binding, { ...binding, chainId: 97 }, false), /Cross-deployment/);
  assert.throws(() => migrationPlan(s, raw, binding, binding, true), /overwrite/);
  assert.deepEqual(s, before);
  assert.throws(() => validateResidentBinding(build, config.from, { ...binding, contract: address('9') }), /binding mismatch/);
});

test('recovery transaction requires exact call, sender, chain, canonical block and confirmation depth', async () => {
  const f = rpc(), args = { client: f.client, build, from: config.from, q: q(), txHash: hash('2') };
  const r = await inspectTransaction(args);
  assert.equal(r.status, 'settlement_required'); assert.equal(r.stateModified, false);
  assert.deepEqual(r.nextArguments, ['--settle', hash('2'), '--plan', 'p', '--once']);
  f.receipt.status = 'reverted';
  assert.equal((await inspectTransaction(args)).receiptStatus, 'reverted');
  f.head = 116n;
  assert.equal((await inspectTransaction(args)).status, 'confirming');
  f.client.getTransactionReceipt = async () => { throw { name: 'TransactionReceiptNotFoundError' }; };
  assert.equal((await inspectTransaction(args)).status, 'pending');
});

test('foreign and mismatched recovery transactions or moving chain never recommend settlement', async () => {
  for (const mutate of [
    f => f.chainId = 97, f => f.tx.from = address('9'), f => f.tx.to = address('9'),
    f => f.tx.value = 101n, f => f.tx.input = '0x1235', f => f.receipt.blockHash = hash('8'),
    f => f.tx.hash = hash('8'),
  ]) {
    const f = rpc(); mutate(f);
    await assert.rejects(inspectTransaction({ client: f.client, build, from: config.from, q: q(), txHash: hash('2') }));
  }
  const f = rpc(); let reads = 0;
  f.client.getBlock = async ({ blockNumber }) => ({ number: blockNumber, hash: ++reads === 1 ? hash('3') : hash('8') });
  await assert.rejects(inspectTransaction({ client: f.client, build, from: config.from, q: q(), txHash: hash('2') }), /changed/);
});

test('anchor recovery detects reorgs, retains confirmed/unknown actions and never rewinds', async () => {
  const f = rpc(), s = state(); s.queue = [{ ...q(), index: 'claim:7:alice' }];
  assert.equal((await inspectClaimAnchor(f.client, build, s)).status, 'replay_from_deployment');
  s.claimCursor = { nextBlock: '106', anchor: { block: '105', hash: hash('9') } };
  const before = structuredClone(s);
  const report = await inspectClaimAnchor(f.client, build, s);
  assert.equal(report.status, 'operator_reconciliation_required');
  assert.equal(report.claimQueueToReview[0].mustNotResend, true);
  assert.equal(report.cursorRewound, false);
  assert.deepEqual(s, before);
  s.claimCursor.anchor.hash = hash('3');
  assert.equal((await inspectClaimAnchor(f.client, build, s)).status, 'anchor_matches');
});

test('optional public-chain campaign monitor detects expiry, exhaustion, foreign makers and renewal windows', async () => {
  const f = rpc(), s = state(); s.publicPacketId = 9;
  f.client.getBlock = async ({ blockNumber }) => ({ number: blockNumber, hash: hash('3'), timestamp: BigInt(now) });
  let expiry = now + 172800, owner = config.from, remaining = 1n;
  const reads = [];
  f.client.readContract = async query => {
    reads.push(query);
    return query.functionName === 'offers' ? [owner, BigInt(expiry), 1n]
      : [owner, BigInt(expiry), 2n, 0n, false, 1n, remaining];
  };
  assert.ok((await inspectCampaigns(f.client, build, config.from, s)).checks.every(c => c.status === 'passed'));
  assert.ok(reads.every(r => r.blockNumber === 108n));
  expiry = now + 600;
  assert.ok((await inspectCampaigns(f.client, build, config.from, s)).checks.filter(c => c.status === 'warning').length === 2);
  expiry = now - 1; owner = build.contract; remaining = 0n;
  assert.ok((await inspectCampaigns(f.client, build, config.from, s)).checks.every(c => c.status === 'warning'));
});

test('offline recovery CLI preserves state bytes and omits RPC credentials and message bodies', t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const dir = fs.mkdtempSync('/private/tmp/parley-ops-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, value) => fs.writeFileSync(`${dir}/${name}`, JSON.stringify(value));
  write('config.json', config); write('build.json', build); write('deployment.json', binding);
  const s = state(); s.queue.push(q()); s.backlog = [{ body: 'SECRET_MAIL' }]; write('state.json', s);
  const args = ['scripts/resident-ops.mjs', 'recover', '--state-dir', dir, '--config', `${dir}/config.json`, '--build', `${dir}/build.json`];
  const before = fs.readFileSync(`${dir}/state.json`);
  const result = JSON.parse(execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8' }));
  assert.equal(result.stateModified, false);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_MAIL|rpc.invalid|0x1234/);
  assert.deepEqual(fs.readFileSync(`${dir}/state.json`), before);
  const bad = spawnSync(process.execPath, [...args, '--queue', 'q', '--tx', hash('2'), '--rpc', 'https://secret:password@rpc.invalid'],
    { cwd: root, encoding: 'utf8' });
  assert.equal(bad.status, 2); assert.doesNotMatch(bad.stdout + bad.stderr, /password|SECRET_MAIL/);
});

test('health CLI returns 0/1/2 and migration CLI does not create a target or alter source', t => {
  const root = fileURLToPath(new URL('../', import.meta.url)), dir = fs.mkdtempSync('/private/tmp/parley-health-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, value) => fs.writeFileSync(`${dir}/${name}`, JSON.stringify(value));
  const current = Math.floor(Date.now() / 1000), s = state();
  Object.assign(s, { lastTickAt: current, lastInboxAt: current, lastClaimAt: current,
    publicDate: new Date(current * 1000 + 28800000).toISOString().slice(0, 10) });
  write('config.json', { ...config, pricesUpdatedAt: current }); write('build.json', build);
  write('deployment.json', binding); write('state.json', s); write('stats.json', { ...stats, updatedAt: current });
  const args = ['--state-dir', dir, '--config', `${dir}/config.json`, '--build', `${dir}/build.json`];
  const invoke = (command, more = []) => spawnSync(process.execPath,
    ['scripts/resident-ops.mjs', command, ...args, ...more], { cwd: root, encoding: 'utf8' });
  assert.equal(invoke('health', ['--stats', `${dir}/stats.json`]).status, 0);
  s.backlog = [{ body: 'SECRET' }]; write('state.json', s);
  assert.equal(invoke('health', ['--stats', `${dir}/stats.json`]).status, 1);
  s.queue.push(q()); write('state.json', s);
  assert.equal(invoke('health', ['--stats', `${dir}/stats.json`]).status, 2);
  const before = fs.readFileSync(`${dir}/state.json`), target = `${dir}/new-state`;
  const migration = invoke('migrate', ['--target-dir', target]);
  assert.equal(migration.status, 0);
  assert.equal(JSON.parse(migration.stdout).targetCreated, false);
  assert.equal(fs.existsSync(target), false);
  assert.deepEqual(fs.readFileSync(`${dir}/state.json`), before);
});
