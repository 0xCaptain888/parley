# Current-Source Verification

2026-11-23. Local checks are not an independent audit, deployment approval or mainnet acceptance.

## Order

```sh
npm run verify -- /path/to/parley-reference.zip
npm run check:slither
npm run check:security
```

The ZIP argument is optional: without it the declared source hashes are still checked, but the reference archive itself is not re-read. With it, all three baseline entries are compared with their recorded original hashes.

`config/source-baseline.json` records the original reference contract, envelope and original contract test. Only the explicitly recorded TOKEN-REQUEST-01 contract revision is allowed to differ. This declaration is not independent approval. Unrecorded changes fail; do not automatically update hashes to make a failed check pass.

## Full Local Run

The verifier runs coverage, ordinary contract/envelope tests, root tests, compiler-AST security-boundary checks, verified-registry recompilation and ten local lifecycle checks, three 5,000-step fuzz seeds, local integration, Solhint, build/repeat-build and development/production-denial checks. Coverage requires 100% lines/statements/functions and no regression below the recorded 84.74% reference branch coverage. Ordinary compilation precedes root tests so that AST checks never read coverage-instrumented compiler output.

Fork RPC, fork block, deployment key and ambient long-fuzz mode are removed from child environments. Only the dedicated fuzz command enables long fuzz. Integration uses a temporary loopback node, mock identities/tokens and local test signers, not a wallet session.

Each run gets its own `docs/reports/local-verification-<timestamp>/` with source/test/config/lockfile hashes, commands' logs, coverage data and the compiler/build/runtime description. The final snapshot must match the initial one. A failed run remains visibly failed; it does not replace old evidence with a success.

`docs/reports/verification-current.json` points to the latest attempt and hashes its report. Historical `verification.json` is preserved. Timestamps are ISO UTC; reports declare Asia/Shanghai for user-facing interpretation.

## Fresh Static Scan

`scan.mjs` follows the current artifact's debug pointer and verifies the compiler input against current contract/dependency sources. It copies only that compiler record into an isolated scan directory, so previous builds and coverage-instrumented outputs cannot silently join the scan.

The local pinned `.venv-audit/bin/slither` must exist. The scan does not install packages or fetch a compiler. It saves raw JSON, process log, tool version, source snapshot hash, compiler hash, raw-report hash and actual exit status.

`docs/reports/slither-current.json` points to the result. Driver success means analysis completed, not that no findings exist: Slither's original findings exit status and severity counts are preserved.

## Local Security Summary

`security-review.mjs` requires passed full-verification evidence and completed scan evidence for the same current snapshot and compiler build. It verifies report/log hashes and uses the new detector output rather than a hard-coded finding count. A new detector group is left explicitly unassessed, not silently inherited as safe.

`docs/reports/security-review-current.json` points to a timestamped summary. Every finding retains its original severity, description and `independentSignoff: pending`. Local regression tests and source-based explanations do not close findings.

## Independent Review and Production

The real-registry/token local fork passed 22 shared contract checks and 47 local business transactions at BSC block 135185365. This does not establish real-wallet acceptance or full BSC consensus equivalence. `fork-current.json` points to the latest attempt, including failures; timestamped attempts are preserved. Reports bind the source snapshot, contract hash, public prerequisite checks, canonical block, code hashes and local deployment/transaction receipts. They never record RPC URLs or raw transport exceptions.

The recorded `forkTest` gate supplies an explicit report path, SHA256 and snapshot SHA256. `validateForkBinding` rejects stale, tampered, failed or incomplete reports, changed blocks, mismatched actors/code and wallet/mainnet/patched-token flags. Any tracked source change requires fresh fork evidence before production acceptance. The ordinary local verifier does not perform a network fork.

Production publication remains blocked by the existing eleven external checks, BscScan verification, real-ID E2E and independent-review requirements.

In addition to `auditReview: completed`, release evidence must provide `auditEvidence` with a report path, report SHA256 and current snapshot SHA256. Schema-2 review evidence binds the current compiler, exact static scan and full verification; it requires one independently reasoned decision for every finding and separate observation, named item reviewers, dates and integrity-checked supporting files. Missing/duplicate items, altered severities, unresolved issues and accepted High/Medium risks fail closed. See [independent review handoff](independent-review.md). These checks cannot authenticate a reviewer or prove the quality of an audit. An operator must independently check provenance.

Do not change the pending audit state automatically, reuse old trial gates for revised bytecode, or let test success authorize deployment/signing.
