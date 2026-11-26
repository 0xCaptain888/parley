# Independent Security Review Handoff

This procedure implements the release blocker in sections 11.3 and 12. It does not appoint an independent reviewer, perform an audit, or authorize a wallet action.

## Prepare Current Evidence

Run the full local verifier, fresh Slither scan and local security summary in that order:

```sh
npm run verify -- /path/to/parley-reference.zip
npm run check:slither
npm run check:security
npm run prepare:audit
```

Preparation refuses stale snapshots, changed compiler inputs and modified verification logs. It creates a timestamped `docs/reports/audit-request-*.json` with every scanner finding and both separate observations pending. It never modifies `auditReview`, release configuration or a previous request.

Provide the reviewer with the complete project snapshot, compiler inputs, the request and referenced local reports. Local assessments are implementation-side explanations, not reviewer decisions. Retain all scanner severities and exact finding IDs. No automated test run or AI-authored declaration establishes independent reviewer provenance.

Create a closed-set handoff archive after the current verification, scan and
security summary have passed:

```sh
npm run prepare:audit-handoff -- /absolute/new/audit-handoff
```

The tool includes the exact snapshot inputs, compiler build with dependency
sources, referenced verification logs, scan, local summary and a fresh pending
request. It refuses stale or changed inputs, writes an exclusive local output,
and verifies every ZIP member and checksum. It does not include wallet sessions,
Telegram credentials, participant input kits or arbitrary workspace files,
upload anything, mark findings resolved or authorize script execution.
The complete repository documentation and deployment environment remain
additional review context, not a claim that this archive is a sufficient audit.

## Required Review

The independent reviewer must cover each finding individually, including related detector results in the same function. Review TOKEN-REQUEST-01 and ID-LIFECYCLE-01 separately. Review every native/token settlement direction, callback behavior, failure rollback, pending liabilities, registry assumptions and token liveness. Review the original reference changes and compiler/dependency inputs.

For each item fill:

- `disposition`: `false-positive`, `mitigated` or `accepted-risk`. High/Medium accepted risks block publication; a code fix requires a fresh full verification, scan, fork and review against the new snapshot.
- `rationale`: substantive independent reasoning, not a copied label.
- `reviewedBy` and `reviewedAt`: named reviewer and actual timestamp after the referenced evidence was completed.
- `evidence`: nonempty project-relative file paths and SHA256 hashes. Supporting files must remain available, contained in the project and unchanged.

Final approval additionally requires schema version 2, the exact snapshot, contract, compiler, scan and verification hashes; nonempty unique reviewer identities; `independenceDeclared: true`; `releaseDecision: approve`; `independentAudit: completed`; `completedAt`; and no `unresolvedIssues`. Do not set these fields until the independent review actually occurred.

Verify the completed report without modifying release flags:

```sh
node scripts/prepare-audit.mjs --validate docs/reports/ACTUAL-INDEPENDENT-REVIEW.json
```

An operator must separately verify reviewer identity, independence and the provenance/quality of the supporting report. JSON and hash checks cannot prove these properties. After that check, explicitly bind the real report in `config/release-evidence.json.auditEvidence` with `report`, `reportSha256` and `snapshotSha256`. Setting `auditReview: completed` alone does not pass release.

## Structural Regression Boundary

`npm run check:boundaries` walks the compiler AST, follows Parley's internal function references, and requires the canonical inherited `nonReentrant` modifier on all 13 currently funded external entry points. It checks nine documented exit paths for direct/transitive pause dependencies, keeps guardian references limited to `setPaused`, and limits native push sites to `_pay` and `withdraw`. New assembly or delegated execution fails closed.

Mutation tests remove guards, impersonate a guard by name, insert exit pause dependencies and expand authority/native calls to demonstrate that these regressions are rejected. These checks are deliberately narrow: they are not arbitrary call-target analysis, runtime proof, inherited-library verification or an independent audit.

## Ordered Release Work

Do not turn a passed local review into permission to sign, deploy, publish, submit or recruit users. The next stages remain separately gated: official-wallet checks; individually approved final deployment and BscScan verification; the complete 20-step two-real-ID acceptance; public installation/hosting/operations; genuine users and submission.

The old immutable trial lacks TOKEN-REQUEST-01. Its four historical check results do not approve revised bytecode. Fork impersonation is not a second consenting wallet holder. Public staging and material drafts can be prepared in parallel, clearly separated from a production release.
