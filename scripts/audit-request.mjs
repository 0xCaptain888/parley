import assert from 'node:assert/strict';
import { sha256 } from './evidence.mjs';

export function auditRequest(context, createdAt = new Date().toISOString()) {
  assert.ok(Number.isFinite(Date.parse(createdAt)) && Date.parse(createdAt) >= context.reviewNotBefore,
    'Request must not predate its evidence');
  const pending = () => ({ disposition: 'pending', rationale: '', reviewedBy: null, reviewedAt: null, evidence: [] });
  return {
    schemaVersion: 2, independentAudit: 'pending', independenceDeclared: false, releaseDecision: 'blocked',
    createdAt, completedAt: null, reviewers: [], unresolvedIssues: [],
    snapshotSha256: context.snapshot.sha256,
    sourceHash: context.snapshot.files['contracts/contracts/Parley.sol'],
    compilerBuildSha256: context.compilerBuildSha256,
    scanReportSha256: sha256(context.scanRaw), verificationReportSha256: context.verificationReportSha256,
    findings: context.scan.results.detectors.map(d => ({
      id: d.id, detector: d.check, originalImpact: d.impact, originalConfidence: d.confidence,
      description: d.description, ...pending(),
    })),
    observations: context.security.additionalObservations.map(o => ({
      id: o.id, description: o.summary, ...pending(),
    })),
    references: {
      localReview: context.securityPointer, verification: context.verificationPointer, scan: context.scanPointer,
    },
  };
}
