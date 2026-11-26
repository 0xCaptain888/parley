import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createPublicClient, http, isAddress, keccak256, parseAbi, parseUnits } from 'viem';
import { sourceSnapshot, sha256 } from './evidence.mjs';

const require = createRequire(import.meta.url);
const { forkInputs } = require('../contracts/scripts/fork-inputs.js');
export const REGISTRY = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f';
export const USDT = '0x55d398326f99059fF775485246999027B3197955';
export const USDC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';
const registryAbi = parseAbi(['function balanceOf(address) view returns(uint256)',
  'function handleOf(address) view returns(string)', 'function ownerOfHandle(string) view returns(address)']);
const tokenAbi = parseAbi(['function decimals() view returns(uint8)', 'function balanceOf(address) view returns(uint256)']);
class PrerequisiteError extends Error {}
const requireThat = (condition, message) => { if (!condition) throw new PrerequisiteError(message); };

export async function inspectFork(client, { block, actors }) {
  const report = {
    checkedAt: new Date().toISOString(), status: 'running', forkBlock: block, actors,
    checks: [], codeHashes: {}, mainnetBroadcast: false, walletAccess: false,
    scope: 'Read-only prerequisite checks, not a local fork flow or consensus replay',
  };
  const read = (address, abi, functionName, args = []) =>
    client.readContract({ address, abi, functionName, args, blockNumber: BigInt(block) });
  const check = async (name, action) => {
    try {
      await action();
      report.checks.push({ name, status: 'passed' });
    } catch (error) {
      report.checks.push({ name, status: 'failed', reason: error instanceof PrerequisiteError
        ? error.message : 'Public RPC or contract read failed; endpoint/error details omitted to protect credentials' });
      throw error;
    }
  };
  try {
    await check('BSC source chain', async () =>
      requireThat(await client.getChainId() === 56, 'RPC source chain must be BSC mainnet (56)'));
    await check('fixed block and local EVM profile', async () => {
      const header = await client.getBlock({ blockNumber: BigInt(block) });
      requireThat(header.number === BigInt(block) && /^0x[0-9a-fA-F]{64}$/.test(header.hash),
        'RPC returned an invalid or mismatched block');
      requireThat(header.timestamp >= 1777343400n, 'This local Osaka profile requires a post-Osaka BSC block');
      report.forkBlockHash = header.hash;
      report.blockTimestamp = header.timestamp.toString();
      report.localEvm = 'Ethereum Osaka approximation; not BSC consensus replay';
    });
    await check('deployed registry and token code', async () => {
      for (const [name, address] of [['registry', REGISTRY], ['usdt', USDT], ['usdc', USDC]]) {
        const code = await client.getBytecode({ address, blockNumber: BigInt(block) });
        requireThat(code && code !== '0x', `${name} has no deployed code at the fixed block`);
        report.codeHashes[name] = { address, keccak256: keccak256(code) };
      }
      requireThat(report.codeHashes.registry.keccak256 ===
        '0xc4006e6e6ffaaf6996116617392beabe4f5f0a0795841322f91c2ceac34d6ace',
      'Registry runtime differs from the reviewed deployment');
    });
    await check('two distinct registered holders', async () => {
      requireThat(actors.length === 2 && actors.every(a => isAddress(a))
        && actors[0].toLowerCase() !== actors[1].toLowerCase(), 'Two distinct valid holders are required');
      report.handles = [];
      for (const actor of actors) {
        const balance = await read(REGISTRY, registryAbi, 'balanceOf', [actor]);
        const handle = await read(REGISTRY, registryAbi, 'handleOf', [actor]);
        requireThat(balance > 0n && /^[a-z0-9]{1,64}$/.test(handle), 'Actor has no valid Agent ID at the fixed block');
        const owner = await read(REGISTRY, registryAbi, 'ownerOfHandle', [handle]);
        requireThat(owner.toLowerCase() === actor.toLowerCase(), 'Handle owner does not match actor');
        report.handles.push(handle);
      }
      requireThat(report.handles[0] !== report.handles[1], 'Actors must have distinct handles');
    });
    await check('real token decimals and starting balances', async () => {
      const dt = Number(await read(USDT, tokenAbi, 'decimals'));
      const dc = Number(await read(USDC, tokenAbi, 'decimals'));
      requireThat(dt === 18 && dc === 18, 'Reviewed BSC USDT/USDC decimals must both be 18');
      const a = await read(USDC, tokenAbi, 'balanceOf', [actors[0]]);
      const b = await read(USDT, tokenAbi, 'balanceOf', [actors[1]]);
      report.startingBalances = {
        aUsdc: a.toString(), minimumAUsdc: parseUnits('0.02', dc).toString(),
        bUsdt: b.toString(), minimumBUsdt: parseUnits('0.03', dt).toString(),
      };
      requireThat(a >= parseUnits('0.02', dc) && b >= parseUnits('0.03', dt),
        'Insufficient real starting balances: A needs 0.02 USDC and B needs 0.03 USDT');
    });
    await check('fixed block remained canonical', async () => {
      const header = await client.getBlock({ blockNumber: BigInt(block) });
      requireThat(header.hash === report.forkBlockHash, 'Fixed block hash changed during preflight');
    });
    report.status = 'passed';
  } catch {
    report.status = 'failed';
  }
  report.completedAt = new Date().toISOString();
  return report;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const inputs = forkInputs(process.env);
  const snapshot = sourceSnapshot(root);
  const client = createPublicClient({ transport: http(process.env.FORK_RPC, { retryCount: 0, timeout: 15000 }) });
  const report = await inspectFork(client, inputs);
  if (sourceSnapshot(root).sha256 !== snapshot.sha256)
    throw new Error('Verification inputs changed during preflight');
  report.snapshotSha256 = snapshot.sha256;
  const file = `docs/reports/fork-preflight-${report.checkedAt.replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(path.join(root, file), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(path.join(root, 'docs/reports/fork-preflight-current.json'), JSON.stringify({
    report: file, reportSha256: sha256(fs.readFileSync(path.join(root, file))),
    snapshotSha256: snapshot.sha256, status: report.status,
  }, null, 2) + '\n');
  console.log(JSON.stringify({ report: file, status: report.status, checks: report.checks }, null, 2));
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => {
    console.error('Invalid fork inputs or local report error. Set FORK_RPC, FORK_BLOCK and two distinct FORK_ACTORS; no credentials are logged.');
    process.exitCode = 1;
  });
