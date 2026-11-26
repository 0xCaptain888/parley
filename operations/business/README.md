# Linux Business Runtime

This archive contains self-contained Node 24 jobs, not node_modules, private
configuration, wallet sessions, model keys, Telegram credentials or user mail.
Verify the operator-reviewed archive digest and SHA256SUMS before installation.

```sh
sudo bash install-business.sh --approve-business-runtime-only
```

The first-install-only helper creates root-owned immutable application files
under `/opt/parley-business`. It does not overwrite an existing installation,
create private business state, install dependencies, install/start systemd
units, call a wallet or enable trading.

## Configure After Final Deployment

Use `npm run prepare:resident-linux` with the actual reviewed final build,
explicit private configuration, fresh prices, approved budgets, full resident
address, deployment-specific state manifest and exclusion list. The generated
systemd units must be separately reviewed and installed. Current generated
timers are proposal-only; each transaction still needs its own human preview
and authorization. Statistics remain local until separate publication approval.

The helper HOME contains mailbox encryption keys, not wallet credentials.
Do not copy the wallet home or model credentials into the business service
state. Runtime installation is not Agent end-to-end acceptance.

Generated jobs hide the entire wallet/model home and `/run/user` so the
scheduled proposal worker cannot reach the unlocked wallet Secret Service via
the private bus. Its HOME is the mailbox helper home. This is systemd
filesystem isolation for scheduled jobs, not a whole-host security proof.

## Acceptance And Recovery

Run each job once before enabling timers. Check sanitized runner records for
resident, health and stats. A stale source package, missing final contract,
expired reference prices, inconsistent budgets or mismatched deployment state
must block activation, not be replaced with trial values.

Use `npm run check:operations-soak` on the actual private rotating logs after
24 hours. Fixture logs and a package build do not prove uptime. On failure,
stop affected timers, retain queue/log evidence and reconcile pending wallet
orders before any retry. Do not reset state or replay a financial operation.
