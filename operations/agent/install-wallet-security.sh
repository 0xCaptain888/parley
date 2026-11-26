#!/bin/bash
set -euo pipefail
umask 077
test "${1:-}" = --approve-readonly-security-addon
test "$#" = 1
test "$(id -u)" = 0
test "$(uname -m)" = x86_64
test -x /opt/parley-runtime/bin/node
test -x /usr/bin/gnome-keyring-daemon
test -x /usr/bin/gdbus
test "$(stat -c '%U:%a' /var/lib/parley-agent)" = parley-agent:700
test ! -e /opt/parley-wallet-security
cd "$(dirname "$0")"
sha256sum --strict -c SHA256SUMS
install -d -o root -g root -m 0755 /opt/parley-wallet-security
install -o root -g root -m 0644 keyring-session.mjs enter-keyring.sh \
  unlock-keyring.sh wallet-native-guard.cjs wallet-secure.mjs wallet-preflight.mjs KEYRING.md SHA256SUMS \
  /opt/parley-wallet-security/
printf '%s\n' 'READONLY_WALLET_SECURITY_ADDON_INSTALLED_NO_SERVICE_NO_LOGIN'
