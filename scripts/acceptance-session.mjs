import assert from 'node:assert/strict';
import { inspectAcceptance } from './acceptance-evidence.mjs';

export function acceptanceSession(input) {
  const inspection = inspectAcceptance(input);
  const { plan } = input;
  const next = plan.steps.find(s => s.status !== 'passed');
  const blockers = [];
  if (!plan.deployment.contract || !plan.deployment.deploymentBlock) blockers.push('FINAL_DEPLOYMENT_REQUIRED');
  if (plan.prerequisites?.independentReview !== 'completed') blockers.push('INDEPENDENT_REVIEW_REQUIRED');
  if (plan.prerequisites?.verifiedFinalDeployment !== 'passed') blockers.push('VERIFIED_DEPLOYMENT_REQUIRED');
  if (plan.prerequisites?.officialWalletChecks !== 'passed') blockers.push('REAL_WALLET_CHECKS_REQUIRED');
  if (!plan.prerequisites?.budgetApproval) blockers.push('BUDGET_APPROVAL_REQUIRED');
  if (!plan.prerequisites?.actualHttpsOrigin
    || plan.prerequisites.actualHttpsOrigin !== plan.deployment.site) blockers.push('PUBLIC_ORIGIN_ACCEPTANCE_REQUIRED');
  for (const name of ['A', 'B']) {
    const person = plan.participants?.[name];
    if (!person?.handle || !person?.wallet || !person?.consentEvidence)
      blockers.push(`PARTICIPANT_${name}_CONSENT_REQUIRED`);
  }
  return { ...inspection, status: blockers.length ? 'blocked' : next ? 'awaiting-real-participant' : inspection.status,
    blockers, nextStep: next ? {
      id: next.id, actor: next.actor, kind: next.kind, action: next.action, expected: next.expected,
      command: next.command, currentStatus: next.status,
      individualTransactionConsentRequired: ['transaction', 'transactions', 'mixed'].includes(next.kind),
    } : null, automaticExecution: false,
    note: 'This session neither runs wallet commands nor authenticates supplied human evidence' };
}

export function recordAcceptanceStep({ patch, ...input }) {
  const before = inspectAcceptance(input);
  assert.ok(patch && typeof patch === 'object' && !Array.isArray(patch), 'Step patch required');
  const required = ['id', 'status', 'performedAt', 'verifiedBy', 'evidence', 'transactions'];
  const rejection = ['noCallsProduced', 'policyBeforeSha256', 'policyAfterSha256', 'expectedError'];
  const next = input.plan.steps.find(s => s.status !== 'passed');
  assert.ok(next, 'All steps already have supplied evidence');
  assert.equal(patch.id, next.id, 'Record only the next unfinished step');
  assert.deepEqual(Object.keys(patch).sort(), [...required,
    ...(next.kind === 'rejection' ? rejection : [])].sort(), 'Unexpected step patch fields');
  assert.equal(patch.status, 'passed', 'Use this command only for actual completed observations');
  const plan = structuredClone(input.plan);
  Object.assign(plan.steps[next.id - 1], structuredClone(patch));
  const inspection = inspectAcceptance({ ...input, plan });
  assert.equal(inspection.completedSteps, before.completedSteps + 1);
  plan.status = inspection.status;
  return { plan, inspection };
}
