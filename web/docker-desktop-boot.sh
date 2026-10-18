#!/bin/sh
# Runs when Docker Desktop's Linux VM starts (same window as containers coming back).
# Containers cannot reach 192.168.0.130 directly; this listener on :18096 bridges that gap.
# Also remounts E:/H:/J: into /mnt/host so compose bind mounts see the real NAS drives.
#
# SAFETY: never recursively delete under /mnt/host/{e,h,j}. Those paths are often the
# live Samba NAS mounts (Windows E:/H:/J:). A previous recursive rm of $target wiped the share.

mount_drive() {
  letter="$1"
  target="$2"
  mkdir -p "$target"

  if mountpoint -q "$target" 2>/dev/null; then
    # Already mounted — verify it has content (empty = stale / disconnected view).
    if [ -n "$(ls -A "$target" 2>/dev/null)" ]; then
      echo "mount ok: $letter -> $target (already mounted)"
      return 0
    fi
    echo "remounting empty $letter at $target"
    if ! umount "$target" 2>/tmp/umount-${letter}.err; then
      echo "umount FAILED: $letter -> $target — refusing to touch contents" >&2
      cat /tmp/umount-${letter}.err >&2 || true
      return 1
    fi
  fi

  # Only remove a leftover *empty local directory* that is not a mountpoint.
  # Never recurse-delete — that deletes through a still-mounted NAS share.
  if [ -e "$target" ] && ! mountpoint -q "$target" 2>/dev/null; then
    if [ -n "$(ls -A "$target" 2>/dev/null)" ]; then
      echo "refusing to clear non-empty non-mount path: $target" >&2
      return 1
    fi
    if [ -d "$target" ]; then
      if ! rmdir "$target" 2>/tmp/rmdir-${letter}.err; then
        # ENOENT = automount/race removed it; safe to continue. Anything else = abort.
        if [ -e "$target" ]; then
          echo "rmdir FAILED: $target — refusing to proceed" >&2
          cat /tmp/rmdir-${letter}.err >&2 || true
          return 1
        fi
      fi
    fi
  fi

  mkdir -p "$target"

  if mount -t drvfs "${letter}:" "$target" 2>/tmp/mount-${letter}.err; then
    echo "mount ok: $letter -> $target"
    return 0
  fi

  echo "mount FAILED: $letter -> $target" >&2
  cat /tmp/mount-${letter}.err >&2 || true
  return 1
}

mount_drive E /mnt/host/e || true
mount_drive H /mnt/host/h || true
mount_drive J /mnt/host/j || true

# BusyBox nc -e only accepts a program path (no args), so use a tiny wrapper.
cat > /tmp/jellyfin-forward.sh <<'EOF'
#!/bin/sh
exec nc 192.168.0.130 8096
EOF
chmod +x /tmp/jellyfin-forward.sh

# SSH forwarder for converter-agent (containers cannot reach 192.168.0.130:22).
cat > /tmp/fedora-ssh-forward.sh <<'EOF'
#!/bin/sh
exec nc 192.168.0.130 22
EOF
chmod +x /tmp/fedora-ssh-forward.sh

pkill -f 'nc -lk -p 18096' 2>/dev/null || true
pkill -f 'nc -lk -p 18022' 2>/dev/null || true
sleep 0.2

nohup nc -lk -p 18096 -e /tmp/jellyfin-forward.sh >/tmp/jellyfin-proxy.log 2>&1 &
nohup nc -lk -p 18022 -e /tmp/fedora-ssh-forward.sh >/tmp/fedora-ssh-proxy.log 2>&1 &
sleep 0.3
nc -z 127.0.0.1 18096
nc -z 127.0.0.1 18022
