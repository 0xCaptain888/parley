import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptancePlan } from '../../scripts/acceptance-plan.mjs';

test('acceptance plan contains exactly all 20 original steps and never closes external gates', () => {
  const plan = acceptancePlan('snapshot', { chainId: 56, contract: null });
  assert.deepEqual(plan.steps.map(s => s.id), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.ok(plan.steps.every(s => s.status === 'pending' && s.transactions.length === 0 && s.evidence.length === 0));
  assert.equal(plan.status, 'pending'); assert.equal(plan.productionRelease, false);
  assert.equal(plan.participants.B.wallet, null);
  assert.match(plan.steps[11].action, /separately regenerate/);
  assert.match(plan.steps[16].expected, /policy set/);
  assert.match(plan.steps[18].action, /pause.*claim.*resume/);
  assert.match(plan.steps[19].expected, /toHandle/);
  const second = acceptancePlan('snapshot', {});
  plan.steps[0].evidence.push('not real evidence');
  assert.deepEqual(second.steps[0].evidence, []);
});
