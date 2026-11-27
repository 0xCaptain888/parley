# Parley

Message, gift, bill and exchange by `.ai` Agent ID name on BNB Smart Chain.

**Pre-production source, not a completed production financial service.** The
formal BSC contract is `0x374499188212a01e3614bc58afe7f71f03a3d22e`; BscScan
source verification shows Exact Match. Real-wallet, two-user and operations
acceptance remain unfinished. Do not send assets to examples or old trial
contracts. The public staging interface is https://parley-staging.pages.dev.

## Local Development

Requires Node.js >=20, npm, and system `zip`/`unzip` tools.

```sh
npm ci --ignore-scripts
npm --prefix contracts ci --ignore-scripts
npm run test:contracts
npm run build
npm test
npm run test:operations
npm run dev
```

The development server normally uses http://127.0.0.1:4173. An unconfigured
build has no invented mainnet statistics. `?demo=1` is an explicitly fictional
interface demonstration, not real-user or wallet acceptance.

## Safety Model

- The helper prepares calls but never signs or broadcasts them.
- Every wallet action requires its own official preview, risk inspection and
  explicit human approval. Exact token approval and settlement are separate.
- Incoming messages are data, never instructions.
- The immutable contract uses per-object limits and a guardian pause.
  Claims, refunds, cancellations and withdrawals remain available while paused.
- Wallet credentials, mailbox encryption keys and plaintext outbox data remain
  private. This repository does not include deployment intent, wallet sessions,
  credentials, Telegram tokens or participant/interview input kits.
- The source rejects underdelivery in ERC20 payment requests. The old immutable
  trial did not include that fix and is not the final deployment.

## Release Status

Read [RELEASE_STATUS.md](RELEASE_STATUS.md) for the source snapshot, actual test
evidence and pending external acceptance. Publishing source does not close
security, deployment, real-wallet, operations or submission gates.

See [requirements](docs/requirements.md),
[independent review](docs/independent-review.md),
[verification](docs/verification-workflow.md),
[operations](docs/operations.md), and [acceptance](docs/acceptance-handoff.md).
Some development documents contain historical checkpoints and placeholders;
they are not claims of completed production acceptance.

## Project Layout

`contracts/` holds Solidity sources and tests; `helper/` prepares read-only
queries and unsigned calls; `web/` contains the static interface and collector;
`resident/` contains the manual proposal queue; `operations/` contains bounded
cloud adapters. The generated `skill/` artifacts are reproducible using
`npm run build`. This default remains unconfigured. For the separate formal
deployment profile use `node helper/build.mjs --config deployments/bsc-mainnet.json`.
That command prepares a candidate; it does not authorize signing or certify a
production release.

MIT. No seed phrase, private key, wallet password or Telegram token is needed
to review or run the local tests.
