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
key=
trap 'unset key' EXIT
printf '%s\n' 'Enter only the api.apikey.fan relay key. Input is hidden.'
IFS= read -r -s -p 'Relay key: ' key
printf '\n'
printf '%s' "$key" | /opt/parley-runtime/bin/node "$SCRIPT_DIR/relay.mjs" \
  store-key --approve-private-storage
unset key
