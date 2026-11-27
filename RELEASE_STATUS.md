# Release Status

Updated 2026-11-27. Formal contract deployment and source verification are
complete. Full production acceptance is not complete.

## Formal BSC Deployment

- Chain ID: `56`.
- Contract: `0x374499188212a01e3614bc58afe7f71f03a3d22e`.
- Transaction: `0xb60d598bcb6882ce64de22afeb8beeb2114ced858beb04a72c7c885280f3c8ed`.
- Deployment block: `135899375`.
- Actual deployment fee: `0.00033493863092976 BNB`.
- Approved deployment fee ceiling: `0.005 BNB`, not an operations budget.
- BscScan publicly displays `Source Code Verified / Exact Match`.
- Compiler: `v0.8.24+commit.e11b9ed9`, optimizer 200 runs, EVM Paris.
- All 108 published ABI entries match the current compiled contract.

The canonical receipt, CREATE2 trace, creation input, immutable runtime and
constructor storage were checked. BscScan web exact-match verification and ABI
readback are recorded separately from a full Standard JSON API readback, which
was not obtained. Do not deploy another instance or replay the deployment.

## Source And Verification

Application source snapshot:
`91c9ee119c4636c911e0fe08b3dead402fc2dcc3137a930fe650100906696c91`.

The source-export manifest binds every reviewed application input and
additional public documentation. Private operation kits, credentials, wallet
sessions, keyrings, real-person consent, interviews and cloud shell/session
details are excluded.

Recorded full local verification passed 200 application tests, 90 operations
tests, 67 contract tests and two envelope tests, plus fuzz, integration, registry,
security boundaries, reproducible build and fail-closed release checks.
These are implementation-side results, not an independent review.

Current-source fixed-block local Hardhat fork passed 22 shared scenarios with
47 local transactions using the real BSC registry and token contracts. The
fork source block was 135845447. This uses locally impersonated accounts and
locally funded native balances; no mainnet transaction was sent, and no real
participant consent or official-wallet compatibility is established.
It is an Ethereum Osaka EVM approximation, not BSC consensus replay.

The original static scanner reported 45 findings: 7 High, 11 Medium, 16 Low
and 11 Informational, plus two separately tracked observations. This is the
historical raw scan, not a current unresolved-findings list or an independent
approval. The existing source-bound review remains separate from these local
tests and from deployment acceptance.

## Current Work

The original source configuration stays unconfigured to preserve its snapshot.
`deployments/bsc-mainnet.json` is a separate configuration overlay. It changes
only the contract, deployment block, resident identity and exclusions.
Build it explicitly with:

```sh
node helper/build.mjs --config deployments/bsc-mainnet.json
```

A formal-contract helper/Skill and 15-file static candidate have been built
without changing reviewed source inputs. Confirmed-block statistics were
collected. Both supplied participant names match their public Agent ID wallets;
both mailboxes remain unopened on this formal deployment.

The cloud wallet passed a read-only connection/settings/address/lock preflight.
The existing cloud business runtime's original build remains unchanged. A separate
formal-contract read-only statistics service and five-minute timer have now been
installed and enabled. An actual scheduled collection completed successfully;
this does not establish that a resident business worker is running.

The formal-contract 15-file candidate is published at the existing Pages origin.
All 24 HTTP artifact/header/route/private-path checks and 12 desktop/mobile
route checks passed. The source repository is now public by explicit owner
authorization; its tracked history and embedded ZIP members were checked for
credential markers before the visibility change. This is a bounded disclosure
check, not a general secret-detection guarantee or another independent audit.

The activation verification passed 321 tests: 13 deployment-profile, 200
application, 90 operations, 6 Telegram delivery-tool and 12 statistics-installer
tests. Labeled simulated-fault and recovery test messages both received
Telegram API acknowledgements. Human receipt confirmation remains separate;
production health and repeated-incident cooldown state were not changed.

## Remaining Live Gates

- Approved resident campaign budgets, mailbox opening, manual business worker
  activation and ongoing public statistics publication. The private collector
  timer does not automatically authorize repeated public uploads.
- Individual official-wallet previews and transaction approvals, followed by
  complete two-user 20-step acceptance with genuine participant evidence.
- Human confirmation of Telegram receipt, assigned incident response and an
  actual uninterrupted 24-hour business observation window.
- Real interviews, growth, genuine wallet video, publication consent and
  final submission.
- Keyring static-service transition and reboot recovery acceptance,
  deliberately deferred until the existing work above is handled.

The deployment configuration does not authorize operating spend, certify user
acceptance or activate a wallet. The public source manifest and historical
reports remain evidence of their recorded snapshots, not current launch status.

The interface video, if present in a staging build, is fictional UI footage,
not the final real-wallet demo. No dummy receipt, local signer, generated user
count or template is a substitute for genuine external acceptance.
