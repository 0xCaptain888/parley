import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { currentBuild } from '../../scripts/build-info.mjs';
import { deploymentExpectations, inspectDeployment } from '../../scripts/deployment-evidence.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const addr = digit => `0x${digit.repeat(40)}`, hash = digit => `0x${digit.repeat(64)}`;
const record = () => ({ chainId: 56, address: addr('1'), block: 100, deployer: addr('2'), transactionHash: hash('1'),
  constructorArgs: [addr('3'), addr('4'), '300', '3000', '100', [`0x${'0'.repeat(40)}`, addr('5'), addr('6')], ['1000', '2000', '3000']] });
function fixture() {
  const build = currentBuild(root), d = record(), expected = deploymentExpectations(build, d);
  const f = { chainId: 56, code: expected.runtime, head: 112n,
    block: { number: 100n, hash: hash('2') },
    tx: { hash: d.transactionHash, from: d.deployer, to: null, value: 0n, input: expected.creationInput },
    receipt: { transactionHash: d.transactionHash, from: d.deployer, status: 'success', blockNumber: 100n,
      blockHash: hash('2'), to: null, contractAddress: d.address }, reads: [] };
  f.client = { getChainId: async () => f.chainId, getBlockNumber: async () => f.head,
    getBlock: async () => f.block, getCode: async () => f.code, getTransaction: async () => f.tx,
    getTransactionReceipt: async () => f.receipt,
    readContract: async query => {
      f.reads.push(query);
      return expected.getters.find(([name, args]) => name === query.functionName && String(args) === String(query.args))[2];
    } };
  f.inspect = () => inspectDeployment({ client: f.client, record: d, build });
  return f;
}
test('deployment evidence patches every immutable and checks full creation input and pinned getters', async () => {
  const f = fixture(), report = await f.inspect();
  assert.equal(report.status, 'passed');
  assert.equal(report.transactionBound, true);
  assert.equal(report.bscscanVerified, false);
  assert.ok(f.reads.every(r => r.blockNumber === 100n));
  const a = deploymentExpectations(currentBuild(root), record());
  const changed = record(); changed.constructorArgs[1] = addr('7');
  assert.notEqual(a.runtime, deploymentExpectations(currentBuild(root), changed).runtime);
});
test('deployment bytecode, sender, calldata, value, receipt address and getter mutations fail', async () => {
  for (const mutate of [
    f => f.code = '0x00', f => f.tx.input += '00', f => f.tx.from = addr('9'),
    f => f.tx.value = 1n, f => f.receipt.contractAddress = addr('9'), f => f.receipt.status = 'reverted',
    f => f.client.readContract = async () => 9999n,
  ]) {
    const f = fixture(); mutate(f);
    assert.equal((await f.inspect()).status, 'failed');
  }
});
test('wrong chain, insufficient confirmations and changing canonical header reject inspection', async () => {
  const f = fixture(); f.chainId = 97; await assert.rejects(f.inspect(), /Wrong/);
  f.chainId = 56; f.head = 111n; await assert.rejects(f.inspect(), /confirmations/);
  f.head = 112n; let reads = 0;
  f.client.getBlock = async () => ({ number: 100n, hash: ++reads === 1 ? hash('2') : hash('3') });
  await assert.rejects(f.inspect(), /chain changed/);
});
test('independent intended configuration catches registry, token and final deployment drift', async () => {
  const f = fixture(), d = record(), build = currentBuild(root);
  const intended = { chainId: 56, contract: d.address, deploymentBlock: 100, registry: d.constructorArgs[0],
    tokens: { USDT: d.constructorArgs[5][1], USDC: d.constructorArgs[5][2] } };
  assert.equal((await inspectDeployment({ client: f.client, build, record: d, intendedConfig: intended })).status, 'passed');
  for (const patch of [{ registry: addr('9') }, { tokens: { ...intended.tokens, USDC: addr('9') } },
    { contract: addr('9') }, { deploymentBlock: 101 }]) {
    assert.equal((await inspectDeployment({ client: f.client, build, record: d, intendedConfig: { ...intended, ...patch } })).status, 'failed');
  }
});
test('legacy records without transaction retain explicitly narrower scope; factory creation never pretends direct-create proof', async () => {
  const f = fixture(); f.tx.to = addr('9'); f.receipt.to = addr('9');
  assert.equal((await f.inspect()).status, 'failed');
  const d = record(); delete d.transactionHash;
  const report = await inspectDeployment({ client: f.client, record: d, build: currentBuild(root) });
  assert.equal(report.status, 'passed'); assert.equal(report.transactionBound, false);
});
test('ambiguous constructor records and unknown compiler immutable changes require review', () => {
  for (const mutate of [
    d => delete d.chainId, d => d.constructorArgs[2] = '9999', d => d.constructorArgs[4] = '0',
    d => d.constructorArgs[5][1] = d.constructorArgs[5][0], d => d.constructorArgs[6][0] = '0',
    d => d.constructorArgs[6][0] = '-1',
  ]) {
    const d = record(); mutate(d); assert.throws(() => deploymentExpectations(currentBuild(root), d));
  }
  const build = structuredClone(currentBuild(root));
  build.output.contracts['contracts/Parley.sol'].Parley.evm.deployedBytecode.immutableReferences['-1'] = [{ start: 0, length: 32 }];
  assert.throws(() => deploymentExpectations(build, record()), /Unrecognized immutable/);
});
