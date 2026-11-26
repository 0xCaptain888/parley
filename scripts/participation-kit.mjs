import assert from 'node:assert/strict';
import { acceptancePlan } from './acceptance-plan.mjs';
import { inspectDeploymentInputs } from './deployment-inputs.mjs';
import { handle, address, ZERO } from '../helper/src/normalize.mjs';

export function participationKit({ intent, participants, config, snapshotSha256 }) {
  const parameters = inspectDeploymentInputs(intent, config);
  assert.deepEqual(Object.keys(participants).sort(), ['A', 'B']);
  const people = {};
  for (const actor of ['A', 'B']) {
    const person = participants[actor];
    assert.deepEqual(Object.keys(person).sort(), ['handle', 'wallet']);
    assert.notEqual(address(person.wallet), ZERO);
    people[actor] = { handle: handle(person.handle), wallet: address(person.wallet), consentEvidence: null };
  }
  assert.notEqual(people.A.handle, people.B.handle, 'Different real participants required');
  assert.notEqual(people.A.wallet, people.B.wallet, 'Different participant wallets required');
  const acceptance = acceptancePlan(snapshotSha256, {
    chainId: config.chainId, contract: config.contract, deploymentBlock: config.deploymentBlock, site: config.site,
  });
  acceptance.participants = { ...people, guardian: { wallet: address(intent.guardian) } };
  const files = {
    'deployment-intent.json': structuredClone(intent),
    'deployment-input-check.json': parameters,
    'acceptance.json': acceptance,
    'submission.json': { schemaVersion: 1, snapshotSha256, publicRepository: null, demoVideo: null,
      submissionForm: null, interviews: [], growthEvidence: null, consentedForPublication: false },
    'interview-template.json': { schemaVersion: 1, participantId: null, conductedAt: null,
      consentEvidence: null, notes: [
        { question: 'What real payment or exchange problem did you try to solve?', answer: null },
        { question: 'Which Parley flow did you actually use, and what failed?', answer: null },
        { question: 'What did the wallet approval and fee information make clear or unclear?', answer: null },
        { question: 'Would you use it again, and what would need to change?', answer: null },
      ], quotationsApprovedForPublication: false },
    'growth-template.json': { schemaVersion: 1, snapshotSha256,
      chainId: config.chainId, contract: config.contract, windowStart: null, windowEnd: null,
      collectorEvidence: null, exclusionsEvidence: null, excluded: [...config.excluded],
      actualParticipants: null, actualBilateralConversations: null, actualSettledExchanges: null,
      publicationConsentEvidence: null, authenticityVerified: false },
  };
  for (const actor of ['A', 'B']) {
    files[`participant-${actor}-consent.json`] = { schemaVersion: 1, participantId: actor,
      handle: people[actor].handle, wallet: people[actor].wallet,
      consentedAt: null, consentedToTest: null, consentedToPublishIdentity: false,
      consentedToPublishScreenshots: false, evidence: null };
  }
  for (const step of acceptance.steps) {
    const patch = { id: step.id, status: null, performedAt: null, verifiedBy: null,
      evidence: [], transactions: [] };
    if (step.kind === 'rejection') Object.assign(patch, {
      noCallsProduced: null, policyBeforeSha256: null, policyAfterSha256: null, expectedError: null,
    });
    files[`steps/${String(step.id).padStart(2, '0')}.json`] = patch;
  }
  return { schemaVersion: 1, status: 'prepared-unperformed', files, completedSteps: 0,
    consentInferred: false, interviewsConducted: 0, growthInvented: false, publicUpload: false,
    walletAccess: false, productionRelease: false };
}
