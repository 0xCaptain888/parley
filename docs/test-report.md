# Local Development Acceptance Report

## Current Source: 2026-11-23

Statistics collection now validates canonical hash anchors, rebuilds legacy/deep-reorg caches, rejects mixed-branch or invalid logs before publishing, and serializes concurrent collectors. Twelve new collector regressions and the actual local-chain integration pass; see [collector change and limits](stats-reorg-2026-11-23.md).

The reference contract has intentionally changed to reject token-request net underdelivery; see [change scope](payment-request-fix-2026-11-23.md). The current-source checks pass 67 ordinary contract cases, 2 original envelope tests and 69 root tests. The ordinary run leaves 3 long-fuzz cases disabled; the dedicated run executes all three at 5,000 steps each. Runtime bytecode is 21,941 bytes. Solhint reports 0 errors and 196 retained warnings.

The new `npm run test:flows` suite runs a shared 22-step contract scenario also used by the real-token fork runner. It exercises encrypted messages and key rotation, contact/postage transitions, public/direct packets, request payment/decline/cancel, atomic reverse counteroffers, exact bilateral token deltas, pause exits and final zero escrow/liabilities/allowances. Three local regression cases cover success at minimum declared balances, taxed request underdelivery rollback, and reused-actor rejection. This supplements existing helper integration; it is not official-wallet or real-user acceptance. The real-token invocation passed all 22 checks with 47 local transactions at BSC block 135185365; see `reports/fork-current.json`. Eight additional evidence tests cover stale/tampered/incomplete/failed reports, source drift, and forbidden wallet/mainnet/patched-token flags.

Registry provenance is now reproducible: same-version recompilation matches verified code, a separate public RPC matches deployed runtime at BSC block 135178626, and ten local lifecycle checks pass. The fork script requires a fixed block, BSC source metadata and distinct funded holders, records code hashes and asserts exact token-request balance deltas. Two tests cover invalid inputs; seven cover read-only preflight including wrong-chain/code/identity/balance/reorg/credential cases. An earlier attempt stopped on insufficient USDC; the later real-token local fork at block 135185365 completed. Timestamped reports preserve failed attempts, bind source hashes and recheck the canonical source block. This is not BSC consensus replay or real-wallet acceptance; see [registry review](registry-review-2026-11-23.md).

Current coverage is 100% lines (307/307), statements (240/240) and functions (38/38), and 86.54% branches (270/312). Instrumented coverage runs 66 cases because the real-bytecode-size assertion is intentionally excluded. Local integration passes 51 transaction/error checks; repeat build hashes are identical. The fresh revised-source Slither analysis completes with 45 findings (7 High, 11 Medium, 16 Low, 11 Informational); this is not a clean scan or independent approval.

| Fuzz seed | Steps | Successful operations | Exact token-request payments |
| --- | --- | --- | --- |
| 20261122 | 5,000 | 2,443 | 10 |
| 7331 | 5,000 | 2,554 | 9 |
| 4294967291 | 5,000 | 2,574 | 7 |

Both escrow assets are checked after every step; successful token requests also assert exact payer/payee balance deltas. Current evidence is located through `reports/verification-current.json`, `reports/slither-current.json` and `reports/security-review-current.json`. See [workflow](verification-workflow.md) and [security triage](security-triage-2026-11-23.md). Historical figures below are preserved as dated snapshots, not current-source evidence.

The immutable trial deployment remains unchanged. Four chapter-16 checks (1, 2, 5, 6) have historical trial evidence; the remaining seven are pending. None establishes production acceptance of the revised source.

## Historical Development Snapshot

Date: 2026-11-22, Asia/Shanghai. The final full verification run completed at **19:55:15**.

**Result: P0 and optional P1 development checks passed locally. Production acceptance is blocked.**

No real wallet, production signing key, wallet login/session, mainnet deployment, transfer, publication or outreach was used. Local signers and mocked identities do not establish real Agentic Wallet compatibility.

## Scope

The supplied 78-page Parley v1.0 specification and reference ZIP are the baseline. Chapter-by-chapter and command-by-command coverage is in [requirements.md](requirements.md).

Implemented components are the preserved reference contract plus supplemental tests, single-file helper, Skill distribution, six bilingual read-only website views, event statistics collector, manually approved resident Agent, deployment/verification tools and operating/submission documentation.

Optional P1 includes the storage-only watcher, bounded two-party negotiation and the full English website. P2 random/code packets and external notifications remain outside v1.0 as specified.

## Final Verification

Command actually executed:

```sh
node scripts/verify.mjs /Users/lyh/Downloads/parley-reference.zip
```

Machine-readable result: [verification.json](reports/verification.json).

| Check | Observed result | Evidence |
| --- | --- | --- |
| Root unit tests | 31 passed, 0 failed, 0 skipped | [unit.log](reports/unit.log) |
| Contract tests | 41 passed: 31 original, 7 supplemental, 3 adversarial-returndata | [contracts.log](reports/contracts.log) |
| Original envelope tests | 2 passed | [contracts.log](reports/contracts.log) |
| Long accounting fuzz | 3 seeds, 5,000 steps each; invariants held after every step | [fuzz.log](reports/fuzz.log) |
| Coverage | Statements 100%, functions 100%, lines 100%, branches 84.74% | [coverage.log](reports/coverage.log) |
| Local integration | 51 transaction/error checks; five flows A-E plus P1 and statistics replay | [integration.json](reports/integration.json) |
| Solhint 6.1.0 | 0 errors, 197 retained warnings | [solhint.json](reports/solhint.json) |
| Build | Successful; generated Skill, helper, ZIP, hashes and site assets | [build.log](reports/build.log) |
| Repeat build | Identical Skill SHA-256 manifest | [verification.json](reports/verification.json) |
| ABI/integrity | Compiled contract ABI matches helper; release files match manifest | [verification.json](reports/verification.json) |
| Production gate | Unconfigured mainnet release rejected as intended | [verification.json](reports/verification.json) |
| Reference parity | Contract, envelope module and original test file byte-for-byte unchanged | [verification.json](reports/verification.json) |

The ordinary contract run intentionally leaves the three long-fuzz cases pending; the separate long-fuzz command actually executes and passes them. Coverage excludes the bytecode-size assertion because instrumentation changes bytecode, so it runs 40 passing tests plus the three intentionally separate fuzz cases. The ordinary build verifies the real deployed bytecode is 21,646 bytes, below 24,576.

The local node can produce a transient provider network-detection message while starting; integration waits for readiness, completes successfully and stops its isolated node in `finally`.

## Accounting and Adversarial Tests

| Seed | Steps | Successful operations | Result |
| --- | --- | --- | --- |
| 20261122 | 5,000 | 2,439 | BNB and USDT conserved after every operation |
| 7331 | 5,000 | 2,451 | BNB and USDT conserved after every operation |
| 4294967291 | 5,000 | 2,557 | BNB and USDT conserved after every operation |

The original 400-step BNB invariant also passes unchanged. Invalid randomized operations may revert; each invariant is checked against the resulting state rather than counting a reverted operation as a successful transfer.

Supplemental cases cover TTL endpoints, 500 shares, 280-byte greetings, 1,024-byte ciphertext, reach/quota transitions, cumulative postage with its original timer, no-return tokens, isolated token blacklisting and full event fields. Returndata tests exercise successful and reverting 128 KiB payloads, an out-of-gas 1 MiB push, pending credits and an independent withdrawal. These sampled cases are not a proof against every malicious callback.

## Integration Boundaries

All integration is on an isolated chain with ID **31337**, mocked registry/tokens and local test signers:

- A: claim a public packet and open a mailbox in the same transaction; reject a repeated claim.
- B: encrypted mail, explicit acknowledgement, block/unblock, postage/reply, key rotation and old-mail decryption.
- C: payment request, exact token approval, rerun, separate business call, direct settlement, decline and cancel.
- D: named/public offers, atomic counteroffer and settlement, refunds, local limits and unlisted-token policy.
- E: pause blocks new deposits while exits remain usable; postage reclamation, packet refund and no-pending withdrawal handling.
- P1: a watcher does not acknowledge mail; both parties explicitly establish local bounds; negotiation rejects replay, creates a real local escrow, sends its offer ID separately and settles atomically.
- Statistics: actual local events, 12-block confirmation lag, 64-block replay and deduplication.
- Deployment tools: Standard JSON/constructor export and fresh local deployment checks. Generated files under `docs/verification/` describe local fixtures, **not BscScan verification**.

Receipt checks bind sender, target, original calldata/value, expected event and plan. Approval confirmation is not business-call confirmation. Pending transactions are not recorded as paid. The helper never signs, sends a transaction or reads a `baw` session.

The resident's policy and dry-run behavior are tested locally. Actual official CLI preview, App approval, execution and settlement with a resident wallet remain untested and disabled by default. Only manual per-proposal operation is enabled.

## Website and Distribution

Browser evidence completed at **2026-11-22 19:50:39 Asia/Shanghai**:

- Chrome/Playwright: 26 recorded route/viewport checks, no runtime errors.
- Chinese and English: all six views at 1440x1000 and 390x844.
- No horizontal overflow, clipped Chinese action buttons, broken images, input forms or wallet connector.
- Copy prompts verified in both languages; trusted English UI contains no untranslated Chinese. Untrusted user greetings remain in their original language.
- Real local-chain `/stats` and `/packets` also exercised at both widths; the rest of the interface scenarios are explicitly labelled fictional demonstrations.
- Default restored build shows no deployment or invented production metrics.

Raw evidence: [browser/report.json](reports/browser/report.json), screenshots in `reports/browser/`.

The website's [demo.webm](../web/site/demo.webm) is a **labelled fictional interface video**, not a real-wallet submission video. Actual decoding/playback checks observed 30 seconds, 1280x720, an advancing playback position and 842 distinct sampled colors. Evidence: [browser/video.json](reports/browser/video.json).

After the final build, `unzip -t skill/parley.zip` passed for both entries. The helper was copied into a fresh temporary directory without project `node_modules`; all three actual process checks produced valid JSON and no stderr:

| Invocation | Exit | Result |
| --- | --- | --- |
| `--help` | 0 | `ok: true` |
| `status --from <synthetic address>` | 1 | `NOT_CONFIGURED`, no RPC call |
| Unknown command | 2 | `BAD_INPUT` |

This proves a local standalone bundle smoke test, not installation from a production HTTPS URL on a clean machine. That separate live gate remains pending.

## Static Analysis and Dependencies

Slither 0.11.6 was run against the existing compiled Hardhat artifacts without recompilation or global cache deletion:

```sh
cd contracts
../.venv-audit/bin/slither . --ignore-compile \
  --filter-paths 'node_modules|contracts/mocks' \
  --json ../docs/reports/slither-existing-build.json
```

The analyzer completed with a successful JSON analysis result and a nonzero findings exit status: **44 findings, 102 detectors, 23 compiled contracts**. Severity distribution is **6 high, 11 medium, 16 low and 11 informational**. Raw evidence: [slither-existing-build.json](reports/slither-existing-build.json).

This is **not a clean scan or an audit**. Reentrancy, native payout/returndata, token behavior, time boundaries and bounded-loop findings require independent review. The reference contract was not rewritten to silence them. Preliminary source-based assessments are in [security-review.md](security-review.md); no blanket false-positive designation was applied.

The dependency audit at **2026-11-22 19:38:13 Asia/Shanghai** observed zero runtime advisories and 25 affected contract-development packages: 17 low, 8 moderate, no high/critical. Targeted overrides remove the high-severity development advisories encountered earlier. Remaining development-toolchain findings are disclosed, not waived. Evidence: [dependency-audit.json](reports/dependency-audit.json) and its linked raw npm reports. Dependency scans do not establish smart-contract safety.

## Local Gas Measurements

These are gas units from ordinary local tests, not a mainnet gas quote. Instrumented coverage measurements are not used.

| Call | Gas |
| --- | --- |
| `openMailbox` | 78,294 |
| Public packet, 10 shares | 127,334 |
| Member claims packet | 92,091 |
| Direct packet, 3 recipients | 443,238 |
| First-contact message, 200 bytes | 296,077 |
| Reply, 200 bytes | 311,569 |
| Maximum 1,024-byte message | 843,111 |
| Stamped payment request | 325,031 |
| Pay BNB request | 164,417 |
| Named BNB-to-token offer | 214,077 |
| Public token-to-BNB offer | 157,125 |
| Cancel token offer | 49,355 |
| `allow` | 62,252 |
| Accept offer paying token | 128,394 |
| Direct packet, 50 existing contacts, 280-byte greeting | 5,734,534 |

## Not Accepted for Production

The original snapshot had all eleven chapter 16 checks pending. Subsequent trial evidence in [release-evidence.json](../config/release-evidence.json) records checks 1, 2, 5 and 6 passed for the old trial only, with seven pending. New-contract risk acceptance, actual sender ownership of Agent ID, and payable BNB calls remain hard stop conditions for any new deployment.

Still not performed: independent security sign-off, production mainnet deployment, BscScan verification, two-real-ID 20-step acceptance, public HTTPS Skill installation, resident live-wallet operation, real-wallet video, user interviews, real user acquisition and actual submission. The real-registry/token local fork now passed; the separate authorized trial deployment did occur. Product/domain availability and production guardian, limits and operating budget still require team decisions.

The final default configuration has `contract`, `deploymentBlock`, `site` and `resident` unset, and the statistics file is `null`. `npm run check:release` must continue to fail until actual evidence is recorded. See [release-gates.md](release-gates.md).

## 中文结论

文档要求的 P0 和可选 P1 已有代码及本地验证证据。2026-11-23 本地合约增加净到账校验，原加密模块和 31 个原合约测试未改。真实注册表及代币的本地分叉已通过 22 项检查、47 笔本地业务交易，证据绑定当前源码；这不是官方钱包或完整 BSC 共识验证。旧试验合约已有 4 项实测证据，但不适用于新字节码。不能据此宣称正式上线或已审计；其余实测、独立审计、正式部署与验证、真实用户流程和正式材料仍待完成。
