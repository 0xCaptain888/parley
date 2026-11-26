#!/bin/bash
set -euo pipefail
umask 077

# This explicit flag records an operator decision, not inferred user consent.
test "${1:-}" = --approve-openclaw-only-lifecycle
test "$(id -u)" = 0
test "$(uname -s)" = Linux
test "$(uname -m)" = x86_64
DEST=/opt/parley-agent-host
HOME_DIR=/var/lib/parley-agent
NODE=/opt/parley-runtime/bin/node
export PATH=/opt/parley-runtime/bin:/usr/sbin:/usr/bin:/sbin:/bin
test -d "$DEST"
test ! -L "$DEST"
test -d "$HOME_DIR"
test ! -L "$HOME_DIR"
test "$(stat -c %U "$DEST")" = root
test "$(stat -c %U "$HOME_DIR")" = parley-agent
test "$(stat -c %a "$HOME_DIR")" = 700
"$NODE" "$DEST/verify.mjs" "$DEST" "$HOME_DIR/workspace/skills/parley"

# Only public software is writable during maintenance. No Agent/service is
# running, and no wallet or provider credential is present in this bootstrap.
seal_code() {
  chown -R root:root "$DEST"
  chmod -R go-w "$DEST"
  chmod -R a+rX "$DEST"
}
trap seal_code EXIT
chown -R parley-agent:parley-agent "$DEST"
sudo -u parley-agent env -i HOME="$HOME_DIR" PATH="$PATH" \
  npm ci --prefix "$DEST" --engine-strict --ignore-scripts --include=optional \
  --no-audit --no-fund --registry=https://registry.npmjs.org
"$NODE" "$DEST/verify.mjs" "$DEST"

# Check the two first-party lifecycle entrypoints before allowing the official
# launcher to complete its pending lifecycle. Never enable npm dependency hooks.
"$NODE" --input-type=module -e '
import fs from "node:fs";
const p = JSON.parse(fs.readFileSync("/opt/parley-agent-host/node_modules/openclaw/package.json", "utf8"));
if (p.version !== "2026.11.10" ||
    p.scripts?.preinstall !== "node scripts/preinstall-package-manager-warning.mjs" ||
    p.scripts?.postinstall !== "node scripts/postinstall-bundled-plugins.mjs") {
  throw new Error("Unexpected first-party lifecycle; refusing to run");
}
'
sudo -u parley-agent env -i HOME="$HOME_DIR" \
  PATH="$DEST/node_modules/.bin:/opt/parley-runtime/bin:/usr/bin:/bin" \
  OPENCLAW_STATE_DIR="$HOME_DIR/.openclaw" OPENCLAW_NO_RESPAWN=1 \
  "$NODE" "$DEST/node_modules/openclaw/openclaw.mjs" --version
seal_code
trap - EXIT
"$DEST/bin/parley-agent" setup --baseline --workspace "$HOME_DIR/workspace"
"$NODE" "$DEST/accept.mjs" /home/admin/parley-agent-host-acceptance-after-repair-2026-11-26.json
