#!/bin/bash
set -euo pipefail
test "$(id -u)" = 0
test "$(uname -m)" = x86_64
test -x /opt/parley-runtime/bin/node
test "$(/opt/parley-runtime/bin/node --version)" = v24.22.3
cd "$(dirname "$0")"
sha256sum --strict -c SHA256SUMS
# Fail closed instead of adopting an existing user, installation or service.
! getent passwd parley >/dev/null
! getent group parley >/dev/null
test ! -e /opt/parley-monitor
test ! -e /var/lib/parley-monitor
test ! -e /etc/systemd/system/parley-monitor.service
test ! -e /etc/systemd/system/parley-monitor.timer
/opt/parley-runtime/bin/node --input-type=module -e \
  "import {verifyBundle} from './monitor.mjs'; verifyBundle(process.cwd()); console.log('BUNDLE_VERIFIED');"
useradd --system --user-group --home-dir /var/lib/parley-monitor --no-create-home --shell /usr/sbin/nologin parley
install -d -o root -g root -m 0755 /opt/parley-monitor /opt/parley-monitor/lib
install -o root -g root -m 0644 monitor.mjs bundle.json release-manifest.json parley-monitor.service parley-monitor.timer /opt/parley-monitor/
install -o root -g root -m 0644 lib/*.mjs /opt/parley-monitor/lib/
install -d -o parley -g parley -m 0700 /var/lib/parley-monitor
install -o root -g root -m 0644 parley-monitor.service parley-monitor.timer /etc/systemd/system/
systemd-analyze verify /etc/systemd/system/parley-monitor.service /etc/systemd/system/parley-monitor.timer
systemctl daemon-reload
printf 'INSTALLED_READ_ONLY_MONITOR; TIMER_NOT_YET_ENABLED\n'
