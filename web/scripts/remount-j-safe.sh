#!/bin/sh
# Safely remount Windows J: into Docker Desktop VM. Never rm -rf.
set -eu
target=/mnt/host/j

if mountpoint "$target" >/dev/null 2>&1; then
  echo "already mounted: $target"
  ls -la "$target" | head -15
  exit 0
fi

# Clear only empty leftovers (no recursive delete)
if [ -d "$target/Movies J Drive - Jellyfin" ]; then
  rmdir "$target/Movies J Drive - Jellyfin" 2>/dev/null || {
    echo "refusing: Jellyfin dir not empty" >&2
    exit 1
  }
fi

if [ -d "$target" ]; then
  if [ -n "$(ls -A "$target" 2>/dev/null)" ]; then
    echo "refusing: non-empty non-mount path $target" >&2
    ls -la "$target" >&2
    exit 1
  fi
  rmdir "$target"
fi

mkdir -p "$target"
if mount -t drvfs J: "$target"; then
  echo "mount ok: J: -> $target"
  ls -la "$target" | head -15
  exit 0
fi
echo "mount FAILED: J: -> $target" >&2
exit 1
