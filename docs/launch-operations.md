# Launch Operations Upgrade

2026-11-24. This is implementation and operating guidance, not evidence that production deployment, human acceptance, publication or growth has happened.

## Wallet

`npm run check:wallet` now checks skill 1.15.0 and CLI 1.12.0. It does not install, log in, change settings or sign. An unknown developer-mode balance-cap state is rejected; an exceeded cap makes `externalSigningReady` false. This is still not business-method acceptance.

If different working directories select different Node installations, explicitly bind the wallet subprocess runtime rather than changing global shell or credential settings:

```sh
npm run check:wallet -- --runtime /absolute/path/to/node
```

This prepends the selected runtime directory only for the official CLI child. On this host, the 2026-11-24 diagnostic found queries succeeding with the installed Node 24 runtime and timing out with the project-selected Node 22 runtime; this observation is not a general claim that the official CLI cannot support Node 22. A failed check records the stage without persisting raw output.

## Deployment RPC Preflight

```sh
npm run check:deployment-rpc -- --intent /absolute/private/deployment-intent.json --rpc https://bsc-rpc.publicnode.com
```

The intent has no monetary defaults. The command regenerates the exact creation calldata from the current compiler, checks chain/registry/token code and token decimals at a pinned block, estimates direct creation gas, applies a 20% gas-unit margin, checks the entered gas budget and deployer balance, and rechecks the block hash. It neither selects an official-wallet route nor broadcasts. A factory route needs separately reviewed factory bytecode, creation calldata, address derivation and internal-creation evidence. The direct-creation estimate cannot certify it.

Existing `scripts/export-verification.mjs` and `scripts/post-deploy.mjs` remain available for exact constructor input and runtime inspection. Neither is BscScan verification. Independent security approval, final parameters, a supported deployment route, a fresh official preview and separate per-call consent remain prerequisites.

## Twenty-Step Chain Observation

```sh
npm run check:acceptance-chain -- --record /absolute/private/acceptance.json --rpc https://bsc-rpc.publicnode.com
```

Run the existing structural validator first. For each supplied transaction, `previewEvidence` must refer to contained, hashed JSON:

```json
{
  "schemaVersion": 1,
  "requestId": "EXACT_OFFICIAL_PREVIEW_REQUEST_ID",
  "chainId": 56,
  "from": "FULL_REVIEWED_SENDER",
  "to": "FULL_REVIEWED_TARGET",
  "data": "EXACT_REVIEWED_CALLDATA",
  "valueWei": "0",
  "previewedAt": "ISO_PREVIEW_TIME",
  "expiresAt": "ISO_PREVIEW_EXPIRY"
}
```

This normalized record must be derived from a genuine reviewed preview. RPC cannot authenticate its origin or the human's consent; retain original sanitized official output for independent review.

`assetDeltaEvidence` must reference JSON with `schemaVersion: 1` and a nonempty `expectedEvents` array. Each expectation has a full `address`, exact `eventName`, and nonempty `args` object with string-encoded values. Never put message bodies or ciphertext in report expectations. Supply meaningful amount/from/to fields for asset transfers, not only an event name.

The checker compares the mined hash/chain/from/to/input/value and receipt status/block/index to the supplied record, checks twelve confirmations and transaction order, rechecks canonical headers, decodes and re-encodes calldata, restricts methods to the original acceptance step and verifies the required business-method sequence. Token approvals must be exact and in token-payment steps. Step 12 additionally requires zero USDT allowance at the end of the payment block. It observes current Agent ID ownership and the canonical guardian and records receipt events plus actual gas fees, omitting mail data, memos and public keys.

Limitations: configured-RPC trust, no independent human identity/consent authentication, no historical Agent ID ownership proof, no transaction-isolated balance delta proof, and no verification of every read-only/rejection/UI business assertion. A matching event does not establish the truth of an interview or App screenshot. The report never changes release flags.

## Private Operations

Copy `config/operations.example.json` to a private file, mode 0600, and explicitly set `operationsPath` in the private resident configuration. Keep its webhook URL out of public files. An enabled webhook requires operator authorization and an actual destination.

`prepare:resident` now generates three jobs routed through `scripts/ops-job.mjs`. The resident remains proposal-only; health and statistics remain read-only. Runner stdout/stderr are not persisted because they may contain private mail. Each runner emits only an allowlisted operational record into private rotating JSONL logs. launchd's standard output goes to `/dev/null`; do not rely on its former raw `.out.log` files.

Defaults when no operations file is bound: 1 MiB per current log, seven retained generations, alerts disabled. Jobs share a log-directory lock to avoid concurrent rotation. A busy invocation fails closed and a later scheduled invocation retries; this is not an execution retry for a financial transaction.

Alerts contain only deployment, severity, timestamp and fixed check codes. HTTPS destinations are checked against all DNS answers and pinned for the request; private/reserved addresses and redirects are refused. Identical incidents are suppressed until the configured cooldown, severity/check changes are sent immediately, and recovery is sent once. A failed delivery does not advance deduplication state. The real webhook is not tested by fixture success.

```sh
npm run check:operations-soak -- --build /absolute/final/build.json --logs /absolute/private/logs
```

This checks 24 hours of supplied local runner records for resident/health/stats, deployment binding, gaps and unhealthy runs. It does not wait 24 hours, install services or independently prove uptime. A generated plan or empty logs remain incomplete.

No real service is installed by these commands. A final deployment, resident identity/exclusion, private state/home, budgets, fresh reference prices, real host, alert destination and operator staffing are still required.

## Cloudflare Publication

First create a fresh source-bound staging bundle with the existing verification and security prerequisites. Plan an exact public upload:

```sh
npm run prepare:publication -- --manifest docs/reports/site-bundle-TIMESTAMP/site/release-manifest.json --origin https://parley-staging.pages.dev --project parley-staging
```

This creates a new fifteen-file public-only directory and a publication digest. It does not upload. Candidate bundles may add `--stats /absolute/collector/stats.json`; only fresh, deployment-bound, exclusion-matched collector-schema fields are allowed. Statistics packages still need genuine collector provenance and release review. Arbitrary strings and extra private fields are rejected.

After the operator reviews the exact target and digest and authorizes that publication:

```sh
npm run publish:site -- --plan docs/reports/publication-TIMESTAMP/report.json --consent-digest EXACT_REVIEWED_DIGEST
```

The command reconstructs the digest, rejects stale source/unexpected files, enforces the production gate for candidate mode regardless of editable plan flags, invokes an already installed/authenticated Wrangler without a shell, then performs HTTP checks. It does not install Wrangler or obtain credentials. An interrupted upload can have reached Cloudflare; inspect deployment history before retrying. HTTP acceptance is not browser or clean-machine installation acceptance.

Statistics collection is scheduled; public statistics upload remains a separate explicit publication, not an automatically authorized upload every five minutes. No production release prerequisite is bypassed to publish metrics.

## Submission and Real Users

```sh
npm run prepare:submission -- --input /absolute/private/submission.json
```

Start from `config/submission.example.json` and bind the actual current snapshot. Public repository, video and actual form entries each need `url` and hashed `evidence`. Each real interview needs a pseudonymous `participantId`, past `conductedAt`, `consentEvidence` and `notesEvidence`. Growth has a separate hashed evidence reference; publication consent is explicit.

The output is a private completeness index, not a public archive or authenticity certificate. Missing users, interviews, video, growth or form information stays missing. It never submits a form, publishes personal data or fabricates results.
