#!/bin/bash
set -euo pipefail
umask 077
test "${1:-}" = --approve-readonly-chat-discovery
test "$#" = 1
test "$(id -un)" = parley
test "$HOME" = /var/lib/parley-monitor
test -t 0
test -t 1
token=
trap 'unset token' EXIT
IFS= read -r -s -p 'Telegram bot token for read-only ID lookup (hidden): ' token
printf '\n'
printf '%s' "$token" | /opt/parley-runtime/bin/node \
  "$(dirname -- "${BASH_SOURCE[0]}")/telegram-discover.mjs" \
  --approve-readonly-chat-discovery
unset token
