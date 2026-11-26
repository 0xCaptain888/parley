import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, decodeEventLog } from 'viem';
import { aggregate } from './aggregate.mjs';
import abi from '../../helper/src/abi.json' with { type: 'json' };
import { atomicJson, readJson, locked } from '../../helper/src/state.mjs';
import { stringify } from '../../helper/src/calls.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export async function collect(config, { rpc, output = path.join(root, 'web/site/stats.json'), state = path.join(root, 'web/stats/state'),
  client: providedClient } = {}) {
  if (!config.contract || config.deploymentBlock === null) throw new Error('Deployment is not configured.');
  const client = providedClient || createPublicClient({ transport: http(rpc || 'https://bsc-rpc.publicnode.com', { timeout: 20000, retryCount: 1 }) });
  fs.mkdirSync(state, { recursive: true, mode: 0o700 });
  return locked(state, () => collectLocked(config, client, { state, output }));
}
async function collectLocked(config, client, { state, output }) {
  if (await client.getChainId() !== config.chainId) throw new Error('Wrong RPC chain');
  const head = await client.getBlockNumber();
  const toBlock = head >= 12n ? head - 12n : -1n;
  const deployment = BigInt(config.deploymentBlock);
  if (toBlock < deployment) throw new Error('Deployment has fewer than 12 confirmations; stats remain unchanged.');
  const observations = new Map();
  const header = async number => {
    const block = await client.getBlock({ blockNumber: number });
    if (block.number !== number || !/^0x[0-9a-f]{64}$/i.test(block.hash || ''))
      throw new Error('Invalid statistics block header; stats remain unchanged.');
    if (observations.has(number) && observations.get(number).hash !== block.hash)
      throw new Error('Chain changed during statistics collection; retry without publishing mixed branches.');
    observations.set(number, block);
    return block;
  };
  const target = await header(toBlock);
  const saved = readJson(path.join(state, 'events.json'), { chainId: config.chainId, contract: config.contract, events: [] });
  if (saved.contract.toLowerCase() !== config.contract.toLowerCase() || saved.chainId !== config.chainId) throw new Error('Stats deployment mismatch');
  // An unchanged anchor authenticates the retained prefix; legacy or changed anchors rebuild it.
  let start = deployment;
  if (saved.block !== undefined && BigInt(saved.block) <= toBlock && saved.anchor
    && BigInt(saved.anchor.block) >= deployment && BigInt(saved.anchor.block) <= BigInt(saved.block)) {
    const anchor = await header(BigInt(saved.anchor.block));
    if (anchor.hash === saved.anchor.hash) start = anchor.number + 1n;
  }
  const events = saved.events.filter(e => BigInt(e.blockNumber) < start
    && BigInt(e.blockNumber) >= deployment), headers = new Map();
  const anchorNumber = toBlock - 65n > deployment ? toBlock - 65n : deployment;
  const anchor = await header(anchorNumber);
  let step = 1000n;
  for (let fromBlock = start; fromBlock <= toBlock;) {
    const end = fromBlock + step - 1n > toBlock ? toBlock : fromBlock + step - 1n;
    let logs;
    try { logs = await client.getLogs({ address: config.contract, fromBlock, toBlock: end }); }
    catch (e) { if (step > 1n) { step = step / 2n || 1n; continue; } throw e; }
    for (const l of logs) {
      if (l.removed || l.blockNumber < fromBlock || l.blockNumber > end
        || l.address?.toLowerCase() !== config.contract.toLowerCase()
        || !/^0x[0-9a-f]{64}$/i.test(l.transactionHash || '') || !Number.isSafeInteger(l.logIndex) || l.logIndex < 0)
        throw new Error('Invalid statistics log; stats remain unchanged.');
      if (!headers.has(l.blockNumber)) headers.set(l.blockNumber, await header(l.blockNumber));
      const block = headers.get(l.blockNumber);
      if (block.hash !== l.blockHash) throw new Error('Statistics log is not canonical; stats remain unchanged.');
      try {
        events.push(JSON.parse(stringify({ ...decodeEventLog({ abi, topics: l.topics, data: l.data }), transactionHash: l.transactionHash,
          logIndex: l.logIndex, blockNumber: l.blockNumber, blockHash: l.blockHash, timestamp: Number(block.timestamp) })));
      } catch { /* Ignore unknown event topics; do not invent decoded fields. */ }
    }
    fromBlock = end + 1n;
  }
  // Check all sampled headers again before committing any new state or public output.
  for (const number of observations.keys()) await header(number);
  const stats = aggregate(events, config, toBlock, Math.floor(Date.now() / 1000));
  stats.blockHash = target.hash;
  atomicJson(path.join(state, 'events.json'), { chainId: config.chainId, contract: config.contract,
    block: toBlock.toString(), blockHash: target.hash, anchor: { block: anchorNumber.toString(), hash: anchor.hash }, events });
  atomicJson(output, stats);
  return stats;
}
