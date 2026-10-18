#!/usr/bin/env python3
"""Localhost helper so the Movie Night UI can remount E/H/J and recreate containers.

Listens on http://127.0.0.1:18097/
Started by start-stack.ps1 (and the Movie Night logon scheduled task).

When E/H/J or the Fedora/Jellyfin forwarders drop, auto-run the safe boot script
(no recursive delete). Then recreate movie-night-web so library binds see the mounts.
The boot script is refused if it still contains `rm -rf`.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 18097
POLL_SECONDS = 90
# pythonw/exe child consoles (wsl, docker) flash a taskbar window unless this is set.
CREATE_NO_WINDOW = 0x08000000


def _web_root() -> Path:
    if getattr(sys, "frozen", False):
        here = Path(sys.executable).resolve().parent
        for candidate in (here, here.parent, here.parent.parent):
            if (candidate / "docker-compose.yml").exists():
                return candidate
        return here
    return Path(__file__).resolve().parent


WEB_ROOT = _web_root()


def run(args: list[str], **kwargs):
    kwargs.setdefault("creationflags", CREATE_NO_WINDOW)
    return subprocess.run(args, **kwargs)
BOOT_IN_VM = (
    "/mnt/host/d/OneDrive/Pictures/"
    "The-Bannered-Pony-Mare/The-Bannered-Pony-Mare/web/docker-desktop-boot.sh"
)
CONF_IN_VM = (
    "/mnt/host/d/OneDrive/Pictures/"
    "The-Bannered-Pony-Mare/The-Bannered-Pony-Mare/web/.docker-desktop-wsl.conf"
)

_recover_lock = threading.Lock()


LOG_PATH = WEB_ROOT / "stack-helper.log"


def log(message: str) -> None:
    stamp = time.strftime("%H:%M:%S")
    line = f"[{stamp}] {message}"
    print(line, flush=True)
    try:
        with LOG_PATH.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    except OSError:
        pass


def ensure_lf(path: Path) -> None:
    data = path.read_bytes().replace(b"\r\n", b"\n")
    path.write_bytes(data)


def remount_drives() -> None:
    boot = WEB_ROOT / "docker-desktop-boot.sh"
    conf = WEB_ROOT / ".docker-desktop-wsl.conf"
    if not boot.exists() or not conf.exists():
        raise RuntimeError(f"Missing boot files in {WEB_ROOT}")
    ensure_lf(boot)
    # Refuse to run if the boot script still contains the destructive wipe command.
    boot_text = boot.read_text(encoding="utf-8", errors="replace")
    for line in boot_text.splitlines():
        code = line.split("#", 1)[0]
        if "rm" in code and "-rf" in code:
            raise RuntimeError(
                "Refusing to run docker-desktop-boot.sh: still contains recursive rm. "
                "That path wiped the live E:/H:/J: Samba mounts."
            )
    cmd = (
        f"cp '{CONF_IN_VM}' /etc/wsl.conf && "
        f"chmod +x '{BOOT_IN_VM}' && '{BOOT_IN_VM}'"
    )
    result = run(
        ["wsl", "-d", "docker-desktop", "--", "sh", "-c", cmd],
        cwd=str(WEB_ROOT),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(
            f"Failed to remount drives in Docker Desktop: {detail or result.returncode}"
        )
    # Surface boot script stdout (mount ok / refusals) for diagnostics.
    out = (result.stdout or "").strip()
    if out:
        log(out)


def recreate_stack() -> None:
    run(
        [
            "docker",
            "compose",
            "up",
            "-d",
            "--force-recreate",
            "converter-agent",
            "movie-night-web",
        ],
        cwd=str(WEB_ROOT),
        check=True,
    )
    run(
        ["docker", "compose", "up", "-d"],
        cwd=str(WEB_ROOT),
        check=True,
    )


def mounts_ok() -> bool:
    """True when E/H/J are mounted in docker-desktop and not empty placeholders.

    Avoid `$vars` in the inline `wsl ... sh -c` string — Windows wsl.exe strips them
    before the command reaches docker-desktop.
    """
    check = (
        'mountpoint -q /mnt/host/e && [ -n "$(ls -A /mnt/host/e 2>/dev/null)" ] && '
        'mountpoint -q /mnt/host/h && [ -n "$(ls -A /mnt/host/h 2>/dev/null)" ] && '
        'mountpoint -q /mnt/host/j && [ -n "$(ls -A /mnt/host/j 2>/dev/null)" ]'
    )
    result = run(
        ["wsl", "-d", "docker-desktop", "--", "sh", "-c", check],
        cwd=str(WEB_ROOT),
        capture_output=True,
        text=True,
    )
    return result.returncode == 0


def port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=2):
            return True
    except OSError:
        return False


def forwarders_ok() -> bool:
    """Jellyfin :18096 and Fedora SSH :18022 listeners inside the Docker Desktop VM."""
    return port_open(18096) and port_open(18022)


def recreate_web() -> None:
    run(
        ["docker", "compose", "up", "-d", "--force-recreate", "movie-night-web"],
        cwd=str(WEB_ROOT),
        check=True,
    )


def docker_ready() -> bool:
    result = run(
        ["docker", "info"],
        cwd=str(WEB_ROOT),
        capture_output=True,
        text=True,
    )
    return result.returncode == 0


def recover(*, force: bool = False) -> None:
    """Explicit remount + recreate. Never called by the auto watch loop."""
    if not _recover_lock.acquire(blocking=False):
        log("Recover already in progress; skipping.")
        return
    try:
        if not force and mounts_ok():
            log("Mounts already healthy; skip recreate.")
            return
        log("Remounting E/H/J + Jellyfin forwarder (explicit recover)...")
        remount_drives()
        if not mounts_ok():
            raise RuntimeError(
                "Remount finished but E/H/J still look empty/unmounted — "
                "refusing to recreate containers against bad binds."
            )
        log("Recreating converter-agent and movie-night-web...")
        recreate_stack()
        log("Stack recover finished.")
    finally:
        _recover_lock.release()


def safe_auto_recover(reason: str) -> None:
    """Remount with the safe boot script, then refresh the web binds."""
    if not _recover_lock.acquire(blocking=False):
        log("Recover already in progress; skipping.")
        return
    try:
        log(f"Safe recover: {reason}")
        remount_drives()
        if not mounts_ok():
            log(
                "ALERT: Safe remount finished but E/H/J still look empty. "
                "Not recreating containers."
            )
            return
        log("Recreating movie-night-web so library mounts are visible...")
        recreate_web()
        log(
            "Safe recover finished. "
            f"forwarders ssh={port_open(18022)} jellyfin={port_open(18096)}"
        )
    except Exception as exc:  # noqa: BLE001
        log(f"Safe recover failed: {exc}")
    finally:
        _recover_lock.release()


def watch_loop() -> None:
    """Keep E/H/J and the Fedora/Jellyfin forwarders up via the safe boot script."""
    log("Watch loop starting (safe auto-remount; refuses boot scripts that contain rm -rf).")
    while not docker_ready():
        log("Waiting for Docker Desktop...")
        time.sleep(5)

    try:
        if mounts_ok() and forwarders_ok():
            log("Mounts and forwarders healthy at startup.")
        else:
            safe_auto_recover("startup: mounts or forwarders down")
    except Exception as exc:  # noqa: BLE001
        log(f"Startup mount check failed: {exc}")

    while True:
        time.sleep(POLL_SECONDS)
        try:
            if not docker_ready():
                continue
            if mounts_ok() and forwarders_ok():
                continue
            safe_auto_recover("E/H/J mounts or Fedora/Jellyfin forwarders are down")
        except Exception as exc:  # noqa: BLE001
            log(f"Watch mount check failed: {exc}")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        log("%s - %s" % (self.address_string(), fmt % args))

    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        if path in ("/", "/health"):
            healthy = mounts_ok()
            self._send(
                200,
                {
                    "ok": True,
                    "service": "movie-night-stack-helper",
                    "mountsOk": healthy,
                    "autoRecover": True,
                },
            )
            return
        self._send(404, {"ok": False, "error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        if path != "/remount":
            self._send(404, {"ok": False, "error": "Not found"})
            return

        # Respond before recreating the web container.
        self._send(
            202,
            {
                "ok": True,
                "message": "Remounting drives and recreating containers…",
            },
        )

        def worker() -> None:
            time.sleep(1)
            try:
                recover(force=True)
            except Exception as exc:  # noqa: BLE001
                log(f"Recover failed: {exc}")

        threading.Thread(target=worker, daemon=True).start()


def _tray_image():
    from PIL import Image, ImageDraw

    image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((4, 4, 60, 60), radius=14, fill=(32, 96, 168, 255))
    draw.rounded_rectangle((18, 18, 46, 40), radius=4, fill=(235, 242, 250, 255))
    draw.polygon([(18, 40), (32, 52), (46, 40)], fill=(235, 242, 250, 255))
    return image


def run_tray(server: ThreadingHTTPServer) -> None:
    import pystray

    def status_text(_icon=None, _item=None) -> str:
        mounts = "up" if mounts_ok() else "down"
        ssh = "up" if port_open(18022) else "down"
        return f"Drives {mounts} · Fedora SSH {ssh}"

    def open_log(_icon, _item) -> None:
        os.startfile(LOG_PATH)  # type: ignore[attr-defined]

    def quit_app(icon, _item) -> None:
        icon.stop()
        server.shutdown()

    menu = pystray.Menu(
        pystray.MenuItem(status_text, None, enabled=False),
        pystray.MenuItem("Open log", open_log),
        pystray.MenuItem("Quit", quit_app),
    )
    icon = pystray.Icon(
        "movie-night-helper",
        _tray_image(),
        "Movie Night helper",
        menu,
    )
    log("Tray icon running.")
    icon.run()


def main() -> int:
    # Single instance: fail if port is taken.
    try:
        server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError as exc:
        log(f"Could not bind 127.0.0.1:{PORT}: {exc}")
        return 1

    threading.Thread(target=watch_loop, daemon=True).start()
    threading.Thread(target=server.serve_forever, daemon=True).start()

    log(f"Stack helper listening on http://127.0.0.1:{PORT}/")
    log("POST /remount  — remount drives and recreate containers (explicit only)")
    log("GET  /health   — helper status")
    try:
        run_tray(server)
    except KeyboardInterrupt:
        log("Stopped.")
    except Exception as exc:  # noqa: BLE001
        log(f"Tray unavailable ({exc}); staying running without an icon.")
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            log("Stopped.")
    return 0


if __name__ == "__main__":
    os.chdir(WEB_ROOT)
    sys.exit(main())
