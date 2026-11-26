#!/bin/bash
set -euo pipefail
umask 077
test "${1:-}" = --approve-private-storage
test "$#" = 1
test "$(id -un)" = parley
test "$HOME" = /var/lib/parley-monitor
test -t 0
test -t 1
token=
chat=
trap 'unset token chat' EXIT
IFS= read -r -s -p 'Telegram bot token (hidden): ' token
printf '\n'
IFS= read -r -s -p 'Numeric chat ID (hidden): ' chat
printf '\n'
printf '%s\n%s' "$token" "$chat" | /opt/parley-runtime/bin/node \
  /opt/parley-telegram-alerts/telegram-cli.mjs store --approve-private-storage /var/lib/parley-monitor/telegram
unset token chat
