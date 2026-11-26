import { decodeEventLog } from 'viem';
import { abi, registryAbi } from '../helper/src/chain.mjs';

const event = abi.find(e => e.type === 'event' && e.name === 'PacketClaimed');
const hashPattern = /^0x[0-9a-f]{64}$/i;
const lower = value => value.toLowerCase();
function observedHeaders(client) {
  const seen = new Map();
  const header = async number => {
    const block = await client.getBlock({ blockNumber: number });
    if (block.number !== number || !hashPattern.test(block.hash || ''))
      throw new Error('Invalid claim block header');
    if (seen.has(number) && seen.get(number) !== block.hash) throw new Error('Claim chain changed during reading');
    seen.set(number, block.hash);
    return block;
  };
  return { header, recheck: async () => { for (const number of seen.keys()) await header(number); } };
}
function decode(log, build, start, end) {
  if (log.removed || typeof log.blockNumber !== 'bigint' || log.blockNumber < start || log.blockNumber > end
    || lower(log.address || '') !== lower(build.contract) || !hashPattern.test(log.transactionHash || '')
    || !hashPattern.test(log.blockHash || '') || !Number.isSafeInteger(log.logIndex) || log.logIndex < 0)
    throw new Error('Invalid claim log');
  const decoded = decodeEventLog({ abi: [event], topics: log.topics, data: log.data, strict: true });
  if (decoded.eventName !== 'PacketClaimed') throw new Error('Unexpected claim event');
  return decoded.args;
}
const readAt = (chain, build, blockNumber, functionName, args, registry = false) =>
  chain.client.readContract({ address: registry ? build.registry : build.contract,
    abi: registry ? registryAbi : abi, functionName, args, blockNumber });

export async function scanClaims(chain, build, from, state) {
  await chain.verify();
  if (build.deploymentBlock === null || build.deploymentBlock === undefined)
    throw new Error('Claim deployment block is missing');
  const deployment = BigInt(build.deploymentBlock), head = await chain.client.getBlockNumber({ cacheTime: 0 });
  const end = head >= 12n ? head - 12n : -1n;
  if (end < deployment) throw new Error('Claim deployment has fewer than 12 confirmations');
  const { header, recheck } = observedHeaders(chain.client);
  const target = await header(end);
  let start = deployment;
  if (state.claimCursor) {
    const cursor = state.claimCursor, previous = BigInt(cursor.anchor.block);
    if (previous < deployment || previous > end || BigInt(cursor.nextBlock) !== previous + 1n
      || (await header(previous)).hash !== cursor.anchor.hash)
      throw new Error('Claim cursor changed branch; operator reconciliation required');
    start = BigInt(cursor.nextBlock);
  }
  // Legacy number-only cursors are deliberately replayed from deployment.
  const items = [], seen = new Map();
  for (; start <= end; start += 1000n) {
    const toBlock = start + 999n > end ? end : start + 999n;
    const logs = await chain.client.getLogs({ address: build.contract, event, strict: true, fromBlock: start, toBlock });
    for (const log of logs) {
      const args = decode(log, build, start, toBlock);
      if ((await header(log.blockNumber)).hash !== log.blockHash) throw new Error('Claim log is not canonical');
      const key = `${log.transactionHash}:${log.logIndex}`;
      if (seen.has(key)) {
        if (seen.get(key) !== log.blockHash) throw new Error('Conflicting duplicate claim');
        continue;
      }
      seen.set(key, log.blockHash);
      const packet = await readAt(chain, build, end, 'packets', [args.id]);
      if (lower(packet[0]) !== lower(from)) continue;
      const handle = await readAt(chain, build, end, 'handleOf', [args.claimer], true);
      if (!/^[a-z0-9]{1,64}$/.test(handle)) continue;
      if (lower(await readAt(chain, build, end, 'ownerOfHandle', [handle], true)) !== lower(args.claimer)) continue;
      items.push({ index: `claim:${args.id}:${lower(args.claimer)}`, kind: 'claim', from: `${handle}.ai`,
        claim: { id: args.id.toString(), claimer: lower(args.claimer), handle,
          transactionHash: log.transactionHash, logIndex: log.logIndex,
          block: log.blockNumber.toString(), blockHash: log.blockHash } });
    }
  }
  await recheck();
  return { items, cursor: { nextBlock: (end + 1n).toString(), anchor: { block: end.toString(), hash: target.hash } } };
}

export async function verifyClaim(chain, build, from, claim) {
  await chain.verify();
  const head = await chain.client.getBlockNumber({ cacheTime: 0 }), block = BigInt(claim.block);
  if (head < block + 12n) throw new Error('Claim no longer has 12 confirmations');
  const { header, recheck } = observedHeaders(chain.client);
  if ((await header(block)).hash !== claim.blockHash) throw new Error('Claim changed branch');
  const receipt = await chain.client.getTransactionReceipt({ hash: claim.transactionHash });
  if (receipt.status !== 'success' || receipt.blockNumber !== block || receipt.blockHash !== claim.blockHash)
    throw new Error('Claim receipt is not canonical');
  const log = receipt.logs.find(l => l.logIndex === claim.logIndex);
  if (!log || log.transactionHash !== claim.transactionHash || log.blockHash !== claim.blockHash)
    throw new Error('Claim receipt log is missing or changed branch');
  const args = decode(log, build, block, block);
  if (args.id.toString() !== claim.id || lower(args.claimer) !== claim.claimer)
    throw new Error('Claim receipt does not match proposal');
  const packet = await readAt(chain, build, block, 'packets', [args.id]);
  if (lower(packet[0]) !== lower(from)) throw new Error('Claim is not from the resident packet');
  const owner = await chain.client.readContract({ address: build.registry, abi: registryAbi,
    functionName: 'ownerOfHandle', args: [claim.handle] });
  if (lower(owner) !== claim.claimer) throw new Error('Claim handle now belongs to another wallet');
  await recheck();
}
