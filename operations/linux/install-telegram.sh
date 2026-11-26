#!/bin/bash
set -euo pipefail
test "${1:-}" = --approve-install-without-start
test "$#" = 1
test "$(id -u)" = 0
test "$(uname -m)" = x86_64
test -x /opt/parley-runtime/bin/node
test -d /var/lib/parley-monitor
test "$(stat -c '%U:%a' /var/lib/parley-monitor)" = parley:700
cd "$(dirname "$0")"
sha256sum --strict -c SHA256SUMS
test ! -e /opt/parley-telegram-alerts
test ! -e /etc/systemd/system/parley-telegram.service
test ! -e /etc/systemd/system/parley-telegram.timer
test ! -e /var/lib/parley-monitor/telegram
install -d -o root -g root -m 0755 /opt/parley-telegram-alerts
install -o root -g root -m 0644 telegram-watch.mjs telegram-alert.mjs telegram-cli.mjs enter-telegram.sh \
  parley-telegram.service parley-telegram.timer /opt/parley-telegram-alerts/
install -o root -g root -m 0644 parley-telegram.service parley-telegram.timer /etc/systemd/system/
systemd-analyze verify /etc/systemd/system/parley-telegram.service /etc/systemd/system/parley-telegram.timer
systemctl daemon-reload
printf '%s\n' 'TELEGRAM_INSTALLED_NOT_STARTED_NO_CREDENTIALS_NO_MESSAGE_SENT'
