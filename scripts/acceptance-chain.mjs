import assert from 'node:assert/strict';
import { decodeFunctionData, decodeEventLog, encodeFunctionData, parseAbi, keccak256 } from 'viem';
import { abi, tokenAbi, registryAbi } from '../helper/src/chain.mjs';
import { inspectAcceptance } from './acceptance-evidence.mjs';
import { sha256 } from './evidence.mjs';

const transferAbi = parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const hash = v => /^0x[0-9a-f]{64}$/i.test(v || '');
const plain = v => JSON.parse(JSON.stringify(v, (_k, x) => typeof x === 'bigint' ? x.toString() : x));
const allowed = { 2: ['openMailbox'], 3: ['createPacket'], 4: ['claimPacket'], 6: ['sendMessage'],
  8: ['blockHandle', 'unblockHandle'], 9: ['sendMessage'], 10: ['sendMessage'],
  11: ['requestPayment'], 12: ['payRequest'], 13: ['createOffer'], 14: ['createOffer'],
  15: ['acceptOffer'], 16: ['createOffer', 'cancelOffer'], 17: ['sendMessage'],
  19: ['createPacket', 'setPaused', 'claimPacket'] };
const requiredMethods = { 2: ['openMailbox'], 3: ['createPacket'], 4: ['claimPacket'], 6: ['sendMessage'],
  8: ['blockHandle', 'unblockHandle'], 9: ['sendMessage'], 10: ['sendMessage'], 11: ['requestPayment'],
  12: ['payRequest'], 13: ['createOffer'], 14: ['createOffer'], 15: ['acceptOffer'],
  16: ['createOffer', 'cancelOffer'], 17: ['sendMessage'],
  19: ['createPacket', 'setPaused', 'claimPacket', 'setPaused'] };

function evidenceJson(ref, readEvidence) {
  const raw = readEvidence(ref.path);
  assert.equal(sha256(raw), ref.sha256, 'Chain evidence bytes changed');
  return JSON.parse(raw);
}

// Supplied preview records are not authenticated by RPC: only mined transaction facts are.
export async function inspectAcceptanceChain({ plan, config, snapshotSha256, readEvidence, client,
  now = Date.now(), minimumConfirmations = 12 }) {
  const structure = inspectAcceptance({ plan, config, snapshotSha256, readEvidence, now });
  assert.ok(Number.isSafeInteger(minimumConfirmations) && minimumConfirmations >= 12, 'At least twelve confirmations required');
  if (!structure.completedSteps) return { ...structure, status: 'pending-no-chain-evidence', observedTransactions: [] };
  assert.equal(await client.getChainId(), config.chainId, 'Wrong acceptance chain');
  const head = await client.getBlockNumber({ cacheTime: 0 }), headers = new Map();
  const header = async number => {
    const b = await client.getBlock({ blockNumber: number });
    assert.ok(b.number === number && hash(b.hash), 'Invalid acceptance block');
    assert.ok(head >= number + BigInt(minimumConfirmations), 'Acceptance receipt has insufficient confirmations');
    assert.ok(!headers.has(number) || same(headers.get(number).hash, b.hash), 'Acceptance chain changed');
    headers.set(number, b);
    return b;
  };
  const identities = [], observations = [], allowances = [];
  const identityBlock = head - BigInt(minimumConfirmations);
  await header(identityBlock);
  const guardian = await client.readContract({ address: config.contract, abi,
    functionName: 'GUARDIAN', blockNumber: identityBlock });
  if (plan.steps[18].status === 'passed')
    assert.ok(same(guardian, plan.participants.guardian.wallet), 'Guardian differs from canonical contract');
  for (const actor of ['A', 'B']) {
    const p = plan.participants[actor];
    const owner = await client.readContract({ address: config.registry, abi: registryAbi,
      functionName: 'ownerOfHandle', args: [p.handle], blockNumber: identityBlock });
    assert.ok(same(owner, p.wallet), 'Participant handle ownership differs from canonical registry');
    identities.push({ actor, handle: p.handle, wallet: p.wallet, block: identityBlock.toString() });
  }
  let previousPosition = -1n;
  for (const step of plan.steps.filter(s => s.status === 'passed')) {
    const methods = [];
    for (const t of step.transactions) {
      const call = evidenceJson(t.previewEvidence, readEvidence);
      assert.equal(call.schemaVersion, 1, 'Normalized reviewed-call schema 1 required');
      assert.equal(call.requestId, t.requestId, 'Reviewed-call request mismatch');
      assert.equal(call.chainId, config.chainId, 'Reviewed-call chain mismatch');
      assert.ok(same(call.from, t.from) && same(call.to, t.to), 'Reviewed-call identity mismatch');
      assert.equal(call.valueWei, t.valueWei, 'Reviewed-call native value mismatch');
      assert.equal(call.previewedAt, t.previewedAt, 'Reviewed-call preview time mismatch');
      assert.equal(call.expiresAt, t.previewExpiresAt, 'Reviewed-call expiry mismatch');
      assert.match(call.data || '', /^0x(?:[0-9a-fA-F]{2}){4,}$/, 'Exact reviewed calldata required');
      const [tx, receipt] = await Promise.all([
        client.getTransaction({ hash: t.hash }), client.getTransactionReceipt({ hash: t.hash }),
      ]);
      const blockNumber = BigInt(t.block), block = await header(blockNumber);
      assert.ok(same(tx.hash, t.hash) && same(receipt.transactionHash, t.hash), 'RPC transaction hash mismatch');
      assert.ok(tx.chainId === config.chainId, 'Mined transaction chain mismatch');
      assert.ok(same(tx.from, t.from) && same(receipt.from, t.from), 'Mined sender mismatch');
      assert.ok(same(tx.to, t.to) && same(receipt.to, t.to), 'Mined target mismatch');
      assert.ok(same(tx.input, call.data) && BigInt(tx.value) === BigInt(t.valueWei), 'Mined call differs from reviewed call');
      assert.ok(receipt.status === 'success' && tx.blockNumber === blockNumber && receipt.blockNumber === blockNumber,
        'Mined status/block mismatch');
      assert.ok(same(tx.blockHash, block.hash) && same(receipt.blockHash, block.hash) && same(t.blockHash, block.hash),
        'Receipt is not canonical');
      const minedAt = Number(block.timestamp) * 1000;
      assert.ok(Number.isSafeInteger(minedAt) && minedAt >= Date.parse(t.consentedAt)
        && minedAt <= Date.parse(t.confirmedAt), 'Mined timestamp differs from consent/confirmation chronology');
      assert.ok(Number.isSafeInteger(receipt.transactionIndex) && receipt.transactionIndex >= 0
        && tx.transactionIndex === receipt.transactionIndex, 'Invalid transaction index');
      const position = blockNumber * (1n << 64n) + BigInt(receipt.transactionIndex);
      assert.ok(position > previousPosition, 'Acceptance chain transaction order differs from step order');
      previousPosition = position;
      const decoded = decodeFunctionData({ abi: t.kind === 'approval' ? tokenAbi : abi, data: tx.input });
      assert.equal(encodeFunctionData({ abi: t.kind === 'approval' ? tokenAbi : abi, ...decoded }).toLowerCase(),
        tx.input.toLowerCase(), 'Noncanonical or trailing calldata');
      if (t.kind === 'approval') {
        assert.ok([12, 14, 15].includes(step.id), 'Approval outside a token-payment step');
        assert.equal(decoded.functionName, 'approve');
        assert.ok(same(decoded.args[0], config.contract) && decoded.args[1] === BigInt(t.amountRaw),
          'Approval calldata differs from exact amount/spender');
      } else {
        assert.ok(allowed[step.id]?.includes(decoded.functionName), 'Unexpected business method for acceptance step');
        assert.equal(t.kind === 'guardian', decoded.functionName === 'setPaused', 'Guardian classification mismatch');
        if (t.kind === 'guardian') assert.ok(same(t.from, plan.participants.guardian.wallet), 'Wrong guardian sender');
        methods.push(decoded.functionName);
      }
      const events = [];
      for (const log of receipt.logs) {
        const token = Object.values(config.tokens).some(a => same(a, log.address));
        if (!token && !same(log.address, config.contract)) continue;
        assert.ok(log.removed !== true && same(log.transactionHash, t.hash) && same(log.blockHash, block.hash)
          && log.blockNumber === blockNumber, 'Noncanonical receipt event');
        let event;
        try { event = decodeEventLog({ abi: token ? [...tokenAbi, ...transferAbi] : abi,
          data: log.data, topics: log.topics, strict: true }); } catch { continue; }
        // Do not copy message bodies, ciphertext or memos into operational reports.
        const args = Object.fromEntries(Object.entries(plain(event.args)).filter(([key]) => !['data', 'memo', 'pubKey'].includes(key)));
        events.push({ address: log.address, eventName: event.eventName, args, logIndex: log.logIndex });
      }
      const assets = evidenceJson(t.assetDeltaEvidence, readEvidence);
      assert.equal(assets.schemaVersion, 1, 'Asset expectation schema 1 required');
      assert.ok(Array.isArray(assets.expectedEvents) && assets.expectedEvents.length > 0, 'Expected receipt events required');
      for (const expected of assets.expectedEvents) {
        assert.ok(expected.args && Object.keys(expected.args).length > 0, 'Event field expectations required');
        assert.ok(events.some(e => same(e.address, expected.address) && e.eventName === expected.eventName
          && Object.entries(expected.args).every(([key, value]) => typeof value === 'string'
            && (typeof e.args[key] === 'string' ? same(e.args[key], value) : String(e.args[key]) === value))),
        'Expected asset/business event absent from canonical receipt');
      }
      assert.ok(typeof receipt.gasUsed === 'bigint' && receipt.gasUsed > 0n
        && typeof receipt.effectiveGasPrice === 'bigint' && receipt.effectiveGasPrice >= 0n, 'Invalid receipt gas accounting');
      observations.push({ step: step.id, hash: t.hash, block: t.block, blockHash: block.hash,
        functionName: decoded.functionName, inputKeccak256: keccak256(tx.input),
        inputBytes: (tx.input.length - 2) / 2, gasPaidWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
        valueWei: t.valueWei, events });
    }
    assert.deepEqual(methods, requiredMethods[step.id] || [], 'Required step business-method sequence missing');
    if (step.id === 12) {
      const last = step.transactions.at(-1), blockNumber = BigInt(last.block);
      const remaining = await client.readContract({ address: config.tokens.USDT, abi: tokenAbi,
        functionName: 'allowance', args: [plan.participants.B.wallet, config.contract], blockNumber });
      assert.equal(remaining, 0n, 'Exact payment allowance must be zero after the payment block');
      allowances.push({ step: 12, token: config.tokens.USDT, owner: plan.participants.B.wallet,
        spender: config.contract, block: last.block, valueRaw: '0',
        scope: 'end-of-block state, not transaction-isolated state' });
    }
  }
  for (const [number, b] of headers)
    assert.ok(same((await client.getBlock({ blockNumber: number })).hash, b.hash), 'Acceptance chain changed during inspection');
  return { ...structure, status: structure.completedSteps === 20 ? 'chain-observed-needs-human-review' : 'partial-chain-observed',
    checkedAt: new Date(now).toISOString(), observedTransactions: observations, identities, allowances,
    chainReceiptsIndependentlyVerified: observations.length > 0, verifiedTransactionCount: observations.length,
    reviewLimitations: ['RPC observations depend on the configured provider, not a consensus proof',
      'Handle ownership at observed head does not prove two independent people or historical ownership',
      'Submitted preview and consent provenance requires independent human review',
      'Receipt events do not prove transaction-isolated wallet balance deltas or all business assertions'],
    participantIndependenceVerified: false, releaseFlagsModified: false, productionRelease: false };
}
