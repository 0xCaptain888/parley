import assert from 'node:assert/strict';
import { encodeDeployData, keccak256, zeroAddress } from 'viem';
import { amount, address } from '../helper/src/normalize.mjs';
import { httpsOrigin } from './site-release.mjs';
import { sha256 } from './evidence.mjs';
import { requireDeploymentInputs } from './deployment-inputs.mjs';

export function deploymentPlan({ intent, config, build, snapshotSha256 }) {
  requireDeploymentInputs(intent, config);
  assert.equal(intent.schemaVersion, 1, 'Unknown deployment intent');
  assert.deepEqual(Object.keys(intent).sort(), ['schemaVersion', 'chainId', 'deployer', 'guardian', 'site',
    'defaultPostageBNB', 'maxPostageBNB', 'minShareBNB', 'capBNB', 'capUSDT', 'capUSDC', 'gasBudgetBNB'].sort(),
  'Unknown deployment intent field');
  assert.equal(intent.chainId, 56, 'Only the reviewed BSC target is supported');
  assert.equal(config.chainId, intent.chainId, 'Build chain differs from intent');
  const guardian = address(intent.guardian), deployer = address(intent.deployer);
  assert.ok(guardian !== zeroAddress && deployer !== zeroAddress, 'Zero guardian/deployer');
  const site = httpsOrigin(intent.site);
  assert.equal(site, intent.site, 'Use the canonical site origin');
  const uint = (v, bits, positive = true) => amount(v, 18, (1n << BigInt(bits)) - 1n, positive);
  const postage = uint(intent.defaultPostageBNB, 64, false), max = uint(intent.maxPostageBNB, 64, false);
  const min = uint(intent.minShareBNB, 128);
  assert.ok(postage <= max, 'Default postage exceeds maximum');
  const caps = ['capBNB', 'capUSDT', 'capUSDC'].map(k => uint(intent[k], 256));
  const gasBudget = uint(intent.gasBudgetBNB, 256);
  const args = [address(config.registry), guardian, postage, max, min,
    [zeroAddress, address(config.tokens.USDT), address(config.tokens.USDC)], caps];
  assert.ok(min <= caps[0] && max <= caps[0], 'Share/postage exceeds native cap');
  const compiled = build.output.contracts['contracts/Parley.sol'].Parley;
  assert.ok(!Object.keys(compiled.evm.bytecode.linkReferences || {}).length, 'Unresolved compiler libraries');
  const creationInput = encodeDeployData({ abi: compiled.abi, bytecode: `0x${compiled.evm.bytecode.object}`, args });
  return {
    schemaVersion: 1, status: 'prepared-not-authorized', chainId: 56, deployer, guardian, site,
    snapshotSha256, compilerBuildSha256: sha256(JSON.stringify(build)),
    constructorArgs: args.map(v => Array.isArray(v) ? v.map(String) : String(v)),
    creationInput, creationInputKeccak256: keccak256(creationInput),
    maximumGasSpendWei: gasBudget.toString(),
    deploymentRoute: 'UNSELECTED: direct creation or separately reviewed factory required',
    requirements: ['Independent source-bound security approval', 'Live gas estimate within approved budget',
      'Official wallet preview for the selected deployment route', 'Separate human consent for the exact preview',
      'Canonical receipt and runtime/constructor inspection', 'BscScan verified source'],
    bscscanVerified: false, walletAccess: false, mainnetBroadcast: false, productionRelease: false,
  };
}
