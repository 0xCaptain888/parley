#!/bin/bash
set -euo pipefail
umask 077
test "$#" = 1
test "$1" = --approve-business-runtime-only
test "$(id -u)" = 0
test "$(uname -m)" = x86_64
test -x /opt/parley-runtime/bin/node
test ! -e /opt/parley-business
test ! -L /opt/parley-business
cd "$(dirname "$0")"
sha256sum --strict -c SHA256SUMS
# Copy only fixed public runtime files. Never source an uploaded configuration.
install -d -o root -g root -m 0755 /opt/parley-business
for directory in scripts resident config; do
  install -d -o root -g root -m 0755 "/opt/parley-business/$directory"
done
for file in scripts/ops-job.mjs scripts/resident-ops.mjs scripts/stats-runner.mjs \
  resident/resident.mjs config/build.json manifest.json SHA256SUMS README.md install-business.sh; do
  test -f "$file"
  test ! -L "$file"
  install -o root -g root -m 0644 "$file" "/opt/parley-business/$file"
done
printf '%s\n' 'BUSINESS_RUNTIME_INSTALLED_NO_CONFIG_NO_SERVICES_NO_WALLET'
