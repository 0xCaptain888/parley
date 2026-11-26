# Statistics Collector Reorg Safety

The collector remains a project-operated, read-only log reader. The website still does not connect a wallet, sign, submit forms or execute transactions.

## Change

The old implementation replayed the last 64 blocks but did not validate the retained history's block hash or protect against simultaneous collectors. A deep reorg could leave stale historical events in the cache; a reorg during scanning could publish mixed branches. On a chain with fewer than 12 blocks, the old fallback also bypassed the intended confirmation delay.

`web/stats/collect.mjs` now:

- Always requires a 12-block delay; an unconfirmed deployment does not overwrite output.
- Persists a hash anchor immediately before the replay tail and validates it before retaining earlier events.
- Rebuilds from deployment when the anchor changed, the head rolled back below saved state, or a legacy cache has no anchor.
- Checks log address, range, removal flag, transaction hash and log index, and matches each log's block hash to its canonical header.
- Rechecks every sampled header before writing state/output. A changed header aborts the run.
- Adds `blockHash` to public stats and saves the target hash and anchor privately.
- Uses the existing exclusive state lock and atomic file helpers; simultaneous runs sharing a state directory cannot overwrite one another.

The replay tail is 65 blocks including the previously saved end block: an anchor at end minus 65 retains events through that anchor, then replays anchor plus one onward. When the deployment is newer, the anchor is clamped to its block.

## Regression Coverage

`web/stats/collect.test.mjs` adds twelve cases covering confirmed ranges and anchors, shallow/deep reorgs, legacy migration, head rollback, mid-run target/log-header changes, invalid logs, adaptive RPC batch size, single-block RPC failure, concurrent runs, wrong chains and invalid/unconfirmed headers.

The client is injectable for deterministic tests; production still creates its normal read-only viem HTTP client. Existing local integration reads actual local-chain logs.

## Limits

These checks depend on the RPC supplying correct canonical headers and complete logs. They do not prove consensus finality or detect an endpoint consistently omitting events. Twelve blocks are a configured delay, not a finality guarantee.

Each output/state file is atomically replaced separately, not as a cross-file transaction. A local filesystem error between writes may leave private cache ahead of public output; the next successful run recomputes output. Failed RPC/header/log validation occurs before either write. A hard process crash may leave the existing lock, which must be reviewed before removal; it is not silently broken.

No Solidity contract, wallet session, production configuration address or public deployment is changed by this collector fix.
