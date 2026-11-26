# Staging Telegram Alerts

The Telegram watcher reads the existing monitor report approximately once per
hour. The first scheduled run is one hour after timer activation; later runs
are one hour after the previous run finishes, with up to five seconds of
randomized delay. The underlying five-minute monitor is unchanged.

Healthy checks send no message. A detected failure is reported at the next
hourly check. The same failure signature is not repeated until five hours have
elapsed since its last acknowledged notification. A changed failure signature,
recovery, or a new failure after recovery can generate a notification at the
next check without that cooldown. Failures that begin and end between hourly
checks can be missed.

Monitor reports still expire after seven minutes; the hourly notification
schedule must not make stale reports appear healthy. Alerts contain only
bounded issue codes and public chain metadata, not raw reports or credentials.
The watcher does not access wallets or enable business transactions.

```sh
node --test operations/linux/telegram-watch.test.mjs scripts/telegram-storage.test.mjs scripts/telegram-discover.test.mjs
node operations/linux/package-telegram.mjs /absolute/new/bundle-directory
```

The existing installer is for first installation only and intentionally refuses
an installed service. An upgrade must preserve private credentials and delivery
state, verify the old and new public code hashes, back up replaced public files,
and update only the watcher bundle and timer copies. Do not run the fresh
installer against an existing installation.

Building or uploading a package is not proof of deployment. Replacing installed
code and reloading systemd need operator authorization. Timer enable/start and
continuous message delivery need separate explicit authorization. Keep the
timer disabled until those steps are complete.
