#!/bin/bash
set -euo pipefail
umask 077
test "${1:-}" = --approve-private-storage
test "$#" = 1
test "$(id -un)" = parley-agent
test "$HOME" = /var/lib/parley-agent
test -t 0
test -t 1
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
token=
chat=
trap 'unset token chat' EXIT
printf '%s\n' 'Enter the Telegram bot token privately. No network request will be made.'
IFS= read -r -s -p 'Bot token: ' token
printf '\n'
IFS= read -r -s -p 'Numeric chat ID: ' chat
printf '\n'
printf '%s\n%s' "$token" "$chat" | /opt/parley-runtime/bin/node "$SCRIPT_DIR/telegram-cli.mjs" \
  store --approve-private-storage /var/lib/parley-agent/parley-telegram
unset token chat
