#!/bin/bash
set -euo pipefail
umask 077
test "${1:-}" = --approve-system-dependencies-and-keytar-build
test "$#" = 1
test "$(id -u)" = 0
test "$(uname -m)" = x86_64
NODE=/opt/parley-runtime/bin/node
NPM=/opt/parley-runtime/bin/npm
TARGET=/opt/parley-agent-host/node_modules/@github/keytar
test -x "$NODE"
test -x "$NPM"
test -f /opt/parley-runtime/include/node/node.h
test "$(realpath "$TARGET")" = "$TARGET"
test "$(stat -c '%U' "$TARGET")" = root
! pgrep -u parley-agent >/dev/null
"$NODE" --input-type=module -e '
  import fs from "node:fs";
  import assert from "node:assert/strict";
  const root = "/opt/parley-agent-host";
  const p = JSON.parse(fs.readFileSync(root + "/node_modules/@github/keytar/package.json"));
  const lock = JSON.parse(fs.readFileSync(root + "/package-lock.json"));
  const pin = lock.packages["node_modules/@github/keytar"];
  assert.equal(p.name, "@github/keytar");
  assert.equal(p.version, "7.10.6");
  assert.equal(p.scripts.build, "node-gyp rebuild");
  assert.equal(pin.version, p.version);
  assert.equal(pin.integrity, "sha512-mRW6cUsSG+nj4jp5gp8e91zPySaT73r+2JM6VyMZfrEgksjPmjSMr+tPGNOK3HUHV+GUU9B1LAiiYy/wmAnIxA==");
  console.log("PINNED_KEYTAR_BUILD_DECLARATION_VERIFIED");
'
apt-get update
env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  libsecret-1-dev gnome-keyring dbus-user-session build-essential python3 pkg-config
# Only this package's declared build runs as the non-root account, using local Node headers.
trap 'chown -R root:root "$TARGET"' EXIT
chown -R parley-agent:parley-agent "$TARGET"
sudo -u parley-agent env -i HOME=/var/lib/parley-agent \
  PATH=/opt/parley-runtime/bin:/usr/bin:/bin \
  npm_config_nodedir=/opt/parley-runtime \
  "$NPM" --prefix "$TARGET" run build --ignore-scripts
chown -R root:root "$TARGET"
sudo -u parley-agent env -i HOME=/var/lib/parley-agent \
  PATH=/opt/parley-runtime/bin:/usr/bin:/bin \
  "$NODE" --input-type=module -e '
    import { createRequire } from "node:module";
    const require = createRequire("/opt/parley-agent-host/node_modules/@binance/agentic-wallet/package.json");
    const keytar = require("@github/keytar");
    if (typeof keytar.setPassword !== "function") throw new Error("NATIVE_MODULE_UNAVAILABLE");
    console.log("KEYTAR_NATIVE_LOAD_PASSED_NO_CREDENTIAL_ACCESS");
  '
printf '%s\n' 'DEPENDENCIES_PREPARED_ONLY; NO_KEYRING_UNLOCK_NO_WALLET_LOGIN_NO_NEW_AGENT_SERVICE'
