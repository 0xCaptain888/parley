import assert from 'node:assert/strict';
import { acceptancePlan } from './acceptance-plan.mjs';
import { sha256 } from './evidence.mjs';
import { zeroAddress, isAddress } from 'viem';

const digest = v => assert.match(v || '', /^[0-9a-f]{64}$/, 'Invalid evidence digest');
const text = v => typeof v === 'string' && v.trim().length > 0;
const wallet = v => isAddress(v || '', { strict: false }) && v.toLowerCase() !== zeroAddress;
const timestamp = (v, now) => {
  assert.ok(typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v), 'ISO timestamp required');
  const n = Date.parse(v);
  assert.ok(Number.isFinite(n) && n <= now, 'Invalid or future evidence timestamp');
  return n;
};

// This checks supplied evidence structure and bytes, never the truth of an interview or consent.
export function inspectAcceptance({ plan, config, snapshotSha256, readEvidence, now = Date.now() }) {
  assert.equal(plan.schemaVersion, 1, 'Unknown acceptance schema');
  assert.equal(plan.snapshotSha256, snapshotSha256, 'Acceptance covers stale source');
  const expected = acceptancePlan(snapshotSha256, {
    chainId: config.chainId, contract: config.contract, deploymentBlock: config.deploymentBlock, site: config.site,
  });
  assert.deepEqual(plan.deployment, expected.deployment, 'Acceptance deployment differs from build');
  assert.equal(plan.steps?.length, 20, 'Exactly twenty steps required');
  const refs = list => {
    assert.ok(Array.isArray(list) && list.length > 0, 'Hashed evidence references required');
    for (const r of list) {
      digest(r.sha256);
      assert.equal(sha256(readEvidence(r.path)), r.sha256, 'Evidence bytes changed');
    }
  };
  const passed = plan.steps.filter(s => s.status === 'passed');
  if (passed.length) {
    assert.ok(wallet(config.contract) && Number.isSafeInteger(config.deploymentBlock) && config.deploymentBlock > 0,
      'Final deployment required for real acceptance');
    for (const name of ['A', 'B']) {
      const p = plan.participants?.[name];
      assert.ok(/^[a-z0-9]{1,64}$/.test(p?.handle || '') && wallet(p?.wallet), 'Real participant identity required');
      refs([p.consentEvidence]);
    }
    assert.notEqual(plan.participants.A.wallet.toLowerCase(), plan.participants.B.wallet.toLowerCase(),
      'Participants must use different wallets');
    assert.notEqual(plan.participants.A.handle, plan.participants.B.handle, 'Participants must have different handles');
  }
  const seen = new Set(), requests = new Set();
  for (const [i, s] of plan.steps.entries()) {
    for (const field of ['id', 'actor', 'kind', 'action', 'expected', 'command'])
      assert.equal(s[field], expected.steps[i][field], 'Acceptance step was changed');
    assert.ok(['pending', 'passed', 'failed', 'blocked'].includes(s.status), 'Unknown step status');
    if (s.status !== 'passed') continue;
    assert.ok(plan.steps.slice(0, i).every(p => p.status === 'passed'), 'Acceptance steps must complete in order');
    assert.ok(text(s.verifiedBy), 'Evidence reviewer required');
    const performed = timestamp(s.performedAt, now);
    refs(s.evidence);
    assert.ok(Array.isArray(s.transactions), 'Transactions must be an array');
    if (s.kind === 'read-only') assert.equal(s.transactions.length, 0, 'Read-only step cannot contain transactions');
    if (['transaction', 'transactions', 'mixed'].includes(s.kind))
      assert.ok(s.transactions.length > 0, 'Transaction-bearing step requires receipts');
    if (s.kind === 'rejection') {
      assert.equal(s.transactions.length, 0, 'Rejected command must not broadcast');
      assert.equal(s.noCallsProduced, true, 'Rejected command must produce no calls');
      digest(s.policyBeforeSha256); digest(s.policyAfterSha256);
      assert.equal(s.policyBeforeSha256, s.policyAfterSha256, 'Rejection changed local policy');
      assert.equal(s.expectedError, s.id === 5 ? 'ALREADY_CLAIMED' : 'OVER_POLICY_TX', 'Wrong rejection');
    }
    for (const tx of s.transactions) {
      assert.match(tx.hash || '', /^0x[0-9a-fA-F]{64}$/, 'Full transaction hash required');
      assert.ok(!seen.has(tx.hash.toLowerCase()), 'Receipt reused across acceptance calls');
      seen.add(tx.hash.toLowerCase());
      assert.equal(tx.chainId, 56, 'Wrong transaction chain');
      assert.ok(wallet(tx.from) && wallet(tx.to), 'Full transaction addresses required');
      assert.ok(/^(0|[1-9]\d*)$/.test(tx.valueWei || ''), 'Explicit wei value required');
      assert.ok(['approval', 'business', 'guardian'].includes(tx.kind), 'Explicit call kind required');
      const tokenApproval = tx.kind === 'approval';
      assert.ok((tokenApproval ? Object.values(config.tokens) : [config.contract])
        .some(a => a.toLowerCase() === tx.to.toLowerCase()), 'Unexpected transaction target');
      const actors = s.actor === 'either' ? ['A', 'B'] : s.actor.split('+');
      assert.ok(actors.some(a => plan.participants[a]?.wallet?.toLowerCase() === tx.from.toLowerCase()),
        'Transaction sender is not a step participant');
      if (tokenApproval) {
        assert.equal(tx.valueWei, '0', 'Token approval cannot send native funds');
        assert.ok(/^[1-9]\d*$/.test(tx.amountRaw || ''), 'Exact positive approval amount required');
        assert.equal(tx.spender?.toLowerCase(), config.contract.toLowerCase(), 'Wrong approval spender');
      }
      assert.equal(tx.receiptStatus, 'success', 'Successful receipt required');
      assert.ok(Number.isSafeInteger(tx.block) && tx.block >= config.deploymentBlock, 'Invalid receipt block');
      assert.match(tx.blockHash || '', /^0x[0-9a-fA-F]{64}$/, 'Full block hash required');
      assert.ok(text(tx.requestId), 'Preview request ID required');
      assert.ok(!requests.has(tx.requestId), 'Preview request reused across calls');
      requests.add(tx.requestId);
      const previewed = timestamp(tx.previewedAt, now), consented = timestamp(tx.consentedAt, now);
      const confirmed = timestamp(tx.confirmedAt, now), expires = Date.parse(tx.previewExpiresAt);
      assert.ok(Number.isFinite(expires) && previewed <= consented && consented < expires
        && consented <= confirmed && confirmed <= performed, 'Preview/consent/receipt chronology mismatch');
      for (const field of ['previewEvidence', 'consentEvidence', 'receiptEvidence', 'assetDeltaEvidence'])
        refs([tx[field]]);
    }
  }
  return { schemaVersion: 1, status: passed.length === 20 ? 'evidence-complete-needs-independent-review' : 'pending',
    completedSteps: passed.length, totalSteps: 20, suppliedTransactions: seen.size,
    checks: ['original-step-order', 'source-and-deployment-binding', 'contained-hashed-evidence',
      'participant-and-target-binding', 'separate-preview-consent-receipt', 'rejections-without-calls'],
    chainReceiptsIndependentlyVerified: false, participantIndependenceVerified: false,
    releaseFlagsModified: false, productionRelease: false };
}
