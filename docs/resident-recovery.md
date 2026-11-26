# Resident Inspection and Recovery

These commands do not start a resident, contact a wallet, sign, send, cancel, retry, migrate, rewind state or enable scheduling. They print JSON. RPC access occurs only with an explicit `--rpc`. Do not publish private resident state or raw helper output.

## Health

```sh
npm run resident:health -- --state-dir /absolute/resident/deployment/wallet --config /absolute/config.local.json
```

The build defaults to `config/build.json`; override with `--build /absolute/build.json`. The state directory must already exist and its `deployment.json` must exactly match chain, full contract address and resident wallet. The checker never creates a missing state directory. `--stats /absolute/stats.json` selects a private/local copy of the public statistics document.

Exit codes: 0 healthy, 1 warnings, 2 critical/inspection failure. Code 2 is not proof of financial loss. Output contains fixed diagnostic codes, timestamps/counts/budget totals, no messages, calldata, wallet credentials or RPC URLs. Use the process supervisor's existing log/alert facilities to route codes after separately approving actual operations.

Checks include completed-tick/inbox/claim freshness (180 seconds), unknown and overdue broadcasts (600 seconds), response queue age, risk-blocked entries, deferred inputs, reference-price age/validity, native-value reservations, today's packet, recorded board status and statistics age (20 minutes)/deployment/exclusions. Reserved native values are not gas or token budget estimates. No official-wallet settings are observed.

An optional explicit RPC enables canonical, 12-block-delayed campaign reads:

```sh
npm run resident:health -- --state-dir /absolute/state --config /absolute/config.local.json --rpc https://PUBLIC-RPC-ORIGIN
```

It checks actual packet/offer ownership, expiry and packet remaining value, plus a 24-hour renewal warning. This is chain-time status at one confirmed block, not an uptime promise. An unrecorded public packet ID warns; it is not guessed from logs. Confirmed public creation now records `publicPacketId`.

Every normal queue tick saves fresh heartbeat times only after durable queue processing and successful inbox acknowledgement. Polls are sequential, with 60 seconds between completed polls; long RPC work cannot pile up timer-triggered ticks. A failed tick is not a fresh successful heartbeat.

## Unknown Transactions

```sh
npm run resident:recover -- --state-dir /absolute/state --config /absolute/config.local.json
```

This produces a state-SHA256-bound inventory of unresolved entries and retained reservations. Without a hash, inspect the official wallet order through its supported interface. Never read a wallet session/Keychain/private key and never infer “not sent” from a timeout, empty RPC result or missing receipt.

With the transaction hash obtained by the operator:

```sh
npm run resident:recover -- --state-dir /absolute/state --config /absolute/config.local.json --queue QUEUE_ID --tx 0xFULL_HASH --rpc https://PUBLIC-RPC-ORIGIN
```

The tool compares chain ID, transaction/receipt hash, sender, exact target/calldata/value, canonical block and 12-confirmation delay. It rechecks the block before recommending the existing `resident --settle ...` arguments. It does not apply effects or accept mismatched business events; the existing helper settlement still validates events against the saved plan. Both successful and reverted receipts require that settlement. Missing/young receipts retain budget and prohibit resending.

A separate `recover --rpc ...` without `--queue/--tx` inspects the claim cursor anchor. On reorganization it reports canonical and saved hashes, a proposed full replay start and all claim-related queue IDs needing review. It never rewinds automatically or makes confirmed/unknown gifts eligible to send again.

## Legacy Migration

```sh
npm run resident:migration-plan -- --state-dir /absolute/legacy-state --binding /absolute/reviewed-deployment.json --target-dir /absolute/unused-target --config /absolute/config.local.json
```

Legacy state without a manifest requires independent operator evidence establishing which deployment it belongs to. `--binding` supplies that declaration but does not prove its provenance. The source binding must equal the configured target chain/full contract/wallet; cross-deployment migration and an already-existing target are rejected.

The output records the source SHA256, queue count, committed native value, deferred input count and claim cursor. Stop workers, reconcile orders, back up and verify the exact source bytes, preserve every field, write the matching deployment manifest, and recheck the destination. Keep the source backup outside the active legacy location. No command here copies, removes, unlocks or overwrites anything. Without sound provenance, leave the legacy directory untouched and blocked.

## Deployment Verification

`export-verification.mjs <deployment.json>` validates constructor bounds/caps, derives the full expected runtime including all compiler immutable references, and exports standard input plus creation/runtime hashes and a source/compiler binding. It does not approve parameters or upload a verification.

`post-deploy.mjs <deployment.json>` now checks full runtime and constructor getters at the canonical deployment block. If the record contains `transactionHash`, it also requires `deployer` and checks exact direct-creation input, sender, zero value, receipt status/address/block. Mainnet requires 12 blocks; isolated chain 31337 can test immediately.

For BSC 56 it separately compares chain, registry and the ordered native/USDT/USDC cap-token list against `config/build.json`; when that config names a final contract/block, those must match too. It does not approve the guardian or monetary limits on behalf of the operator.

Old records without a transaction hash are explicitly runtime/storage-only, not creation-transaction proof. Factory deployment transactions are not accepted as direct creation: obtain independently verified internal-create evidence through a separately reviewed process. A passing result never sets BscScan, wallet or release flags. Reports exclude raw RPC errors.

## Test Limits

Unit tests use synthetic clients and real private temporary files/locks. Integration adds eight checks on actual local contracts: mailbox/claim queue generation, restart/replay, canonical claim validation, an actual local snapshot reorganization, response loss after a mined local transaction, no resend, exact-call recovery and idempotent event settlement.

All identities, preview and transport failure in that integration are fixtures. No official wallet, App confirmation or real user participated. A point-in-time local/chain read is not a running monitoring service.
