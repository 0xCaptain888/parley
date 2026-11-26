#!/bin/bash
set -euo pipefail
set +x
umask 077
ulimit -c 0
test "$#" = 1
test "$1" = --approve-existing-keyring-private-unlock
test "$(id -un)" = parley-agent
test "$HOME" = /var/lib/parley-agent
test -t 0
test -t 1
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
export GNOME_KEYRING_CONTROL="$XDG_RUNTIME_DIR/keyring"
NODE=/opt/parley-runtime/bin/node
CHECK=/opt/parley-wallet-security/keyring-session.mjs
"$NODE" "$CHECK" inspect-locked
password=
trap 'unset password' EXIT
IFS= read -r -s -p 'Existing keyring password (hidden): ' password
printf '\n'
test "${#password}" -ge 16
test "${#password}" -le 1024
# Never create/reset a keyring, save this password, or supply it in argv/environment.
printf '%s' "$password" | /usr/bin/gnome-keyring-daemon --unlock >/dev/null 2>&1
unset password
"$NODE" "$CHECK" inspect
printf '%s\n' 'EXISTING_KEYRING_UNLOCKED_NO_LOGIN_NO_TRANSACTION'
