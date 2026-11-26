# Development and Acceptance Matrix

Source: Parley v1.0, 78 pages, supplied 2026-11-22. The reference ZIP is the contract baseline.
Statuses are evidence-based. A local test is not a mainnet/wallet test.

2026-11-23 amendment: the contract intentionally differs from the reference only for recorded TOKEN-REQUEST-01 net-receipt validation. See `config/source-baseline.json` and [current verification workflow](verification-workflow.md). Original envelope and original contract tests remain byte-for-byte unchanged. Four external checks passed on the old immutable trial; none grants production acceptance of this revision.

| Spec | Requirement | Implementation | Acceptance |
| --- | --- | --- | --- |
| 1-3 | Name addressing, ID gating, no web wallet, confirmation | contracts; helper; Skill; read-only site | E2E A-E; static safety check |
| 4 | Registry ABI; strip `.ai`; RPC failover; storage reads | helper/src/chain.mjs, normalize.mjs | unit and E2E |
| 5 | Preserve caps, guardian and exits; explicit net-receipt amendment | contracts/contracts/Parley.sol | original + supplemental + security tests; recorded source delta |
| 6 | X25519 envelope, strict schemas, local keys, rotation | helper/src/envelope.mjs, payload.mjs, keys.mjs | crypto/schema/rotation tests |
| 7 | All P0 CLI commands; policies; receipts; exact approval | helper/src/cli.mjs, app.mjs | unit + local chain integration |
| 7 P1 | watch, bounded negotiation | watch.mjs; negotiation.mjs; app.mjs | bound/replay tests and two-user local integration |
| 8 / D | Official wallet confirmation; untrusted data | skill/SKILL.md | release safety checks |
| 9 | Six bilingual read-only views, polling, copies, privacy, risk | web/site | Chinese/English desktop/mobile browser checks |
| 9.2-3 | Events, deduped actions, exclusions, retention/pairs | web/stats | synthetic event + reorg/rollback/concurrency tests; local chain |
| 10 | Resident policies, budgets, risk stop, operator approval | resident | disk crash/restart, replay, lock, canonical claim, read-only health/recovery + actual local-chain fault scenario; real wallet pending |
| 11 | Boundaries, reach, events, nonstandard tokens, fuzz | contracts/test | local tests; fork is release gate |
| 12 | Deployment records, verification inputs, post-checks | scripts + contracts/scripts | local deployment; mainnet blocked |
| 13 | Honest activity, team exclusion, daily checklist | docs/operations.md | operator responsibility |
| 14 / F-G | Bilingual submission, threat model, redline audit | docs | actual fields/links remain gates |
| 14 / H | Demo, onboarding, sharing text | docs; scripts; site | local preview; real-wallet video pending |
| 15 | P0 before P1; no hidden scope cuts | this matrix | verification report |
| 16 | Eleven real-world checks | docs/release-gates.md | 4 passed on old trial only, 7 pending; revised production launch blocked |
| 17 | Name/domain/guardian/parameters/operator/budget | config; docs/release-gates.md | team decision required |
| A-C / E | Baseline contract/deploy/envelope/selectors | contracts; ABI; generated release | compile and ABI parity |
| P2 | Random/code packets and external notifications | intentionally outside v1.0 | deferred by source specification |

No production address is invented. A build without a deployment stays explicitly unconfigured.
No private keys, wallet sessions, production signatures, payments, publishing, or outreach are requested or performed by local development.

## P0 Command Coverage

Every entry is implemented in `helper/src/app.mjs` and available in the bundled helper.

| Commands | Implementation / Local Evidence |
| --- | --- |
| status / open | `app.mjs`, chain verification, private key-file setup; integration A |
| key rotate | `keys.mjs`, staged on-chain activation, old key retention; integration B and key unit tests |
| result | `result.mjs`, sender/target/original calldata/value/event matching, exact plan, pending/reverted/confirmed; transaction unit tests and all integration actions |
| packet create public/direct | integer/divisibility/cap/share/TTL/quota/memo checks; integration A/B |
| packet claim | order-matched errors and optional openMailbox; integration A/E |
| packet refund / show / list --mine | refreshed storage plus private local object IDs; integration A/E |
| inbox / read / ack | storage only, cursor unchanged until explicit ack, keys and strict schemas; integration B |
| send | reach/postage/quota/local limits, encrypted envelope, untrusted quotation; integration B |
| request create/pay/decline/cancel/list --mine | direct settlement, exact approve/rerun, private memo; integration C |
| offer create/accept/decline/cancel/counter/show/board | escrow, reverse counteroffer, exact approval, fees warning, public scan 200; integration D |
| contact allow/block/unblock | helper precheck plus simulated named contract entry; integration B/E |
| postage set / stamp reclaim | zero and upper bounds, first-stamp 72-hour rule; integration E and supplemental contract tests |
| withdraw | pending check; no-pending helper test; actual failed-push/pull path in contract tests |
| policy show/set | strict allowed keys, rolling 24 hours + 10-minute reservations; unit tests and integration C/D |
| --from/--rpc/--home/--lang | sender required, explicit RPC override, isolated local state, English notices/errors; unit tests |
| watch (P1) | storage-only JSONL polling, ephemeral cursor, explicit ack unchanged; local integration |
| deal start/next (P1) | local sell floor/buy ceiling, integer concessions, bounded rounds, strict peer/thread/offer checks; unit + local integration |

Extra safety compared with the reference draft: plan IDs; original transaction lookup to bind receipts exactly; serialized state access; symlink rejection; staged key activation; exact pending-ciphertext reuse; a conservative 20% gas-estimate buffer. These add no signing authority or address-based counterparty entry point.

## Chapters and Appendices

| Source | Evidence / Explicit Pending Item |
| --- | --- |
| 0 | Scope, source provenance and verified/unverified distinction: README and test-report |
| 1 | Five flows A-E in scripts/integration.mjs |
| 2 | Hard boundaries in Skill and docs/compliance.md |
| 3 | Component ownership follows contracts/helper/skill/web/resident/docs |
| 4 | Public chain config; registry normalization; fallback RPC; no log dependence in user helper |
| 5 | Reference-based Parley.sol with documented net-receipt fix; supplemental/security tests and multi-seed long fuzz |
| 6 | Envelope retained; strict payload/key lifecycle/unit tests |
| 7 | P0 matrix above; JSON stdout, exits 0/1/2, local policy and build/checksums |
| 8 | Draft Skill tightened for unsimulated calls and exact plan recovery |
| 9 | All six routes; read-only DOM; static host files; collector/replay/metric tests |
| 10 | Rules and durable manual queue; own-packet claim reader; operator preview/approve/settle |
| 11 | Unit, contract, long fuzz, local integration and browser evidence; real-registry/token local fork passed; mainnet E2E pending |
| 12 | External-deployment guard, export-verification and post-deploy tools; old trial exists, no production deployment |
| 13 | Operations goals/checklists; no outreach, scheduler, artificial users or activity |
| 14 | Bilingual submission, permissions, compliance, threat model and demo script; final evidence links pending |
| 15 | P0 implementation first; optional P1 completed afterward, gates remain explicit |
| 16 | Old trial has 4 passed checks; 7 pending; no acceptance of revised production bytecode |
| 17 | Name/domain/guardian/parameters/operator/budget/team decisions in release-gates.md |
| A | Original and revised Parley.sol hashes recorded explicitly; unrecorded changes fail validation |
| B | Supplied deployment script with explicit external-network authorization guard and chainId output |
| C | Same envelope module in helper and contracts; reference tests retained |
| D | Skill draft reused, generated distribution adds deployment status and safety/recovery rules |
| E | Compiled ABI parity check; selector/topic table can be regenerated from ABI, no manual selector encoding |
| F | docs/submission.md bilingual templates; real metrics deliberately left blank |
| G | docs/compliance.md evidence matrix, without claiming BscScan or official certification |
| H | Website onboarding, result share text, resident greeting, local video and bilingual demo script |
| I | Source links retained in original PDF; external current facts are not assumed reverified by local tests |

## Scope Boundaries

The source marks `watch`, multi-round `deal start/next`, and the full English website P1. These are now implemented in addition to P0. See `docs/p1.md` for the explicit command interface and conservative per-call confirmation rules. The resident uses the permitted semi-automatic fallback. Random/code packets and external notification systems are P2 and intentionally absent.

The original 20-step mainnet acceptance, independent review, true-wallet demo and production deployment/verification/HTTPS release are **not done**. The old trial's partial live checks do not apply to the revised deployment. Test scaffolding, operator procedures and evidence fields exist; no local result is substituted for external acceptance.
