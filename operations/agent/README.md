# Isolated Linux Agent Host

This adapter installs an actual OpenClaw host, not the existing read-only monitor.
It has its own review scope; the previous application snapshot does not cover it.

## Boundaries

- Pinned OpenClaw 2026.11.10 and Binance Agentic Wallet CLI 1.12.0.
- npm lockfile v3, registry-only dependencies and integrity checks. Dependency
  lifecycle scripts remain disabled. OpenClaw's own two installation lifecycle
  entrypoints need a separate, narrowly scoped operator approval.
- Dedicated non-login `parley-agent` account, private home, root-owned software.
- Parley Skill downloaded from the public site and checked against the locally
  trusted publication manifest, not a freshly downloaded checksum.
- Wallet Skill contains public instructions/references only. No credentials.
- No model key, paid inference, daemon, gateway, public port, wallet login,
  transfer, approval, signature, or automatic trading is configured by bootstrap.
- The original `--ignore-scripts --omit=optional` bootstrap stages dependencies
  but does not complete OpenClaw's own lifecycle. The launcher would otherwise
  replay it at startup. The installer now stops before that startup.
- After explicit approval, `repair-lifecycle.sh` reinstalls locked dependencies
  with platform-compatible optional packages but still with `--ignore-scripts`.
  It allows only OpenClaw's own preinstall/postinstall through the official
  launcher's completion mechanism, as the non-root account. Code ownership is
  restored even on failure. It does not remove the pending marker manually or
  disable any native safety mechanism.

## Install

Review source, lockfile, bundle manifest and archive digest. Upload through the
authorized Workbench file chooser. Obtain action-time installation approval.
Verify the uploaded archive digest before extraction, then invoke:

```sh
sudo bash /path/to/reviewed/agent/install.sh
```

Requires the previously installed `/opt/parley-runtime/bin/node`, sudo, curl and
a Linux x86_64 server. Fails without overwriting an existing account or install.
If an interrupted installation leaves state, inspect it before resuming.

The initial staging exits 78 to request the first-party lifecycle decision.
After explaining and receiving approval for reinstalling the public software
and running the two OpenClaw-owned lifecycle entrypoints:

```sh
sudo bash /path/to/reviewed/agent/repair-lifecycle.sh --approve-openclaw-only-lifecycle
```

This is not permission to run all npm hooks. It temporarily grants the dedicated
account ownership of its software directory, restores root ownership, then runs
baseline setup and the actual acceptance script. No model or wallet is enabled.

## Acceptance Layers

1. Runtime: pinned versions, non-root identity, startup and clean exit.
2. Registration: OpenClaw's own `skills info parley --json`,
   `skills info binance-agentic-wallet --json`, and `skills check --json`.
3. Execution: helper `--help`; staging command must refuse NOT_CONFIGURED.
4. Isolation: root-owned code, private state, no new network listeners,
   existing monitor remains healthy.
5. Inference: requires an explicitly selected and authenticated provider.
6. Wallet/business: requires a fresh cloud-host login, finalized contract,
   per-transaction authorization and real participants.

Passing layers 1-4 is a host/Skill bootstrap result, not proof of layers 5-6.
Do not mark full Agent operation or a real-wallet acceptance complete merely
because a package installed or a Skill appears in inventory.

## Operations

Invoke OpenClaw as the dedicated account:

```sh
sudo /opt/parley-agent-host/bin/parley-agent --version
sudo /opt/parley-agent-host/bin/parley-agent skills check --json
```

Nothing starts at boot in this bootstrap. No changes are made to the monitor,
firewall, DNS, existing wallet sessions or other accounts. Before enabling
a resident gateway, review tool access, loopback binding, authentication,
provider billing limits, secret storage and service confinement separately.

The user-selected third-party relay has a separate prepared adapter and approval
workflow in [RELAY.md](RELAY.md). It is not configured by host bootstrap, does not
reuse official OpenAI credentials, and requires its own actual-host acceptance.

After direct relay acceptance, [ONESHOT.md](ONESHOT.md) provides a separate
tool-denied OpenClaw inference check. It first runs the actual runtime against
a local mock; a separately authorized live run permits at most one synthetic
inference request and preserves a replay-blocking receipt. This does not enable
a resident Agent or establish wallet/business acceptance.
