# Token Request Net-Receipt Fix

2026-11-23, Asia/Shanghai. Local development only; no wallet access or external transaction.

## Behavior

`payRequest(uint256)` retains its ABI and exact requested debit. It reads the payee's token balance before/after `safeTransferFrom` and rejects decreasing balances or an increase below the requested amount with existing error `Underpaid`.

A reverted payment does not complete the request, consume allowance, burn transfer-tax tokens, release stamps, change contacts, increment deal counters or append paid mail. The request can still be cancelled. No automatic gross-up, extra authorization or additional debit is introduced. Exact standard and no-return ERC-20 payments remain supported. Arbitrary tokens may lie about balances; rebasing/dishonest tokens are not made safe by this check.

## Regression Cases

- A 5%-tax token rejects a 100-token payment that would deliver 95, both with a zero payee balance and with an existing 200-token balance.
- The rejection rolls back token balances/supply/allowance, request state, completion counters, mail, stamp amount/timer, reciprocal permission and escrow BNB.
- Cancellation remains available after rejection.
- A no-return token delivers exactly 100 on top of an existing 200 balance, consumes the exact allowance and completes once only.
- Existing callback/reentrancy, ordinary payment, pause/exit and event tests remain enabled.

## Source and Deployment Boundary

Reference/trial source SHA256:
`4e905c893b9b424533f5f0bdcdf6d4b7434772ba572b4f2f135daa7ae5ab26e7`

Revised source SHA256:
`f70dc603e80afe0a72db3968160ab020d5cc0efc82b5e50b51bdbd4f4b201c21`

The trial contract `0x50729A09807F0E63cE1dc25CA5C7Bd5877af019d` is immutable and unchanged. Its historical tests, runtime hash, preview approvals and four passed trial gates must not be attributed to this revised contract. No production address has been configured.

The verification workflow now recognizes this exact documented revision through `config/source-baseline.json`, while rejecting unrecorded changes. The envelope and original test must still match their reference hashes. Security reporting requires a new source-bound verification run and fresh Slither output; the old scan cannot certify this revision. See [workflow](verification-workflow.md).

Root tests: 34 passed. Contract tests: 63 passed, 3 long-fuzz cases not enabled. Original envelope tests: 2 passed. Runtime: 21,941 bytes, below the 24,576-byte limit. Solhint: 0 errors, 196 retained warnings. Fresh coverage, long fuzz, Slither and independent review are still required.

These counts describe the first fix run. Subsequent full-run evidence and new adversarial/evidence tests are tracked by `docs/reports/verification-current.json`; do not reuse this earlier count as the latest test result.

The subsequent full current-source run passes 64 ordinary contract tests, 2 envelope tests, 40 root tests and all three 5,000-step fuzz seeds. Coverage is 100% lines/statements/functions and 86.54% branches. A new decreasing-balance token test verifies `Underpaid` rather than an arithmetic panic; the full fuzz suite now includes direct ERC-20 requests and checks both parties' exact balance deltas. Fresh Slither reports 45 findings with independent sign-off pending; see [current triage](security-triage-2026-11-23.md).

Local integration passes 51 transaction/error checks across flows A-E, bounded negotiation and statistics replay. The standalone helper was rebuilt; a second build produced identical checksums. Development ABI/integrity checks pass and the unconfigured production gate still rejects publication.

## Incremental Compilation

The verification exporter now follows the current artifact's `.dbg.json` build-info reference instead of requiring that only one historical compiler record exist. It checks creation/runtime bytecode parity and the current Parley source before exporting. Regression tests cover multiple old records, stale source, mismatched bytecode and out-of-directory references. No compiler cache or historical evidence was deleted.
