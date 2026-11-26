# Production Execution Boundaries

This increment adds executable adapters, not completed production acceptance.
Existing successful bounded OpenClaw inference remains a separate result.

## Cloud Wallet

Actual server observation: official CLI 1.12.0 reports UNCONNECTED. The pinned
keytar 7.10.6 native addon does not load; there is no dedicated user D-Bus socket
in the clean runtime. Public official CLI code contains a file-storage fallback.
No wallet session or credential file was read. No cloud login was started.

`operations/agent/prepare-wallet-storage.sh` requires separate installation
approval. It installs distribution dependencies and runs only the pinned
keytar build as the non-root account, with local Node headers and pre/post hooks
disabled. Only the keytar package is temporarily writable; root ownership is
restored on exit. This is not a vulnerability clearance for deprecated keytar.

Dependency preparation does not create/unlock an encrypted keyring. Continue
with reviewed private user-bus/keyring setup, private operator unlock, and
`wallet-storage.mjs inspect`. The separately authorized synthetic roundtrip
touches only a unique synthetic account, never the actual wallet namespace.
Neither a native-module load nor that roundtrip proves encryption at rest or
disables the official CLI fallback. Resolve both before login; never choose an
empty keyring password, print an unlock secret, migrate a local session or
silently accept file fallback.

Only after storage acceptance and explicit login approval: use the official
fresh QR flow on this cloud host, keep verification alive, and check status,
session expiry, BSC address and Developer Mode through the official CLI.
Do not place QR/session data in the public review archive.

## Telegram

The sender accepts only numeric chat IDs and separate private 0600 token/config
files under a private owned directory. The token is not encrypted at rest; the
service user and root can read it. Private entry needs explicit operator consent.
No token belongs in chat, argv, environment, logs or a deployment archive.

`operations/linux/package-telegram.mjs OUTPUT` creates a standalone staging
monitor addon. The compiled watcher has no dependency on the application
checkout. `install-telegram.sh --approve-install-without-start` installs only
root-owned code and separate units. It does not start a timer or send a message,
and does not replace the existing monitor.

After approved install, privately enter credentials as the existing monitor
account:

```sh
sudo -u parley env -i HOME=/var/lib/parley-monitor PATH=/opt/parley-runtime/bin:/usr/bin:/bin bash /opt/parley-telegram-alerts/enter-telegram.sh --approve-private-storage
```

After confirming the intended private destination, separately approve one test:

```sh
sudo -u parley env -i HOME=/var/lib/parley-monitor PATH=/opt/parley-runtime/bin:/usr/bin:/bin node /opt/parley-telegram-alerts/telegram-cli.mjs test --approve-one-test-message /var/lib/parley-monitor/telegram/telegram.json
```

The sender checks the Telegram JSON acknowledgment, destination and exact
message text. API acknowledgment is not human receipt. Ask the operator to
confirm actual receipt before reporting delivery acceptance.

Separately approve starting `parley-telegram.timer`. The watcher reads only the
existing staging report, alerts on failure/staleness, deduplicates for five
minutes and sends recovery. It transmits allowlisted codes/times, no raw report,
RPC exception, private mail, wallet data or model input. It cannot restart or
repair the monitored service. Failure to deliver leaves the previous success
state untouched; uncertain sends are not retried in the same invocation.

Business health can instead use operations configuration with
`alerts: {enabled:true, provider:"telegram", configFile:"/absolute/private/telegram.json", cooldownSeconds:300}`.
Do not reuse credentials across different Unix owners by loosening permissions.

## Linux Business Jobs

`prepare:resident-linux` validates the same deployment binding, approved manual
mode, fresh prices, budgets and exclusions as the existing resident planner.
It emits three oneshot services and three completion-relative timers. No unit
is installed or started by generating the plan. It cannot run while the final
contract, block, operator budget, binding or prices remain missing.

Code stays under `/opt/parley-business`; queue/helper/statistics/log data lives
under `/var/lib/parley-business`. Units use `parley-agent`, strict filesystem
protection, bounded resources and no write access to the code tree. The model
configuration/key directory is inaccessible. Scheduled work generates proposals,
checks health and collects local statistics only. There is no wallet CLI or
model call in a scheduled job, no automatic signing and no public statistics
upload. Every business proposal still needs its own fresh preview and human
approval through the existing manual workflow.

## Contracts And Two Participants

Keep the six undecided deployment amounts null: default/max postage, BNB/USDT/
USDC object caps, and deployment gas budget. Minimum packet share remains the
user-selected 0.0001 BNB. Do not infer funding authorization from a development
request. A new source snapshot requires refreshed independent review evidence.
No audit, deployment receipt, verified source, consent or real-user result may
be synthesized from tests.

The recorded btc123456.ai and captain888.ai registry observations can seed
candidate identities, not completed steps. Keep all twenty acceptance steps
pending until the final deployment and actual per-step evidence exist. The
second participant must operate their own session and separately consent to
their calls and any publication.
