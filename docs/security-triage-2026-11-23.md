# Current-Source Security Triage

2026-11-23, Asia/Shanghai. Implementation-side analysis, not independent approval. Source SHA256:
`f70dc603e80afe0a72db3968160ab020d5cc0efc82b5e50b51bdbd4f4b201c21`.

## Scan Boundary

The revised contract scan reports 45 findings: 7 High, 11 Medium, 16 Low, 11 Informational. Slither 0.11.6 completed with its findings exit status 255; the runner preserves that exit rather than representing the scan as clean.

Use `reports/slither-current.json` and `reports/security-review-current.json` to locate the final source-bound evidence. The old trial/reference scan had 44 findings. The additional High item is the new request balance-delta check. A detector-count change is not, by itself, evidence that the revision is safer or less safe.

## All Seven High Findings

| Finding | Local call-path review and sampled evidence | Remaining review |
| --- | --- | --- |
| `_takeDeposit` / reentrancy-balance | Called by guarded `createOffer`; actual deposit is measured from before/after balances. Cross-function token callback test rejects new funded actions while preserving actual escrow. | Independently verify every caller and token balance assumptions; dishonest/rebasing balances remain unsupported. |
| `acceptOffer` / reentrancy-balance | Guarded entry; wanted-token net receipt is checked. Recursive token settlement test rejects repeated acceptance and double counting. | Independently review both asset directions, failed transfers, token behavior and balance changes unrelated to the transfer. |
| `payRequest` / reentrancy-balance, new | Guarded entry; request is marked completed before the external transfer, so repeated settlement and cancellation of that same request fail. Underdelivery or decreasing balance causes a full revert. Exact/no-return and callback-token tests pass. | Independently review the new balance observations and all unguarded callback effects. A token can lie about `balanceOf`; the added check is not a general malicious-token defense. |
| `payRequest` / reentrancy-eth | Completion, mail and reciprocal-stamp effects precede payout. `_pay` can add a pending liability after a failed push; `withdraw` is guarded. Native payee cancellation callback and token payment callback tests pass. | Independently inspect cross-function effects and liability conservation, not just modifier presence. |
| `acceptOffer` / reentrancy-eth, maker/taker/final-stamp paths | Escrow status and reciprocal stamp changes precede external payouts. Rejecting makers/takers produce pending credits. Tests check later independent withdrawal and rollback when a later token transfer fails. | Independently review order of every payout and native/token combination. |
| `acceptOffer` / reentrancy-eth, intermediate native/token paths | The separate detector finding covers another payout combination in the same method; it is retained, not deduplicated away. Same global guard and rollback tests apply. | Review separately against the detector's precise locations; do not mark complete merely because a related finding was reviewed. |
| `_inbox` / uninitialized-state | The storage mapping's dynamic arrays begin empty; `_mail` appends entries. Empty/populated/paged reads and full event-field tests exercise its ordinary use. | Independently confirm compiled storage semantics and aliasing assumptions; local explanation is not a sign-off. |

No detector severity was lowered. The machine-readable local summary leaves every `independentSignoff` pending.

## Unguarded Entry Points

- `setPaused` requires the immutable guardian and cannot debit user funds.
- `openMailbox` registers only the caller; registry membership is read through a view interface.
- `setKey`, `setPostage`, `blockHandle` and `unblockHandle` mutate the caller's own mailbox/contact settings. A callback may change these settings; do not claim the entire contract is immutable during external calls.
- `declineRequest` and `cancelRequest` transfer no funds, require the designated party and an open request. The currently paying request has already left the open state. Other independent open requests can still change, so review effects across objects.
- Read-only getters expose state; the guard prevents repeated funded actions, not read-only observation of transient state.

## Other Detector Groups

Medium findings cover exact-divisibility multiplication, zero-sentinel equalities and Solidity default-value locals. Existing boundary tests and local explanations are attached, but no blanket false-positive classification is applied.

Low/informational findings cover timestamps, bounded registry/mail loops, native returndata/calls, delayed non-fund writes and complexity/style. Exact expiry, UTC quota, 72-hour postage, 50-recipient gas, malicious returndata and failed-push tests provide sampled evidence only. Chain timestamp discretion, wallet gas/calldata limits and arbitrary-token liveness remain assumptions.

## Separate Identity Assumption

ID-LIFECYCLE-01 remains pending independent review, but its production applicability is now narrowed. Tests with a synthetic revocable registry show that an already-open mailbox keeps membership after the registry balance becomes zero. Production source was retrieved, locally recompiled and matched to separate public RPC runtime at BSC block 135178626. Its `_update` rejects updates to existing tokens, including transfer/burn; approvals always revert. No public burn/revoke/migration/upgrade path was found in reviewed source and inherited ERC721/Ownable code.

The owner can register new identities, change signer, future length bounds and URI parts, and transfer/renounce ownership. Local tests confirm existing identity survives signer/bounds/URI/owner changes. This is implementation-side analysis, not independent sign-off. Evidence and ten local checks are in `reports/registry-current.json`; see [registry review](registry-review-2026-11-23.md). Cached membership is not continuous qualification, one-person identity, or wallet-key security.

## Release Decision

Local regression success does not close any of the 45 scanner findings or the identity assumption. The independent review must cover the exact source snapshot and compiler inputs. Production configuration and external acceptance gates remain blocked; no reviewer identity or audit completion was invented by the implementation workflow.
