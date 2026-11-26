#!/bin/bash
set -euo pipefail
umask 077

# Explicit approval is obtained before this script is invoked on the server.
test "$(id -u)" = 0
test "$(uname -s)" = Linux
test "$(uname -m)" = x86_64
NODE=/opt/parley-runtime/bin/node
export PATH=/opt/parley-runtime/bin:/usr/sbin:/usr/bin:/sbin:/bin
SOURCE="$(cd -- "$(dirname -- "$0")" && pwd)"
DEST=/opt/parley-agent-host
HOME_DIR=/var/lib/parley-agent
test -x "$NODE"
(cd "$SOURCE" && sha256sum --check SHA256SUMS)
"$NODE" "$SOURCE/verify.mjs" "$SOURCE"
if getent passwd parley-agent >/dev/null; then
  printf '%s\n' 'STOP: parley-agent already exists; inspect before reinstallation' >&2
  exit 1
fi
test ! -e "$DEST"
test ! -e "$HOME_DIR"
useradd --system --user-group --home-dir "$HOME_DIR" --shell /usr/sbin/nologin parley-agent
install -d -o parley-agent -g parley-agent -m 0700 "$HOME_DIR" "$DEST"
install -o parley-agent -g parley-agent -m 0600 "$SOURCE/package.json" "$SOURCE/package-lock.json" "$DEST/"
install -o root -g root -m 0644 "$SOURCE/pins.json" "$SOURCE/verify.mjs" "$SOURCE/accept.mjs" "$DEST/"

# Never execute dependency lifecycle scripts as root (or during this bootstrap).
sudo -u parley-agent env -i HOME="$HOME_DIR" PATH="$PATH" \
  npm ci --prefix "$DEST" --engine-strict --ignore-scripts --omit=optional --no-audit --no-fund --registry=https://registry.npmjs.org
"$NODE" "$DEST/verify.mjs" "$DEST"
install -d -o parley-agent -g parley-agent -m 0700 "$HOME_DIR/workspace/skills/parley"
for file in SKILL.md parley.mjs; do
  sudo -u parley-agent env -i HOME="$HOME_DIR" PATH="$PATH" \
    curl --fail --silent --show-error --proto '=https' --tlsv1.2 --max-time 60 \
    "https://parley-staging.pages.dev/skill/$file" \
    --output "$HOME_DIR/workspace/skills/parley/$file"
done
"$NODE" "$DEST/verify.mjs" "$DEST" "$HOME_DIR/workspace/skills/parley"
install -d -o parley-agent -g parley-agent -m 0700 "$HOME_DIR/workspace/skills/binance-agentic-wallet"
cp -R "$SOURCE/wallet-skill/." "$HOME_DIR/workspace/skills/binance-agentic-wallet/"
chown -R parley-agent:parley-agent "$HOME_DIR/workspace"
chmod -R go-rwx "$HOME_DIR"
chown -R root:root "$DEST"
chmod -R go-w "$DEST"
chmod -R a+rX "$DEST"
chmod 0755 "$DEST"
chmod 0644 "$DEST/package.json" "$DEST/package-lock.json"
install -d -o root -g root -m 0755 "$DEST/bin"
install -o root -g root -m 0755 "$SOURCE/agent.sh" "$DEST/bin/parley-agent"
printf '%s\n' 'DEPENDENCIES_STAGED_LIFECYCLE_APPROVAL_REQUIRED'
printf '%s\n' 'OpenClaw replays its own pending install scripts at startup.'
printf '%s\n' 'Do not launch it until the narrowly scoped lifecycle completion is approved.'
exit 78
