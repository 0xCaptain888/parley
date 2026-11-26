import assert from 'node:assert/strict';
import { sha256 } from './evidence.mjs';

const https = value => {
  const u = new URL(value);
  assert.ok(u.protocol === 'https:' && !u.username && !u.password && !u.hash, 'Public HTTPS submission URL required');
  return u.href;
};
export function submissionPlan({ input, snapshotSha256, readEvidence, now = Date.now() }) {
  assert.equal(input.schemaVersion, 1);
  assert.equal(input.snapshotSha256, snapshotSha256, 'Submission covers stale source');
  assert.deepEqual(Object.keys(input).sort(), ['schemaVersion', 'snapshotSha256', 'publicRepository', 'demoVideo',
    'submissionForm', 'interviews', 'growthEvidence', 'consentedForPublication'].sort(), 'Unknown submission input');
  const reference = r => {
    assert.ok(r && /^[0-9a-f]{64}$/.test(r.sha256 || ''), 'Hashed submission evidence required');
    assert.equal(sha256(readEvidence(r.path)), r.sha256, 'Submission evidence changed');
    return { path: r.path, sha256: r.sha256 };
  };
  const missing = [], artifacts = {};
  for (const key of ['publicRepository', 'demoVideo', 'submissionForm']) {
    const item = input[key];
    if (!item) { missing.push(key); continue; }
    assert.deepEqual(Object.keys(item).sort(), ['url', 'evidence'].sort());
    artifacts[key] = { url: https(item.url), evidence: reference(item.evidence) };
  }
  assert.ok(Array.isArray(input.interviews), 'Interview array required');
  const ids = new Set(), interviews = [];
  for (const item of input.interviews) {
    assert.deepEqual(Object.keys(item).sort(), ['participantId', 'conductedAt', 'consentEvidence', 'notesEvidence'].sort());
    assert.match(item.participantId || '', /^[a-zA-Z0-9_-]{1,64}$/, 'Pseudonymous interview ID required');
    assert.ok(!ids.has(item.participantId), 'Duplicate interview');
    ids.add(item.participantId);
    const time = Date.parse(item.conductedAt);
    assert.ok(Number.isFinite(time) && time <= now, 'Future/invalid interview timestamp');
    interviews.push({ participantId: item.participantId, conductedAt: item.conductedAt,
      consentEvidence: reference(item.consentEvidence), notesEvidence: reference(item.notesEvidence) });
  }
  if (!interviews.length) missing.push('actual-interviews');
  if (input.growthEvidence) artifacts.growth = reference(input.growthEvidence);
  else missing.push('actual-growth-evidence');
  assert.equal(typeof input.consentedForPublication, 'boolean');
  if (!input.consentedForPublication) missing.push('publication-consent');
  return { schemaVersion: 1, status: missing.length ? 'incomplete' : 'materials-indexed-needs-human-review',
    snapshotSha256, missing, artifacts, interviewEvidenceCount: interviews.length, interviews,
    authenticityVerified: false, submissionMade: false, productionRelease: false,
    limitations: ['Hashed supplied files do not authenticate interviews, consent, growth, URLs or video contents',
      'Review current form fields, actual demo and public repository manually before submission',
      'Do not publish this private evidence index or interview notes with the public static site'] };
}
