#!/bin/bash
set -euo pipefail
set +x
umask 077
ulimit -c 0
test "${1:-}" = --approve-new-encrypted-keyring-and-synthetic-test
test "$#" = 1
test "$(id -un)" = parley-agent
test "$HOME" = /var/lib/parley-agent
test -t 0
test -t 1
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
export GNOME_KEYRING_CONTROL="$XDG_RUNTIME_DIR/keyring"
NODE=/opt/parley-runtime/bin/node
CHECK=/opt/parley-wallet-security/keyring-session.mjs
"$NODE" "$CHECK" first-setup
password=
repeat=
trap 'unset password repeat' EXIT
IFS= read -r -s -p 'New keyring password, minimum 16 characters (hidden): ' password
printf '\n'
IFS= read -r -s -p 'Repeat keyring password (hidden): ' repeat
printf '\n'
test "${#password}" -ge 16
test "${#password}" -le 1024
test "$password" = "$repeat"
unset repeat
# The password is never an argument, environment variable or saved file.
printf '%s' "$password" | /usr/bin/gnome-keyring-daemon --unlock >/dev/null 2>&1
"$NODE" "$CHECK" seed
/usr/bin/gdbus call --session --dest org.freedesktop.secrets \
  --object-path /org/freedesktop/secrets --method org.freedesktop.Secret.Service.Lock \
  "['/org/freedesktop/secrets/collection/login']" >/dev/null
"$NODE" "$CHECK" locked
printf 'parley-deliberately-wrong-%s' "$RANDOM-$RANDOM" | \
  /usr/bin/gnome-keyring-daemon --unlock >/dev/null 2>&1 || true
"$NODE" "$CHECK" locked
printf '%s' "$password" | /usr/bin/gnome-keyring-daemon --unlock >/dev/null 2>&1
unset password
"$NODE" "$CHECK" finish
printf '%s\n' 'KEYRING_PASSWORD_DISCARDED_NO_WALLET_LOGIN_NO_TRANSACTION'
