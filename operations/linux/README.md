# Linux Read-Only Staging Monitor

This separately versioned host adapter does not change the application snapshot.
It is not covered by the earlier contract/application verification or a completed
independent security review. Its bundle manifest binds the adapter and the exact
existing HTTP verification modules and public staging manifest.

## Scope

- Every five minutes: 24 public HTTP artifact/header/route/privacy checks.
- Three fixed public BSC RPC endpoints: chain ID, block number, exact block and
  timestamp. Require two healthy endpoints, age <=180 seconds and head spread <=100.
- No wallet, credentials, signing, transactions, inbound HTTP server, public
  statistics upload, Cloudflare mutation, firewall changes or alert destination.
- Final deployment, business resident, stats publication and webhook setup remain
  explicit blockers even when read-only checks pass.

## Build And Test

```sh
node --test operations/linux/monitor.test.mjs
node operations/linux/package.mjs /absolute/new/bundle-directory
```

Runtime: official pinned Node.js v24.22.3 linux-x64 tar.xz, SHA-256:
`4f2b175a6d53a5c617a80dba2676238a0688cef28c6da4eba35c7d844e66fcfb`.
Install under `/opt/parley-runtime`, root-owned. No npm dependencies are needed.
Transfer only the monitor bundle to the approved server, verify the complete
archive digest from the trusted local build before extracting, then run
`sudo bash install.sh` from its directory. The installer refuses existing user,
group, code, state or units rather than silently overwriting them.

The installer creates `parley` with `/usr/sbin/nologin`, installs immutable code
and units, and leaves the timer disabled. Start the service manually, inspect its
result and only then enable the timer:

```sh
sudo systemctl start parley-monitor.service
sudo systemctl status parley-monitor.service --no-pager
sudo journalctl -u parley-monitor.service -n 10 --no-pager
sudo systemctl enable --now parley-monitor.timer
sudo systemctl list-timers parley-monitor.timer --no-pager
```

Oneshot service `inactive (dead)` after a successful run is normal. Use
`ExecMainStatus=0`, the most recent report timestamp, and the active timer as
evidence. Timer scheduling alone does not prove a successful check.

## Logs And Recovery

`/var/lib/parley-monitor/` is service-owned 0700. `latest.json` is atomically
replaced, 0600. `checks.jsonl` rotates at 256KiB with seven old generations.
No raw transport error strings are persisted. Minimal journal summaries are
rate-limited. The service has no access to home directories and cannot modify
its executable files. Resource limits: 256MiB, 25% CPU, 32 tasks, 210s per run.

For a failed check, inspect `latest.json` and the endpoint/path status.
Do not disable integrity checks to turn the status green. A legitimate site
release needs a new locally trusted manifest and a separately reviewed bundle.

After a kill, timeout or power interruption, a stale `run.lock` or
`latest.pending` may intentionally block further runs. First stop the timer and
service, verify no monitor process is active, inspect the private state, then
remove only those two transient files and restart. Never remove a live lock.
This recovery requires explicit operator action; failure is not silently ignored.

Stop without deleting evidence:

```sh
sudo systemctl disable --now parley-monitor.timer
sudo systemctl stop parley-monitor.service
```

No claim of 24-hour stability, independent review, final contract readiness or
real-user acceptance follows from installation or a handful of checks.
