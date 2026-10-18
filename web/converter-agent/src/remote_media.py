#!/usr/bin/env python3
"""SSH/SFTP bridge to the Fedora media library.

All library reads/writes/deletes go through this module. Paths must stay under
configured remote roots — no recursive deletes, no path escape.
"""

from __future__ import annotations

import hashlib
import os
import shlex
import subprocess
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional

from config.settings import (
    FEDORA_SSH_HOST,
    FEDORA_SSH_KEY_PATH,
    FEDORA_SSH_KNOWN_HOSTS,
    FEDORA_SSH_PORT,
    FEDORA_SSH_USER,
    REMOTE_MOVIES_OUTPUT,
    REMOTE_SOURCE_ROOTS,
    REMOTE_TV_OUTPUT,
)


class RemoteMediaError(RuntimeError):
    """Raised when a remote media operation fails or is refused."""


@dataclass(frozen=True)
class RemoteStat:
    path: str
    size: int
    is_file: bool


def remote_bridge_configured() -> tuple[bool, str]:
    if not FEDORA_SSH_HOST:
        return False, "FEDORA_SSH_HOST is not set"
    if not FEDORA_SSH_USER:
        return False, "FEDORA_SSH_USER is not set"
    if not FEDORA_SSH_KEY_PATH or not os.path.isfile(FEDORA_SSH_KEY_PATH):
        return False, f"SSH key not found at {FEDORA_SSH_KEY_PATH}"
    if not REMOTE_SOURCE_ROOTS:
        return False, "No REMOTE_* source roots configured"
    return True, f"{FEDORA_SSH_USER}@{FEDORA_SSH_HOST}:{FEDORA_SSH_PORT}"


def all_allowlisted_roots() -> List[str]:
    roots = list(REMOTE_SOURCE_ROOTS.values())
    roots.append(REMOTE_MOVIES_OUTPUT)
    roots.append(REMOTE_TV_OUTPUT)
    # Unique, non-empty
    seen: set[str] = set()
    ordered: List[str] = []
    for root in roots:
        cleaned = (root or "").rstrip("/")
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            ordered.append(cleaned)
    return ordered


def normalize_remote_path(path: str) -> str:
    raw = (path or "").replace("\\", "/").strip()
    if not raw.startswith("/"):
        raise RemoteMediaError(f"Remote path must be absolute: {path}")
    parts: List[str] = []
    for part in raw.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            raise RemoteMediaError(f"Remote path must not contain ..: {path}")
        parts.append(part)
    return "/" + "/".join(parts)


def assert_under_allowlist(path: str, roots: Optional[Iterable[str]] = None) -> str:
    normalized = normalize_remote_path(path)
    allowed = list(roots) if roots is not None else all_allowlisted_roots()
    for root in allowed:
        root_n = normalize_remote_path(root)
        if normalized == root_n or normalized.startswith(root_n + "/"):
            return normalized
    raise RemoteMediaError(
        f"Remote path not under allowlisted library roots: {normalized}"
    )


def resolve_remote_source_path(
    root_key: str,
    title: str,
    video_file: str,
    source_title: Optional[str] = None,
) -> List[str]:
    """Return candidate remote paths (source_title first, then title, year-stripped)."""
    import re

    root = REMOTE_SOURCE_ROOTS.get(root_key)
    if not root:
        raise RemoteMediaError(f"Unknown rootKey: {root_key}")
    root_n = normalize_remote_path(root)
    video = video_file.replace("\\", "/").lstrip("/")
    if "/" in video or video in (".", ".."):
        raise RemoteMediaError(f"Invalid videoFile: {video_file}")

    candidates: List[str] = []
    for relative in (source_title, title):
        if not relative:
            continue
        normalized = relative.replace("\\", "/").strip("/")
        if not normalized or ".." in normalized.split("/"):
            continue
        path = f"{root_n}/{normalized}/{video}"
        if path not in candidates:
            candidates.append(path)

        parts = normalized.split("/")
        if parts:
            stripped_show = re.sub(
                r"\s*\((?:19|20)\d{2}\)\s*$", "", parts[0]
            ).strip()
            if stripped_show and stripped_show != parts[0]:
                alt_rel = "/".join([stripped_show, *parts[1:]])
                alt = f"{root_n}/{alt_rel}/{video}"
                if alt not in candidates:
                    candidates.append(alt)

    if not candidates:
        candidates.append(f"{root_n}/{title.strip('/')}/{video}")
    return [assert_under_allowlist(c, [root_n]) for c in candidates]


def remote_output_root_for_mode(mode: str) -> str:
    if mode == "tv":
        return normalize_remote_path(REMOTE_TV_OUTPUT)
    return normalize_remote_path(REMOTE_MOVIES_OUTPUT)


def _ssh_base_args() -> List[str]:
    ok, detail = remote_bridge_configured()
    if not ok:
        raise RemoteMediaError(f"Remote media bridge not configured: {detail}")
    args = [
        "ssh",
        "-i",
        FEDORA_SSH_KEY_PATH,
        "-p",
        str(FEDORA_SSH_PORT),
        "-o",
        "BatchMode=yes",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        f"UserKnownHostsFile={FEDORA_SSH_KNOWN_HOSTS}",
        "-o",
        "StrictHostKeyChecking=yes",
        # Forwarder host may be host.docker.internal; key is still Fedora's.
        "-o",
        "HostKeyAlias=192.168.0.130",
        "-o",
        "ConnectTimeout=15",
        f"{FEDORA_SSH_USER}@{FEDORA_SSH_HOST}",
    ]
    return args


def _run_ssh(remote_command: str, *, timeout: int = 120) -> subprocess.CompletedProcess[str]:
    cmd = _ssh_base_args() + [remote_command]
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def _run_scp(
    local_path: str,
    remote_path: str,
    *,
    upload: bool,
    timeout: int = 3600,
) -> None:
    assert_under_allowlist(remote_path)
    remote_spec = f"{FEDORA_SSH_USER}@{FEDORA_SSH_HOST}:{remote_path}"
    scp_cmd = [
        "scp",
        "-i",
        FEDORA_SSH_KEY_PATH,
        "-P",
        str(FEDORA_SSH_PORT),
        "-o",
        "BatchMode=yes",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        f"UserKnownHostsFile={FEDORA_SSH_KNOWN_HOSTS}",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "HostKeyAlias=192.168.0.130",
        "-o",
        "ConnectTimeout=15",
    ]
    if upload:
        scp_cmd.extend([local_path, remote_spec])
    else:
        scp_cmd.extend([remote_spec, local_path])

    result = subprocess.run(
        scp_cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if result.returncode != 0:
        err = (result.stderr or result.stdout or "").strip()
        direction = "upload" if upload else "download"
        raise RemoteMediaError(f"scp {direction} failed: {err or result.returncode}")


def ssh_reachable() -> tuple[bool, str]:
    try:
        result = _run_ssh("echo ok", timeout=20)
    except (OSError, subprocess.TimeoutExpired, RemoteMediaError) as exc:
        return False, str(exc)
    if result.returncode != 0:
        return False, (result.stderr or result.stdout or "ssh failed").strip()
    if "ok" not in (result.stdout or ""):
        return False, "unexpected ssh response"
    return True, f"{FEDORA_SSH_USER}@{FEDORA_SSH_HOST}:{FEDORA_SSH_PORT}"


def remote_stat(path: str) -> RemoteStat:
    safe = assert_under_allowlist(path)
    quoted = shlex.quote(safe)
    script = (
        f"if [ -f {quoted} ]; then stat -c '%s' {quoted}; "
        f"elif [ -e {quoted} ]; then echo NOTFILE; "
        f"else echo MISSING; fi"
    )
    result = _run_ssh(script, timeout=60)
    out = (result.stdout or "").strip()
    if result.returncode != 0:
        raise RemoteMediaError(
            f"remote stat failed: {(result.stderr or out or result.returncode)}"
        )
    if out == "MISSING":
        raise FileNotFoundError(safe)
    if out == "NOTFILE":
        raise RemoteMediaError(f"Remote path exists but is not a file: {safe}")
    try:
        size = int(out.splitlines()[-1].strip())
    except ValueError as exc:
        raise RemoteMediaError(f"Unexpected remote stat output: {out}") from exc
    return RemoteStat(path=safe, size=size, is_file=True)


def remote_exists(path: str) -> bool:
    try:
        remote_stat(path)
        return True
    except FileNotFoundError:
        return False


def remote_mkdir_parent(path: str) -> None:
    safe = assert_under_allowlist(path)
    parent = os.path.dirname(safe)
    if not parent or parent == "/":
        return
    assert_under_allowlist(parent)
    quoted = shlex.quote(parent)
    result = _run_ssh(f"mkdir -p {quoted}", timeout=60)
    if result.returncode != 0:
        raise RemoteMediaError(
            f"remote mkdir failed: {(result.stderr or result.stdout or '').strip()}"
        )


def sftp_get(remote_path: str, local_path: str) -> RemoteStat:
    info = remote_stat(remote_path)
    os.makedirs(os.path.dirname(local_path) or ".", exist_ok=True)
    if os.path.exists(local_path):
        os.remove(local_path)
    _run_scp(local_path, info.path, upload=False, timeout=7200)
    if not os.path.isfile(local_path):
        raise RemoteMediaError(f"Download missing local file: {local_path}")
    local_size = os.path.getsize(local_path)
    if local_size != info.size:
        raise RemoteMediaError(
            f"Download size mismatch: local={local_size} remote={info.size}"
        )
    return info


def sftp_put(local_path: str, remote_path: str) -> RemoteStat:
    if not os.path.isfile(local_path):
        raise FileNotFoundError(local_path)
    safe = assert_under_allowlist(remote_path)
    remote_mkdir_parent(safe)
    _run_scp(local_path, safe, upload=True, timeout=7200)
    return remote_stat(safe)


def local_sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def remote_sha256(path: str) -> str:
    safe = assert_under_allowlist(path)
    quoted = shlex.quote(safe)
    result = _run_ssh(f"sha256sum -b {quoted}", timeout=600)
    if result.returncode != 0:
        raise RemoteMediaError(
            f"remote sha256 failed: {(result.stderr or result.stdout or '').strip()}"
        )
    line = (result.stdout or "").strip().splitlines()[0]
    digest = line.split()[0].strip()
    if len(digest) != 64:
        raise RemoteMediaError(f"Unexpected sha256 output: {line}")
    return digest.lower()


def verify_remote_matches_local(local_path: str, remote_path: str) -> None:
    local_size = os.path.getsize(local_path)
    remote = remote_stat(remote_path)
    if remote.size != local_size:
        raise RemoteMediaError(
            f"Remote size mismatch after upload: local={local_size} remote={remote.size}"
        )
    local_hash = local_sha256(local_path)
    remote_hash = remote_sha256(remote_path)
    if local_hash != remote_hash:
        raise RemoteMediaError(
            f"Remote checksum mismatch: local={local_hash} remote={remote_hash}"
        )


def remote_rm_file(path: str) -> None:
    safe = assert_under_allowlist(path)
    quoted = shlex.quote(safe)
    # Single file only — never recursive.
    script = (
        f"if [ ! -e {quoted} ]; then exit 0; fi; "
        f"if [ ! -f {quoted} ]; then echo 'not a file' >&2; exit 2; fi; "
        f"rm -f -- {quoted}"
    )
    result = _run_ssh(script, timeout=120)
    if result.returncode != 0:
        raise RemoteMediaError(
            f"remote rm failed: {(result.stderr or result.stdout or '').strip()}"
        )


def remote_mv(src: str, dst: str) -> None:
    src_safe = assert_under_allowlist(src)
    dst_safe = assert_under_allowlist(dst)
    remote_mkdir_parent(dst_safe)
    src_q = shlex.quote(src_safe)
    dst_q = shlex.quote(dst_safe)
    script = (
        f"if [ ! -f {src_q} ]; then echo 'src missing' >&2; exit 2; fi; "
        f"mv -f -- {src_q} {dst_q}"
    )
    result = _run_ssh(script, timeout=120)
    if result.returncode != 0:
        raise RemoteMediaError(
            f"remote mv failed: {(result.stderr or result.stdout or '').strip()}"
        )


def probe_remote_root_writable(root_key: str) -> tuple[bool, str]:
    root = REMOTE_SOURCE_ROOTS.get(root_key)
    if not root:
        return False, f"Unknown rootKey: {root_key}"
    try:
        root_n = normalize_remote_path(root)
        assert_under_allowlist(root_n, [root_n])
        probe = f"{root_n}/.mn-converter-write-test"
        assert_under_allowlist(probe, [root_n])
        probe_q = shlex.quote(probe)
        root_q = shlex.quote(root_n)
        script = (
            f"if [ ! -d {root_q} ]; then echo 'missing root' >&2; exit 2; fi; "
            f"echo ok > {probe_q} && rm -f -- {probe_q} && echo WRITABLE"
        )
        result = _run_ssh(script, timeout=60)
        if result.returncode != 0 or "WRITABLE" not in (result.stdout or ""):
            return False, (result.stderr or result.stdout or "not writable").strip()
        return True, root_n
    except (RemoteMediaError, OSError, subprocess.TimeoutExpired) as exc:
        return False, str(exc)


def probe_remote_output_writable(mode: str) -> tuple[bool, str]:
    root = remote_output_root_for_mode(mode)
    try:
        probe = f"{root}/.mn-converter-write-test"
        assert_under_allowlist(probe, [root])
        probe_q = shlex.quote(probe)
        root_q = shlex.quote(root)
        script = (
            f"mkdir -p {root_q} && echo ok > {probe_q} && rm -f -- {probe_q} && echo WRITABLE"
        )
        result = _run_ssh(script, timeout=60)
        if result.returncode != 0 or "WRITABLE" not in (result.stdout or ""):
            return False, (result.stderr or result.stdout or "not writable").strip()
        return True, root
    except (RemoteMediaError, OSError, subprocess.TimeoutExpired) as exc:
        return False, str(exc)


def check_all_remote_roots_writable() -> Dict[str, bool]:
    return {key: probe_remote_root_writable(key)[0] for key in REMOTE_SOURCE_ROOTS}
