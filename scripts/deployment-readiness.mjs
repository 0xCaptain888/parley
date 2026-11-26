import assert from 'node:assert/strict';
import { keccak256, zeroAddress } from 'viem';
import { tokenAbi } from '../helper/src/chain.mjs';

export async function inspectDeploymentReadiness({ plan, config, snapshotSha256, client }) {
  assert.equal(plan.status, 'prepared-not-authorized');
  assert.equal(plan.snapshotSha256, snapshotSha256, 'Stale deployment plan');
  assert.equal(plan.chainId, 56);
  assert.equal(config.chainId, 56);
  assert.equal(keccak256(plan.creationInput), plan.creationInputKeccak256, 'Creation calldata changed');
  assert.equal(await client.getChainId(), 56, 'Wrong deployment RPC chain');
  const number = await client.getBlockNumber({ cacheTime: 0 }), block = await client.getBlock({ blockNumber: number });
  assert.ok(block.number === number && /^0x[0-9a-f]{64}$/i.test(block.hash || ''), 'Invalid deployment inspection block');
  const registry = await client.getCode({ address: config.registry, blockNumber: number });
  assert.ok(registry && registry !== '0x', 'Registry has no code');
  const tokens = [];
  for (const [symbol, address] of Object.entries(config.tokens)) {
    assert.notEqual(address.toLowerCase(), zeroAddress);
    const code = await client.getCode({ address, blockNumber: number });
    assert.ok(code && code !== '0x', 'Listed token has no code');
    const decimals = await client.readContract({ address, abi: tokenAbi, functionName: 'decimals', blockNumber: number });
    assert.equal(decimals, 18, 'Deployment cap encoding requires verified eighteen-decimal tokens');
    tokens.push({ symbol, address, decimals });
  }
  const gas = await client.estimateGas({ account: plan.deployer, data: plan.creationInput, value: 0n, blockNumber: number });
  const gasPrice = await client.getGasPrice();
  assert.ok(typeof gas === 'bigint' && gas > 0n && typeof gasPrice === 'bigint' && gasPrice > 0n, 'Invalid gas observation');
  const gasWithMargin = (gas * 120n + 99n) / 100n, worstObservedFee = gasWithMargin * gasPrice;
  const balance = await client.getBalance({ address: plan.deployer, blockNumber: number });
  const budget = BigInt(plan.maximumGasSpendWei);
  assert.ok(worstObservedFee <= budget, 'Observed direct-creation gas exceeds approved input budget');
  assert.ok(balance >= worstObservedFee, 'Deployer balance is insufficient for observed gas');
  assert.equal((await client.getBlock({ blockNumber: number })).hash, block.hash, 'Deployment chain changed during inspection');
  return { schemaVersion: 1, status: 'rpc-preflight-passed-not-authorized', snapshotSha256,
    chainId: 56, block: number.toString(), blockHash: block.hash, tokens,
    creationInputKeccak256: plan.creationInputKeccak256, deployer: plan.deployer, guardian: plan.guardian,
    estimate: { route: 'direct-creation-simulation-only', gas: gas.toString(), gasWithTwentyPercentMargin: gasWithMargin.toString(),
      observedGasPriceWei: gasPrice.toString(), observedFeeWithMarginWei: worstObservedFee.toString(),
      approvedInputBudgetWei: budget.toString(), deployerBalanceWei: balance.toString() },
    requirements: ['Independent audit approval', 'Select an official-wallet-supported route',
      'Fresh official preview and per-call human consent; gas prices can change',
      'For a factory, independently review factory bytecode, calldata, address derivation and internal creation proof'],
    officialWalletRouteVerified: false, walletAccess: false, mainnetBroadcast: false, productionRelease: false };
}
