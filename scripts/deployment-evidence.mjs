import assert from 'node:assert/strict';
import { encodeAbiParameters, parseAbiParameters, keccak256, zeroAddress } from 'viem';

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const addr = value => /^0x[0-9a-f]{40}$/i.test(value || '');
const hash = value => /^0x[0-9a-f]{64}$/i.test(value || '');
const uint = (value, bits) => {
  assert.match(String(value), /^(0|[1-9][0-9]*)$/, 'Invalid unsigned constructor parameter');
  const n = BigInt(value);
  assert.ok(n < 1n << BigInt(bits), 'Constructor parameter exceeds ABI range');
  return n;
};
export function deploymentExpectations(build, record) {
  const a = record.constructorArgs;
  assert.ok(Array.isArray(a) && a.length === 7, 'Exact seven constructor arguments required');
  assert.ok(Number.isSafeInteger(record.chainId) && record.chainId > 0, 'Explicit chain ID required');
  assert.ok(addr(record.address) && !same(record.address, zeroAddress), 'Invalid deployment address');
  assert.ok(Number.isSafeInteger(record.block) && record.block > 0, 'Invalid deployment block');
  assert.ok(addr(a[0]) && !same(a[0], zeroAddress) && addr(a[1]) && !same(a[1], zeroAddress), 'Invalid registry or guardian');
  const defaultPostage = uint(a[2], 64), maxPostage = uint(a[3], 64), minShare = uint(a[4], 128);
  assert.ok(defaultPostage <= maxPostage && minShare > 0n, 'Invalid postage/share parameters');
  assert.ok(Array.isArray(a[5]) && Array.isArray(a[6]) && a[5].length === a[6].length && a[5].length > 0, 'Invalid cap arrays');
  assert.ok(a[5].every(addr) && new Set(a[5].map(t => t.toLowerCase())).size === a[5].length, 'Duplicate or invalid cap token');
  assert.ok(a[5].some(t => same(t, zeroAddress)), 'Native BNB cap required');
  const caps = a[6].map(v => uint(v, 256));
  assert.ok(caps.every(n => n > 0n), 'Positive caps required');
  const compiled = build.output.contracts['contracts/Parley.sol'].Parley;
  assert.ok(!Object.keys(compiled.evm.bytecode.linkReferences || {}).length
    && !Object.keys(compiled.evm.deployedBytecode.linkReferences || {}).length, 'Unresolved libraries');
  const immutables = { REGISTRY: BigInt(a[0]), GUARDIAN: BigInt(a[1]),
    DEFAULT_POSTAGE: defaultPostage, MAX_POSTAGE: maxPostage, MIN_SHARE: minShare };
  const declarations = new Map();
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.nodeType === 'VariableDeclaration' && node.mutability === 'immutable') declarations.set(String(node.id), node.name);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(build.output.sources['contracts/Parley.sol'].ast);
  const runtime = Buffer.from(compiled.evm.deployedBytecode.object, 'hex'), patched = new Set();
  for (const [id, refs] of Object.entries(compiled.evm.deployedBytecode.immutableReferences || {})) {
    const name = declarations.get(id);
    assert.ok(Object.hasOwn(immutables, name), 'Unrecognized immutable; review new compiler output');
    patched.add(name);
    for (const ref of refs) {
      assert.ok(ref.length === 32 && Number.isSafeInteger(ref.start) && ref.start >= 0 && ref.start + 32 <= runtime.length, 'Invalid immutable slot');
      Buffer.from(immutables[name].toString(16).padStart(64, '0'), 'hex').copy(runtime, ref.start);
    }
  }
  assert.deepEqual([...patched].sort(), Object.keys(immutables).sort(), 'Missing immutable references');
  const encoded = encodeAbiParameters(parseAbiParameters('address,address,uint64,uint64,uint128,address[],uint256[]'),
    [a[0], a[1], defaultPostage, maxPostage, minShare, a[5], caps]);
  return { runtime: `0x${runtime.toString('hex')}`, creationInput: `0x${compiled.evm.bytecode.object}${encoded.slice(2)}`,
    getters: [['REGISTRY', [], a[0]], ['GUARDIAN', [], a[1]], ['DEFAULT_POSTAGE', [], defaultPostage],
      ['MAX_POSTAGE', [], maxPostage], ['MIN_SHARE', [], minShare],
      ...a[5].map((t, i) => ['cap', [t], caps[i]]), ['paused', [], false], ['memberCount', [], 0n]],
    abi: compiled.abi };
}

export async function inspectDeployment({ client, build, record, intendedConfig, minimumConfirmations = 12 }) {
  assert.ok(Number.isSafeInteger(minimumConfirmations) && minimumConfirmations >= 0);
  const expected = deploymentExpectations(build, record);
  assert.equal(await client.getChainId(), record.chainId, 'Wrong deployment chain');
  const number = BigInt(record.block), block = await client.getBlock({ blockNumber: number });
  assert.ok(block.number === number && hash(block.hash), 'Invalid deployment block');
  const head = await client.getBlockNumber({ cacheTime: 0 });
  assert.ok(head >= number + BigInt(minimumConfirmations), 'Deployment has insufficient confirmations');
  const checks = [];
  const check = (name, ok) => { checks.push({ name, status: ok ? 'passed' : 'failed' }); };
  if (intendedConfig) {
    check('intended_chain', record.chainId === intendedConfig.chainId);
    check('intended_registry', same(record.constructorArgs[0], intendedConfig.registry));
    check('intended_tokens', record.constructorArgs[5].length === 3
      && same(record.constructorArgs[5][0], zeroAddress)
      && same(record.constructorArgs[5][1], intendedConfig.tokens?.USDT)
      && same(record.constructorArgs[5][2], intendedConfig.tokens?.USDC));
    if (intendedConfig.contract) check('intended_contract', same(record.address, intendedConfig.contract));
    if (intendedConfig.deploymentBlock !== null && intendedConfig.deploymentBlock !== undefined)
      check('intended_deployment_block', record.block === intendedConfig.deploymentBlock);
  }
  const code = await client.getCode({ address: record.address, blockNumber: number });
  check('runtime_including_immutables', same(code, expected.runtime));
  if (record.transactionHash) {
    assert.ok(hash(record.transactionHash) && addr(record.deployer), 'Exact deployment transaction and deployer required');
    const receipt = await client.getTransactionReceipt({ hash: record.transactionHash });
    const tx = await client.getTransaction({ hash: record.transactionHash });
    check('deployment_receipt', receipt.status === 'success' && receipt.blockNumber === number && receipt.blockHash === block.hash
      && same(receipt.transactionHash, record.transactionHash) && same(tx.hash, record.transactionHash)
      && same(receipt.from, record.deployer) && same(tx.from, record.deployer));
    // Factory deployments need separate internal-create evidence, not a direct-create assertion.
    check('direct_creation_transaction', tx.to === null && receipt.to === null
      && same(receipt.contractAddress, record.address) && BigInt(tx.value) === 0n && same(tx.input, expected.creationInput));
  }
  for (const [name, args, value] of expected.getters) {
    const actual = await client.readContract({ address: record.address, abi: expected.abi,
      functionName: name, args, blockNumber: number });
    check(`${name}${args.length ? `:${String(args[0]).toLowerCase()}` : ''}`, same(actual, value));
  }
  const recheck = await client.getBlock({ blockNumber: number });
  assert.equal(recheck.hash, block.hash, 'Deployment chain changed during inspection');
  const transactionBound = !!record.transactionHash;
  return { schemaVersion: 1, status: checks.every(c => c.status === 'passed') ? 'passed' : 'failed',
    scope: transactionBound ? 'direct-creation-at-deployment-block' : 'runtime-and-storage-only-no-creation-transaction',
    chainId: record.chainId, address: record.address, block: record.block, blockHash: block.hash,
    expectedRuntimeKeccak256: keccak256(expected.runtime), checks, transactionBound, intendedConfigChecked: !!intendedConfig,
    bscscanVerified: false, realWallet: false, mainnetBroadcast: false, productionRelease: false };
}
