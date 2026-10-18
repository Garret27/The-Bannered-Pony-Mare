#!/bin/sh
# Copy the mounted SSH key to a mode-600 path the agent user can read.
set -eu
KEY_SRC="${FEDORA_SSH_KEY_SRC:-/run/secrets/fedora_ssh}"
KEY_DST="${FEDORA_SSH_KEY_PATH:-/tmp/agent-ssh/id_ed25519}"
KNOWN_SRC="${FEDORA_SSH_KNOWN_HOSTS_SRC:-/run/secrets/fedora_known_hosts}"
KNOWN_DST="${FEDORA_SSH_KNOWN_HOSTS:-/tmp/agent-ssh/known_hosts}"

mkdir -p /tmp/agent-ssh /work
if [ -f "$KEY_SRC" ]; then
  cp "$KEY_SRC" "$KEY_DST"
  chmod 600 "$KEY_DST"
fi
if [ -f "$KNOWN_SRC" ]; then
  cp "$KNOWN_SRC" "$KNOWN_DST"
  chmod 644 "$KNOWN_DST"
fi
chown -R agent:agent /tmp/agent-ssh /work 2>/dev/null || true

export FEDORA_SSH_KEY_PATH="$KEY_DST"
export FEDORA_SSH_KNOWN_HOSTS="$KNOWN_DST"

if [ "$(id -u)" = "0" ]; then
  exec runuser -u agent -- "$@"
fi
exec "$@"
