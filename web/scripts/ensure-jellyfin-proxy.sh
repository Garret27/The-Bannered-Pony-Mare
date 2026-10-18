#!/bin/sh
# Health gate for compose: wait until the Docker Desktop VM forwarder is answering.
# The listener itself is started by docker-desktop-boot.sh (WSL boot / start-stack.ps1).

echo "Waiting for Jellyfin forwarder on host.docker.internal:18096..."
i=0
while [ "$i" -lt 60 ]; do
  if wget -q -O- -T 2 "http://host.docker.internal:18096/System/Info/Public" >/dev/null 2>&1; then
    echo "Jellyfin forwarder is up."
    exec sleep infinity
  fi
  i=$((i + 1))
  sleep 2
done

echo "Timed out waiting for Jellyfin forwarder on :18096" >&2
echo "Run: powershell -ExecutionPolicy Bypass -File .\\start-stack.ps1" >&2
exit 1
