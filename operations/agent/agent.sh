#!/bin/bash
set -euo pipefail
HOME_DIR=/var/lib/parley-agent
DEST=/opt/parley-agent-host
if [ "$(id -u)" = 0 ]; then
  exec sudo -u parley-agent env -i HOME="$HOME_DIR" \
    PATH="$DEST/node_modules/.bin:/opt/parley-runtime/bin:/usr/bin:/bin" \
    OPENCLAW_STATE_DIR="$HOME_DIR/.openclaw" OPENCLAW_NO_RESPAWN=1 \
    /opt/parley-runtime/bin/node "$DEST/node_modules/openclaw/openclaw.mjs" "$@"
fi
test "$(id -un)" = parley-agent
export HOME="$HOME_DIR"
export PATH="$DEST/node_modules/.bin:/opt/parley-runtime/bin:/usr/bin:/bin"
export OPENCLAW_STATE_DIR="$HOME_DIR/.openclaw"
export OPENCLAW_NO_RESPAWN=1
exec /opt/parley-runtime/bin/node "$DEST/node_modules/openclaw/openclaw.mjs" "$@"
