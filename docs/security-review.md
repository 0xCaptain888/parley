# Security Review Notes

## Current Source Amendment: 2026-11-23

Local `payRequest` now checks the payee's balance delta and reverts with `Underpaid` if less than the request amount arrives, including a decreasing reported balance. Tests cover zero/existing payee balances, rollback of balances, allowance, burn, stamps, contacts, mail and completion counters, cancellation after rejection, and exact no-return-token settlement. ABI is unchanged. This does not make dishonest/rebasing token balances trustworthy.

TOKEN-REQUEST-01 is fixed in local source only, not in the immutable 2026-11-22 trial. All static findings and assessments in the historical section below describe the earlier source; do not reuse the earlier 44-finding count as a current scan. The updated workflow requires passed full verification and a fresh scan bound to the same source/compiler hashes before producing a new local summary. Independent review remains pending. See [verification workflow](verification-workflow.md).

See [change and regression scope](payment-request-fix-2026-11-23.md). ID-LIFECYCLE-01 remains unresolved pending verification of the real registry lifecycle.

The fresh revised-source scan has 45 findings: 7 High, 11 Medium, 16 Low and 11 Informational. All seven High findings and the unguarded entry points are discussed in [current triage](security-triage-2026-11-23.md). The new High item is `payRequest`'s balance-delta check; it is retained with independent sign-off pending. Machine-readable current evidence is located via `reports/slither-current.json` and `reports/security-review-current.json`.

## Historical Reference Review

2026-11-22. **Not an audit; independent review pending.** The supplied `Parley.sol` has not been rewritten to silence static-analysis warnings.

## Slither

Slither 0.11.6 was actually run against the existing Hardhat build with `--ignore-compile`, filtering dependency/mocks paths. Final raw evidence is `reports/slither-existing-build.json`. Analysis completed without a global compiler-cache clean; the findings produce a nonzero exit status: **44 findings across 102 detectors / 23 compiled contracts**, comprising **6 high, 11 medium, 16 low and 11 informational**. This is not a clean bill of health. Earlier raw scans are retained for provenance, not counted as additional findings.

| Detector group | Initial source-based assessment | Required follow-up |
| --- | --- | --- |
| reentrancy-balance | Balance-before/after is used deliberately to measure fee-on-transfer receipts; createOffer and acceptOffer enter nonReentrant. Arbitrary token balance behavior can still be dishonest. | Independently review cross-function effects; keep unlisted tokens denied by default. |
| reentrancy-eth / benign | Payout helpers can credit pending after a failed call; fund-moving entry points are guarded and object state changes precede payout. Some mail/counter writes happen later. | Review the complete call graph and unguarded non-fund functions, not just modifier names. |
| uninitialized-state / local | Solidity mappings and local scalars have defined zero defaults. `_inbox` is a storage mapping populated by `_mail`. | Confirm AST findings against compiled semantics. |
| divide-before-multiply | The multiplication checks exact divisibility of the gift total; it is not an intended rounded payout. | Retain wei divisibility and 500-share boundary tests. |
| incorrect-equality / timestamp | Zero sentinel checks, balance positivity, UTC day buckets and expiry/72-hour gates are intended. | Verify time-edge behavior and disclose chain timestamp assumptions. |
| calls-loop / costly-loop | Up to 50 named recipients perform immutable-registry lookups and mailbox writes. | 50-contact gas test passes locally; verify wallet/RPC limits in production. |
| return-bomb / low-level-calls | `_pay` caps forwarded gas; withdraw is pull-based. Three additional tests exercise successful/reverting 128 KiB returndata and an out-of-gas 1 MiB push, preserving payout/pending accounting. | Independent bytecode/call-graph review remains required; sampled adversarial cases do not prove all return-data behavior safe. |
| complexity / naming | Large domain methods and upper-case immutables follow the reference design. | Style findings do not establish a funds exploit, but keep them visible. |

No blanket false-positive suppression or automatic finding removal was applied. High-severity findings require explicit reviewer sign-off in the release evidence.

## Solhint

Fixed version 6.1.0, recommended rules, explicit Solidity 0.8.24 and function visibility. Constructors are excluded from the visibility rule because Solidity 0.8 constructors have no public/external modifier. The check runs from the actual contract project so dependency import paths resolve. Raw output: `reports/solhint.json`. NatSpec/style/gas suggestions are retained, not silently “fixed” by changing the contract ABI.

## Manual Review Checklist

- Fund-moving paths have nonReentrant: allow, sendMessage, reclaimStamp, create/claim/refundPacket, request/payRequest, create/accept/decline/cancelOffer, withdraw.
- Decline/cancelRequest alter status/mail but transfer no funds.
- Claims, refunds, declines, cancellations, stamp reclamation and withdraw do not have whenNotPaused.
- GUARDIAN is immutable and authorizes only setPaused; it cannot withdraw, upgrade or change caps.
- All counterparties are handles, except raw addresses in read-only storage getters/administrative constructor parameters.
- `_pay` is the only native push helper; withdraw is the explicit pull path.
- An external token/registry revert rolls back on-chain effects. Logs and storage are not irreversible side effects.
- Arbitrary tokens can be malicious. A blacklist may trap a specific offer’s asset without blocking unrelated offers; rebase behavior is unsupported.
- Scope extensions in the helper are conservative: exact original-transaction/receipt matching, plan IDs, staged keys, a 20% gas estimate buffer, state locks, symlink rejection and reproducible packaging.
- P1 negotiation only consumes strict encrypted quotes from the configured peer/thread. Local boundaries are fixed by the user, integer concessions are bounded, stale sequences fail, and actual on-chain offers are checked independently. Every step still requires separate official preview and consent. Watching mail does not acknowledge or execute it.

## Dependency Review

The root project / shipped viem runtime audit reports no known npm advisories at the recorded check time. The separate contract development toolchain reports **25 affected packages: 17 low and 8 moderate, no high or critical**. Raw evidence is `reports/npm-audit-runtime.json`, `reports/npm-audit-contracts-dev.json` and `reports/dependency-audit.json`.

Two targeted overrides, `tmp` 0.2.7 and `serialize-javascript` 7.1.3, remove the high-severity development-dependency advisories encountered during implementation. Coverage and normal tests were rerun against the resulting lockfile. Remaining findings propagate through the pinned Hardhat 2 / coverage / ethers 5 development toolchain (including glob/minimatch, bn.js, diff and elliptic); a forced Hardhat major migration was not applied to the supplied reference setup.

This toolchain is used only on trusted local test inputs, not exposed as a service and not shipped in the Skill bundle. That reduces exposure but does not waive the need to review and update it before production build/deployment. No deployment key was used during development. An npm advisory scan is not a Solidity audit, and absence of high npm findings does not resolve Slither findings.

These notes are an implementation review, not independent approval. Real-wallet and real-registry/token fork gates remain pending.

## 中文要点

静态分析确实执行了，也确实有告警。原始文件保留在 reports 中，不能把上述初步判断写成“已审计”“全部误报”或“无漏洞”。正式发布前应由独立评审者核对每一组告警、重入回调、返回数据、代币异常和 11 项钱包实测。
