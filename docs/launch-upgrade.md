# Launch Upgrade: Items 2 Through 6

2026-11-24. These commands prepare or inspect deployment, wallet, acceptance, installation and resident operations. None authorize deployment, signing, token approval, public upload, daemon installation or submission. The independent audit remains a prerequisite for production funds.

## 2. Deployment

`config/deployment-intent.example.json` deliberately leaves identities, monetary limits and gas budget empty. Supply an operator-reviewed private JSON with the exact same fields. Values ending in BNB are decimal BNB; the two listed token caps are decimal token amounts, encoded with the existing BSC tokens' 18 decimals. Confirm those decimals against the target chain before deployment. No sample budget is treated as approval.

```sh
npm run prepare:deployment -- --intent /absolute/private/deployment-intent.json
```

This validates canonical HTTPS, chain, complete addresses, precision, uint64/128/256 bounds, postage/share/cap consistency and positive gas budget. The output contains exact creation calldata, its Keccak digest, seven constructor arguments and current source/compiler bindings. It does not estimate live gas, choose a factory, allocate a nonce, predict an address or produce an authorized execute command.

Select and independently review the deployment route before the official wallet preview. A factory route requires separate internal-creation evidence; the existing post-deployment direct-creation inspector intentionally cannot certify it. Keep the immutable old trial separate from a new final deployment. After a confirmed deployment, use the existing verification export and canonical runtime/constructor inspection, then perform actual BscScan verification.

## 3. Read-Only Wallet Inspection

```sh
npm run check:wallet
```

The documented preflight runs in order: skill version, CLI version, wallet status. Updates needing consent stop the flow. An unconnected wallet stops before further wallet reads; this command never signs in, installs software or changes settings.

When connected, inspect only settings, the current user's BSC address and BSC transaction lock. Reports allowlist session expiry, developer mode/expiry/limits, ordinary quota and lock status. Raw CLI responses and credentials are not written. A session expiring within three hours is flagged. An ISO developer-mode expiry and Unix-second expiry are both supported.

The result proves none of the business-method checks. Exact token approval, lengthy calldata, App-confirmation behavior and enforced quota boundaries still require real official previews and separately authorized calls.

## 4. Twenty-Step Evidence Inspection

First regenerate the current-source pending plan with `npm run prepare:acceptance`. Copy it to a private working record and add only genuine, consented evidence. Evidence references have the shape `{"path":"docs/private-evidence/receipt.json","sha256":"..."}`; paths must stay within the project. Never place credentials or private message bodies in those files.

```sh
npm run check:acceptance -- --record /absolute/private/acceptance.json
```

The checker preserves the exact original twenty steps and checks source/final-deployment binding, step ordering, different A/B identities, hashed consent/evidence bytes and expected rejection conditions. Every supplied transaction needs:

- `kind`: `approval`, `business` or `guardian`; full hash/from/to, chain 56, decimal `valueWei`.
- Successful receipt block/hash at or after deployment; no hash or preview request reuse across calls.
- `requestId`, ISO `previewedAt`, `previewExpiresAt`, `consentedAt`, `confirmedAt`; consent after preview, before expiry and before receipt/step completion.
- `previewEvidence`, `consentEvidence`, `receiptEvidence`, `assetDeltaEvidence`, each a contained hashed reference.
- For approval: exact positive `amountRaw`, `spender` equal to the final contract, zero native value, target equal to a listed token.

Rejected claim/over-policy steps must produce zero calls/transactions and retain identical before/after policy digests. This is structural and byte-integrity inspection only. It does not authenticate a person's independence, establish consent provenance, decode/check RPC receipts or prove amount/calldata parity. Even a complete report says `evidence-complete-needs-independent-review`, never production-ready. It does not modify release flags.

## 5. HTTPS Download and Fresh-HOME Startup

```sh
npm run check:install -- --origin https://parley-staging.pages.dev --manifest docs/reports/site-bundle-TIMESTAMP/site/release-manifest.json
```

Use a trusted local manifest, not a manifest fetched from the same untrusted server. Downloads reject redirects, unexpected lengths, oversized bodies and digest mismatches. All four downloaded files must exactly match the trusted local package. ZIP membership must be exactly `SKILL.md` and `parley.mjs`, with identical contents; verified bytes are written directly rather than allowing archive paths to extract.

The verified helper's `--help` runs with an empty temporary HOME and a minimal environment. No wallet command or business operation runs. Temporary files are removed afterward. This proves a same-host isolated download/startup smoke check, not independent-machine installation or registration into a real agent host. Historical deployed manifests are allowed for diagnostics but explicitly marked `currentSourceMatch: false` after source changes.

The configured free origin is now in the local build. The contract and deployment block stay null until an actual final deployment, so the new staging package still cannot construct transactions. A new local package does not update Cloudflare. Its upload and public HTTP checks are a separate operation.

## 6. Manual Resident, Health and Statistics Jobs

```sh
npm run prepare:resident -- --config /absolute/private/config.local.json --build /absolute/build.json --state-dir /absolute/existing/resident/state/56-PREFIX/WALLET --logs /absolute/private/logs
```

Preparation requires final deployment metadata, a real resident handle/wallet, matching full-address state manifest, resident exclusion, explicit private helper HOME, fresh supplied reference prices, budget consistency and exact-divisible public shares. Prices are operator inputs, not an oracle. Review all campaign settings before use.

The generated macOS launchd plists have explicit argv, no shell, restricted umask, deployment/wallet-specific labels and `RunAtLoad=false`:

- Resident one-shot every 60 seconds: read and queue proposals; no preview or approval flags.
- Existing health inspection every 120 seconds: private logs and 0/1/2 exit status.
- Local statistics collection every 300 seconds: confirmed canonical chain data, deployment-specific state, no public upload.

No plist is installed or started. Inspect and initialize private state before deciding to install. The machine must remain available; sleep, logout, RPC failure and stale prices are operational risks. Remote alerts, log retention/rotation, public statistics publication, actual operator staffing and long-running acceptance are not configured by generating these files. Wallet authentication is only needed when a human separately previews/approves a proposal, not for queue/statistics collection.

Outputs are private timestamped `docs/reports/launch-*/` directories; input errors produce blocked reports without raw service output. Never expose those directories through the public static host.
