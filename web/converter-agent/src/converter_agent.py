#!/usr/bin/env python3
"""HTTP agent for Movie Night Manager — HandBrake conversions in Docker."""

from __future__ import annotations

import os
import json
import re
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import (  # noqa: E402
    AGENT_ENABLED,
    AGENT_HOST,
    AGENT_PORT,
    BUNNY_CDN_HOSTNAME,
    BUNNY_STORAGE_HOST,
    BUNNY_STORAGE_PASSWORD,
    BUNNY_STORAGE_PREFIX,
    BUNNY_STORAGE_ZONE,
    DEFAULT_PRESET,
    HANDBRAKE_ENCODER,
    HANDBRAKE_PATH,
    JOB_HISTORY_PATH,
    LOG_FILE,
    MAX_JOB_HISTORY,
    MAX_LOG_LINES,
    MAX_PERSISTED_LOG_LINES,
    REMOTE_SOURCE_ROOTS,
    REPLACE_MIN_SAVINGS_RATIO,
    SUPPORTED_FORMATS,
    WORK_ROOT,
    PresetConfig,
    apply_tuning,
    build_handbrake_options_with_tuning,
    build_summary_for_tuning,
    check_nvenc_available,
    estimate_size_ratio,
    get_preset,
    get_preset_detail,
    is_forbidden_local_library_path,
    list_presets,
    pick_container_from_tuning,
    probe_output_track_counts,
    resolve_movies_output_dir,
    resolve_remote_movies_output_dir,
    resolve_remote_output_dir_for_mode,
    resolve_remote_tv_output_dir,
    resolve_tv_output_dir,
    validate_tuning,
)
from remote_media import (  # noqa: E402
    RemoteMediaError,
    check_all_remote_roots_writable,
    probe_remote_output_writable,
    probe_remote_root_writable,
    remote_bridge_configured,
    remote_exists,
    remote_mv,
    remote_rm_file,
    remote_stat,
    resolve_remote_source_path,
    sftp_get,
    sftp_put,
    ssh_reachable,
    verify_remote_matches_local,
)

try:
    from fastapi import FastAPI, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel
    import uvicorn
except ImportError as exc:
    print("Missing dependencies. Install with: pip install fastapi uvicorn")
    raise SystemExit(1) from exc


AGENT_VERSION = "2.2.0"
LOG_LINE_LIMIT = MAX_LOG_LINES
JobStatus = str


def safe_local_remove(path: str) -> None:
    """Remove a local work file; refuse Samba/host library mounts."""
    if not path or not os.path.exists(path):
        return
    if is_forbidden_local_library_path(path):
        raise PermissionError(
            f"Refusing to delete forbidden library path: {path}"
        )
    # Extra belt: only allow deletes under WORK_ROOT
    work = os.path.normpath(WORK_ROOT)
    abs_path = os.path.normpath(os.path.abspath(path))
    if abs_path != work and not abs_path.startswith(work + os.sep):
        raise PermissionError(
            f"Refusing to delete path outside WORK_ROOT: {path}"
        )
    os.remove(path)


def safe_local_rename(src: str, dst: str) -> None:
    if is_forbidden_local_library_path(src) or is_forbidden_local_library_path(dst):
        raise PermissionError("Refusing rename involving forbidden library path")
    work = os.path.normpath(WORK_ROOT)
    for path in (src, dst):
        abs_path = os.path.normpath(os.path.abspath(path))
        if abs_path != work and not abs_path.startswith(work + os.sep):
            raise PermissionError(
                f"Refusing rename outside WORK_ROOT: {path}"
            )
    os.rename(src, dst)

ENABLED_STATE_PATH = os.environ.get(
    "AGENT_ENABLED_STATE_PATH", "/data/converter-agent-enabled.json"
)
WRITABLE_CACHE_TTL_SEC = float(os.environ.get("WRITABLE_CACHE_TTL_SEC", "60"))
WRITABLE_PROBE_TIMEOUT_SEC = float(os.environ.get("WRITABLE_PROBE_TIMEOUT_SEC", "5"))
# Keep last successful write probe briefly so CIFS blips do not flap "offline".
WRITABLE_STALE_OK_SEC = float(os.environ.get("WRITABLE_STALE_OK_SEC", "300"))

_writable_cache: Dict[str, tuple[bool, str, float, float]] = {}
# value: (ok, detail, success_at, last_probe_at)
_writable_cache_lock = threading.Lock()


def _load_persisted_enabled(default: bool) -> bool:
    try:
        with open(ENABLED_STATE_PATH, encoding="utf-8") as handle:
            payload = json.load(handle)
        if isinstance(payload, dict) and isinstance(payload.get("enabled"), bool):
            return payload["enabled"]
    except (OSError, json.JSONDecodeError, TypeError):
        pass
    return default


def _persist_enabled(enabled: bool) -> None:
    directory = os.path.dirname(ENABLED_STATE_PATH)
    if directory:
        os.makedirs(directory, exist_ok=True)
    temp_path = f"{ENABLED_STATE_PATH}.tmp"
    try:
        with open(temp_path, "w", encoding="utf-8") as handle:
            json.dump(
                {
                    "enabled": enabled,
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                },
                handle,
                indent=2,
            )
        os.replace(temp_path, ENABLED_STATE_PATH)
    except OSError:
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except OSError:
            pass


class AgentState:
    def __init__(self, initially_enabled: bool) -> None:
        self._enabled = initially_enabled
        self._lock = threading.Lock()

    def is_enabled(self) -> bool:
        with self._lock:
            return self._enabled

    def enable(self) -> None:
        with self._lock:
            self._enabled = True
        _persist_enabled(True)

    def disable(self) -> None:
        with self._lock:
            self._enabled = False
        _persist_enabled(False)


agent_state = AgentState(_load_persisted_enabled(AGENT_ENABLED))


@dataclass
class Job:
    id: str
    title: str
    video_file: str
    root_key: str
    source_path: str
    output_dir: str
    output_path: str
    mode: str = "jellyfin"
    preset: str = DEFAULT_PRESET
    tuning: Optional[Dict[str, Any]] = None
    source_size_bytes: int = 0
    bytes_saved: Optional[int] = None
    final_output_path: Optional[str] = None
    remote_source_path: Optional[str] = None
    remote_temp_path: Optional[str] = None
    remote_final_path: Optional[str] = None
    work_dir: Optional[str] = None
    source_duration_sec: float = 0.0
    source_fps: float = 24.0
    status: JobStatus = "queued"
    percent: float = 0.0
    eta: Optional[str] = None
    fps: Optional[str] = None
    elapsed_sec: float = 0.0
    log_lines: Deque[str] = field(default_factory=lambda: deque(maxlen=LOG_LINE_LIMIT))
    error: Optional[str] = None
    output_size_bytes: Optional[int] = None
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    process: Any = None
    cancel_requested: bool = False

    def append_log(self, line: str) -> None:
        stripped = line.rstrip("\r\n")
        if stripped:
            self.log_lines.append(stripped)

    def to_dict(self, include_logs: bool = True) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "id": self.id,
            "title": self.title,
            "videoFile": self.video_file,
            "rootKey": self.root_key,
            "sourcePath": self.source_path,
            "remoteSourcePath": self.remote_source_path,
            "remoteTempPath": self.remote_temp_path,
            "remoteFinalPath": self.remote_final_path,
            "workDir": self.work_dir,
            "outputDir": self.output_dir,
            "outputPath": self.output_path,
            "mode": self.mode,
            "preset": self.preset,
            "tuning": self.tuning,
            "sourceSizeBytes": self.source_size_bytes or None,
            "bytesSaved": self.bytes_saved,
            "status": self.status,
            "percent": self.percent,
            "eta": self.eta,
            "fps": self.fps,
            "elapsedSec": round(self.elapsed_sec, 1),
            "error": self.error,
            "outputSizeBytes": self.output_size_bytes,
            "startedAt": (
                datetime.fromtimestamp(self.started_at, tz=timezone.utc).isoformat()
                if self.started_at
                else None
            ),
            "finishedAt": (
                datetime.fromtimestamp(self.finished_at, tz=timezone.utc).isoformat()
                if self.finished_at
                else None
            ),
        }
        if include_logs:
            payload["logLines"] = list(self.log_lines)
        return payload

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Job":
        log_lines = deque(
            (data.get("logLines") or [])[-LOG_LINE_LIMIT:],
            maxlen=LOG_LINE_LIMIT,
        )

        def parse_ts(value: Any) -> Optional[float]:
            if not value or not isinstance(value, str):
                return None
            try:
                return datetime.fromisoformat(
                    value.replace("Z", "+00:00")
                ).timestamp()
            except ValueError:
                return None

        return cls(
            id=str(data["id"]),
            title=str(data.get("title") or ""),
            video_file=str(data.get("videoFile") or ""),
            root_key=str(data.get("rootKey") or ""),
            source_path=str(data.get("sourcePath") or ""),
            output_dir=str(data.get("outputDir") or ""),
            output_path=str(data.get("outputPath") or ""),
            mode=str(data.get("mode") or "jellyfin"),
            preset=str(data.get("preset") or DEFAULT_PRESET),
            tuning=data.get("tuning"),
            source_size_bytes=int(data.get("sourceSizeBytes") or 0),
            bytes_saved=data.get("bytesSaved"),
            final_output_path=data.get("finalOutputPath"),
            remote_source_path=data.get("remoteSourcePath"),
            remote_temp_path=data.get("remoteTempPath"),
            remote_final_path=data.get("remoteFinalPath"),
            work_dir=data.get("workDir"),
            source_duration_sec=float(data.get("sourceDurationSec") or 0.0),
            source_fps=float(data.get("sourceFps") or 24.0),
            status=str(data.get("status") or "done"),
            percent=float(data.get("percent") or 0.0),
            eta=data.get("eta"),
            fps=data.get("fps"),
            elapsed_sec=float(data.get("elapsedSec") or 0.0),
            log_lines=log_lines,
            error=data.get("error"),
            output_size_bytes=data.get("outputSizeBytes"),
            started_at=parse_ts(data.get("startedAt")),
            finished_at=parse_ts(data.get("finishedAt")),
        )


class EncodingTuning(BaseModel):
    quality: Optional[int] = None
    encoder: Optional[str] = None
    resolutionMode: Optional[str] = None
    audioBitrate: Optional[int] = None
    audioTrack: Optional[int] = None
    keepAllAudio: Optional[bool] = None
    keepSubtitles: Optional[bool] = None
    container: Optional[str] = None


class CreateJobRequest(BaseModel):
    title: str
    videoFile: str
    rootKey: str
    overwrite: bool = False
    mode: str = "jellyfin"
    preset: str = DEFAULT_PRESET
    tuning: Optional[EncodingTuning] = None
    # Relative dir under the source root when source folders omit year/etc.
    sourceTitle: Optional[str] = None


class PresetPreviewRequest(BaseModel):
    tuning: Optional[EncodingTuning] = None


class CheckOutputRequest(BaseModel):
    title: str
    videoFile: str
    mode: str = "jellyfin"


class BunnyUploadRequest(BaseModel):
    relativePath: str
    overwrite: bool = False


class DisableRequest(BaseModel):
    cancelActive: bool = True


@dataclass
class BunnyUploadJob:
    id: str
    filename: str
    relative_path: str
    source_path: str
    status: JobStatus = "queued"
    percent: float = 0.0
    bytes_sent: int = 0
    total_bytes: int = 0
    elapsed_sec: float = 0.0
    cdn_url: Optional[str] = None
    error: Optional[str] = None
    log_lines: Deque[str] = field(default_factory=lambda: deque(maxlen=LOG_LINE_LIMIT))
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    cancel_requested: bool = False

    def append_log(self, line: str) -> None:
        stripped = line.rstrip("\r\n")
        if stripped:
            self.log_lines.append(stripped)

    def to_dict(self, include_logs: bool = True) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "id": self.id,
            "filename": self.filename,
            "relativePath": self.relative_path,
            "sourcePath": self.source_path,
            "status": self.status,
            "percent": self.percent,
            "bytesSent": self.bytes_sent,
            "totalBytes": self.total_bytes,
            "elapsedSec": round(self.elapsed_sec, 1),
            "cdnUrl": self.cdn_url,
            "error": self.error,
        }
        if include_logs:
            payload["logLines"] = list(self.log_lines)
        return payload


class BunnyUploadManager:
    def __init__(self) -> None:
        self.jobs: Dict[str, BunnyUploadJob] = {}
        self.lock = threading.Lock()
        self.worker_lock = threading.Lock()
        self.active_job_id: Optional[str] = None

    def is_configured(self) -> bool:
        return bool(BUNNY_STORAGE_ZONE and BUNNY_STORAGE_PASSWORD)

    def build_cdn_url(self, filename: str) -> str:
        from urllib.parse import quote

        host = BUNNY_CDN_HOSTNAME.replace("https://", "").replace("http://", "")
        return f"https://{host}/{BUNNY_STORAGE_PREFIX}/{quote(filename)}"

    def build_storage_url(self, filename: str) -> str:
        from urllib.parse import quote

        path = f"{BUNNY_STORAGE_PREFIX}/{filename}"
        segments = "/".join(quote(part) for part in path.split("/"))
        return f"https://{BUNNY_STORAGE_HOST}/{BUNNY_STORAGE_ZONE}/{segments}"

    def scan_jellyfin_library(self) -> List[Dict[str, Any]]:
        root = resolve_movies_output_dir()
        results: List[Dict[str, Any]] = []
        if not os.path.isdir(root):
            return results

        for dirpath, _, filenames in os.walk(root):
            for name in filenames:
                if not name.lower().endswith(".mp4"):
                    continue
                full_path = os.path.join(dirpath, name)
                rel = os.path.relpath(full_path, root)
                title = os.path.basename(dirpath)
                try:
                    size = os.path.getsize(full_path)
                    mtime = os.path.getmtime(full_path)
                except OSError:
                    size = 0
                    mtime = 0
                results.append(
                    {
                        "title": title,
                        "relativePath": rel.replace("\\", "/"),
                        "filename": name,
                        "sizeBytes": size,
                        "fullPath": full_path,
                        "modifiedAt": datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
                        if mtime
                        else "",
                    }
                )

        return results

    def resolve_jellyfin_path(self, relative_path: str) -> str:
        root = resolve_movies_output_dir()
        normalized = relative_path.replace("\\", "/").lstrip("/")
        full = os.path.normpath(os.path.join(root, normalized.replace("/", os.sep)))
        root_norm = os.path.normpath(root)
        if not full.startswith(root_norm):
            raise ValueError("Invalid jellyfin path")
        return full

    def create_upload(self, req: BunnyUploadRequest) -> BunnyUploadJob:
        if not self.is_configured():
            raise ValueError("Bunny storage is not configured on the agent")

        source_path = self.resolve_jellyfin_path(req.relativePath)
        if not os.path.isfile(source_path):
            raise FileNotFoundError(f"Source file not found: {source_path}")

        filename = os.path.basename(source_path)
        job = BunnyUploadJob(
            id=str(uuid.uuid4()),
            filename=filename,
            relative_path=req.relativePath.replace("\\", "/"),
            source_path=source_path,
            total_bytes=os.path.getsize(source_path),
            cdn_url=self.build_cdn_url(filename),
        )

        with self.lock:
            self.jobs[job.id] = job

        threading.Thread(
            target=self._run_upload,
            args=(job.id, req.overwrite),
            daemon=True,
        ).start()
        return job

    def get_job(self, job_id: str) -> Optional[BunnyUploadJob]:
        return self.jobs.get(job_id)

    def cancel_active(self) -> None:
        with self.worker_lock:
            active_id = self.active_job_id
        if not active_id:
            return
        job = self.jobs.get(active_id)
        if job and job.status in ("queued", "running"):
            job.cancel_requested = True

    def clear_jobs(self) -> None:
        with self.lock:
            self.jobs.clear()

    def _acquire_worker_slot(self, job_id: str) -> None:
        while True:
            with self.worker_lock:
                if self.active_job_id is None:
                    self.active_job_id = job_id
                    return
            time.sleep(0.25)

    def _run_upload(self, job_id: str, overwrite: bool) -> None:
        import http.client
        import urllib.error
        import urllib.request
        from urllib.parse import urlparse

        self._acquire_worker_slot(job_id)

        job = self.jobs[job_id]
        temp_remux_path: Optional[str] = None
        try:
            job.status = "running"
            job.started_at = time.time()
            upload_path, temp_remux_path = _remux_mp4_faststart(job.source_path, job)
            job.total_bytes = os.path.getsize(upload_path)
            url = self.build_storage_url(job.filename)
            job.append_log(f"Uploading {job.filename} to Bunny")
            job.append_log(f"PUT {url}")

            if not overwrite:
                check_req = urllib.request.Request(url, method="GET")
                check_req.add_header("AccessKey", BUNNY_STORAGE_PASSWORD)
                try:
                    urllib.request.urlopen(check_req, timeout=30)
                    raise FileExistsError(f"File already exists on Bunny: {job.filename}")
                except urllib.error.HTTPError as exc:
                    if exc.code != 404:
                        raise

            parsed = urlparse(url)
            conn = http.client.HTTPSConnection(parsed.hostname, timeout=3600)
            conn.putrequest("PUT", parsed.path or "/")
            conn.putheader("AccessKey", BUNNY_STORAGE_PASSWORD)
            conn.putheader("Content-Type", "video/mp4")
            conn.putheader("Content-Length", str(job.total_bytes))
            conn.endheaders()

            job.bytes_sent = 0
            with open(upload_path, "rb") as handle:
                while True:
                    if job.cancel_requested:
                        break
                    chunk = handle.read(1024 * 1024)
                    if not chunk:
                        break
                    conn.send(chunk)
                    job.bytes_sent += len(chunk)
                    if job.total_bytes > 0:
                        job.percent = min(99.9, (job.bytes_sent / job.total_bytes) * 100)
                    if job.started_at:
                        job.elapsed_sec = time.time() - job.started_at

            if job.cancel_requested:
                job.status = "cancelled"
                job.error = "Upload cancelled"
                job.finished_at = time.time()
                return

            response = conn.getresponse()
            response.read()
            if response.status >= 400:
                raise RuntimeError(f"Bunny upload failed with status {response.status}")

            job.status = "done"
            job.percent = 100.0
            job.bytes_sent = job.total_bytes
            job.finished_at = time.time()
            if job.started_at:
                job.elapsed_sec = job.finished_at - job.started_at
            job.append_log(f"SUCCESS: {job.cdn_url}")
        except Exception as exc:
            job.status = "failed"
            job.error = str(exc)
            job.finished_at = time.time()
            job.append_log(f"ERROR: {exc}")
        finally:
            if temp_remux_path and os.path.exists(temp_remux_path):
                try:
                    os.remove(temp_remux_path)
                except OSError:
                    pass
            with self.worker_lock:
                if self.active_job_id == job_id:
                    self.active_job_id = None


bunny_manager = BunnyUploadManager()


def _mp4_needs_faststart(path: str, scan_bytes: int = 4 * 1024 * 1024) -> bool:
    try:
        with open(path, "rb") as handle:
            return b"moov" not in handle.read(scan_bytes)
    except OSError:
        return False


def _remux_mp4_faststart(source_path: str, job: BunnyUploadJob) -> tuple[str, Optional[str]]:
    if not source_path.lower().endswith(".mp4"):
        return source_path, None
    if not _mp4_needs_faststart(source_path):
        job.append_log("MP4 already optimized for web streaming")
        return source_path, None

    temp_path = f"{source_path}.cdn-faststart.tmp.mp4"
    job.append_log("Remuxing MP4 with faststart for browser/CDN playback...")
    result = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            source_path,
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            temp_path,
        ],
        capture_output=True,
        text=True,
        timeout=7200,
        check=False,
    )
    if result.returncode != 0:
        stderr = (result.stderr or "").strip()
        raise RuntimeError(
            f"ffmpeg faststart remux failed: {stderr or result.returncode}"
        )
    job.append_log("Faststart remux complete")
    return temp_path, temp_path


def probe_track_counts(source_path: str) -> tuple[int, int]:
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type",
                "-of",
                "csv=p=0",
                source_path,
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        if result.returncode != 0:
            return 1, 0
        audio = 0
        subs = 0
        for line in (result.stdout or "").splitlines():
            kind = line.strip().lower()
            if kind == "audio":
                audio += 1
            elif kind == "subtitle":
                subs += 1
        return max(audio, 0), max(subs, 0)
    except (OSError, subprocess.TimeoutExpired):
        return 1, 0


def list_source_audio_codecs(source_path: str) -> List[str]:
    """Return audio codecs in HandBrake track order (file order)."""
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "a",
                "-show_entries",
                "stream=codec_name,channels",
                "-of",
                "csv=p=0",
                source_path,
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        if result.returncode != 0:
            return []
        codecs: List[str] = []
        for line in (result.stdout or "").splitlines():
            parts = [part.strip() for part in line.split(",")]
            if not parts or not parts[0]:
                continue
            codecs.append(parts[0].lower())
        return codecs
    except (OSError, subprocess.TimeoutExpired):
        return []


def choose_stereo_aac_audio_track(
    source_path: str, preferred: int = 1
) -> int:
    """
    Pick a HandBrake 1-based audio track that is likely to survive AAC stereo
    re-encode. Some E-AC3 atmos/7.1 streams decode as 0 frames in HandBrake.
    """
    codecs = list_source_audio_codecs(source_path)
    if not codecs:
        return max(1, preferred)

    preferred = max(1, min(int(preferred or 1), len(codecs)))

    def score(index0: int) -> float:
        codec = codecs[index0]
        value = 0.0
        if codec in {"ac3", "aac", "mp3"}:
            value += 100
        elif codec in {"opus", "vorbis"}:
            value += 70
        elif codec in {"dts", "truehd", "dtshd"}:
            value += 30
        elif codec == "eac3":
            value += 5
        if index0 + 1 == preferred:
            value += 15
        value -= index0 * 0.1
        return value

    best = max(range(len(codecs)), key=score)
    return best + 1


def preflight_audio_track(source_path: str, track: int) -> bool:
    """Short encode to verify HandBrake can produce audio for this track."""
    tmp_dir = tempfile.mkdtemp(prefix="hb-audio-preflight-")
    out_path = os.path.join(tmp_dir, "probe.mp4")
    try:
        cmd = [
            HANDBRAKE_PATH,
            "-i",
            source_path,
            "-o",
            out_path,
            "--start-at",
            "seconds:10",
            "--stop-at",
            "seconds:4",
            "--encoder",
            HANDBRAKE_ENCODER,
            "--quality",
            "35",
            "--audio",
            str(max(1, track)),
            "--aencoder",
            "av_aac",
            "--ab",
            "128",
            "--mixdown",
            "stereo",
            "--format",
            "av_mp4",
        ]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
            check=False,
        )
        if result.returncode != 0 or not os.path.isfile(out_path):
            return False
        audio_count, _ = probe_output_track_counts(out_path)
        return audio_count > 0
    except (OSError, subprocess.TimeoutExpired):
        return False
    finally:
        try:
            if os.path.isfile(out_path):
                os.remove(out_path)
            os.rmdir(tmp_dir)
        except OSError:
            pass


_SAFE_STEREO_AAC_CODECS = frozenset({"ac3", "aac", "mp3"})
_RISKY_STEREO_AAC_CODECS = frozenset({"eac3", "truehd", "dts", "dtshd"})


def resolve_single_audio_track(
    source_path: str, preferred: int, job: "Job"
) -> int:
    codecs = list_source_audio_codecs(source_path)
    if not codecs:
        return max(1, preferred)

    preferred = max(1, min(int(preferred or 1), len(codecs)))
    chosen = choose_stereo_aac_audio_track(source_path, preferred)
    if chosen != preferred:
        job.append_log(
            f"Audio track {preferred} ({codecs[preferred - 1]}) looks risky for "
            f"AAC stereo — preferring track {chosen} ({codecs[chosen - 1]})"
        )

    chosen_codec = codecs[chosen - 1]
    if chosen_codec in _SAFE_STEREO_AAC_CODECS:
        job.append_log(
            f"Using audio track {chosen} ({chosen_codec}) for AAC stereo encode"
        )
        return chosen

    # Prefer safe codecs first, then the chosen track, then other risky ones.
    safe_tracks = [
        index
        for index, codec in enumerate(codecs, start=1)
        if codec in _SAFE_STEREO_AAC_CODECS
    ]
    other_tracks = [
        index
        for index in range(1, len(codecs) + 1)
        if index != chosen and index not in safe_tracks
    ]
    candidates = safe_tracks + [chosen] + other_tracks

    for track in candidates[:4]:
        codec = codecs[track - 1]
        if codec in _RISKY_STEREO_AAC_CODECS and safe_tracks:
            # Skip known-risky tracks when a safer alternative exists.
            continue
        job.append_log(f"Preflight audio check: track {track} ({codec})")
        if preflight_audio_track(source_path, track):
            job.append_log(f"Preflight audio OK on track {track}")
            return track
        job.append_log(f"Preflight produced no audio on track {track}")

    if safe_tracks:
        job.append_log(
            f"Falling back to safe audio track {safe_tracks[0]} ({codecs[safe_tracks[0] - 1]})"
        )
        return safe_tracks[0]

    job.append_log(
        "Audio preflight could not verify a working track — using "
        f"track {chosen}"
    )
    return chosen


def pick_output_container(
    source_path: str, preset: PresetConfig, tuning: Dict[str, Any] | None = None
) -> str:
    if tuning:
        return pick_container_from_tuning(source_path, preset, tuning)
    if preset.force_mp4:
        return ".mp4"
    audio_count, sub_count = probe_track_counts(source_path)
    if audio_count > 1 or sub_count > 0:
        return ".mkv"
    return ".mp4"


def build_handbrake_options(
    source_path: str,
    preset: PresetConfig,
    preset_id: str,
    tuning: Dict[str, Any] | None = None,
) -> List[str]:
    if tuning is not None or preset.id in ("jellyfin-library", "vrchat-stream"):
        options, _resolved = build_handbrake_options_with_tuning(
            source_path, preset_id, tuning
        )
        return options

    options = list(preset.encoding_options)
    if preset.force_mp4:
        return options
    ext = pick_output_container(source_path, preset)
    format_flag = "av_mkv" if ext == ".mkv" else "av_mp4"
    if "--format" in options:
        filtered: List[str] = []
        skip_next = False
        for item in options:
            if skip_next:
                skip_next = False
                continue
            if item == "--format":
                skip_next = True
                continue
            filtered.append(item)
        options = filtered
    return options + ["--format", format_flag]


def check_source_root_writable(root_key: str) -> tuple[bool, str]:
    """Remote Fedora root writable via SSH (not local Samba)."""
    return probe_remote_root_writable(root_key)


def check_all_source_roots_writable() -> Dict[str, bool]:
    return check_all_remote_roots_writable()


class JobManager:
    def __init__(self) -> None:
        self.jobs: Dict[str, Job] = {}
        self.history: List[str] = []
        self.lock = threading.Lock()
        self.worker_lock = threading.Lock()
        self.active_job_id: Optional[str] = None
        self._load_history()

    def _serialize_job(self, job: Job) -> Dict[str, Any]:
        record = job.to_dict(include_logs=True)
        log_lines = record.get("logLines") or []
        if isinstance(log_lines, list) and len(log_lines) > MAX_PERSISTED_LOG_LINES:
            record["logLines"] = log_lines[-MAX_PERSISTED_LOG_LINES:]
        if job.final_output_path:
            record["finalOutputPath"] = job.final_output_path
        return record

    def _load_history(self) -> None:
        path = JOB_HISTORY_PATH
        try:
            with open(path, encoding="utf-8") as handle:
                payload = json.load(handle)
        except (OSError, json.JSONDecodeError):
            return

        records = payload.get("jobs") if isinstance(payload, dict) else payload
        if not isinstance(records, list):
            return

        loaded_ids: List[str] = []
        for item in records:
            if not isinstance(item, dict) or not item.get("id"):
                continue
            job = Job.from_dict(item)
            if job.status in ("queued", "running"):
                job.status = "failed"
                job.error = "Agent restarted during conversion"
            loaded_ids.append(job.id)
            self.jobs[job.id] = job

        self.history = loaded_ids

    def _save_history(self) -> None:
        with self.lock:
            records = []
            for job_id in self.history:
                job = self.jobs.get(job_id)
                if job and job.status in ("done", "failed", "cancelled"):
                    records.append(self._serialize_job(job))
            if MAX_JOB_HISTORY > 0 and len(records) > MAX_JOB_HISTORY:
                records = records[:MAX_JOB_HISTORY]
                keep_ids = {record["id"] for record in records}
                self.history = [job_id for job_id in self.history if job_id in keep_ids]
                self.jobs = {
                    job_id: job
                    for job_id, job in self.jobs.items()
                    if job_id in keep_ids or job_id == self.active_job_id
                }

        directory = os.path.dirname(JOB_HISTORY_PATH)
        if directory:
            os.makedirs(directory, exist_ok=True)

        temp_path = f"{JOB_HISTORY_PATH}.tmp"
        try:
            with open(temp_path, "w", encoding="utf-8") as handle:
                json.dump({"jobs": records}, handle, indent=2)
            os.replace(temp_path, JOB_HISTORY_PATH)
        except OSError:
            try:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
            except OSError:
                pass

    def _persist_job(self, job: Job) -> None:
        if job.status not in ("done", "failed", "cancelled"):
            return
        self._save_history()

    def resolve_remote_source(
        self,
        root_key: str,
        title: str,
        video_file: str,
        source_title: Optional[str] = None,
    ) -> str:
        candidates = resolve_remote_source_path(
            root_key, title, video_file, source_title=source_title
        )
        last_error: Optional[Exception] = None
        for candidate in candidates:
            try:
                remote_stat(candidate)
                return candidate
            except FileNotFoundError as exc:
                last_error = exc
                continue
            except RemoteMediaError as exc:
                last_error = exc
                continue
        raise FileNotFoundError(
            f"Source file not found on Fedora: {candidates[0] if candidates else title}"
            + (f" ({last_error})" if last_error else "")
        )

    def build_local_work_paths(
        self, job_id: str, video_file: str
    ) -> tuple[str, str, str]:
        work_dir = os.path.join(WORK_ROOT, "jobs", job_id)
        source_dir = os.path.join(work_dir, "source")
        out_dir = os.path.join(work_dir, "out")
        local_source = os.path.join(source_dir, os.path.basename(video_file))
        return work_dir, local_source, out_dir

    def build_remote_jellyfin_paths(
        self, title: str, video_file: str, mode: str = "jellyfin"
    ) -> tuple[str, str]:
        stem = Path(video_file).stem
        output_filename = stem + ".mp4"
        output_root = resolve_remote_output_dir_for_mode(mode)
        remote_dir = f"{output_root.rstrip('/')}/{title.strip('/')}"
        remote_path = f"{remote_dir}/{output_filename}"
        return remote_dir, remote_path

    def check_output(
        self, title: str, video_file: str, mode: str = "jellyfin"
    ) -> Dict[str, Any]:
        _, remote_path = self.build_remote_jellyfin_paths(title, video_file, mode)
        try:
            info = remote_stat(remote_path)
            return {
                "exists": True,
                "outputPath": remote_path,
                "outputSizeBytes": info.size,
            }
        except FileNotFoundError:
            return {
                "exists": False,
                "outputPath": remote_path,
                "outputSizeBytes": None,
            }
        except RemoteMediaError as exc:
            return {
                "exists": False,
                "outputPath": remote_path,
                "outputSizeBytes": None,
                "error": str(exc),
            }

    def _resolve_job_tuning(self, req: CreateJobRequest) -> Dict[str, Any] | None:
        overrides: Dict[str, Any] | None = None
        if req.tuning is not None:
            overrides = req.tuning.model_dump(exclude_none=True)
        if not overrides:
            return None
        resolved = validate_tuning(req.preset, overrides)
        encoder = resolved.get("encoder", "")
        if "nvenc" in encoder.lower() and not check_nvenc_available():
            raise ValueError(f"Encoder {encoder} requires NVENC, which is not available")
        return resolved

    def create_job(self, req: CreateJobRequest) -> Job:
        mode = req.mode if req.mode in ("jellyfin", "replace", "tv") else "jellyfin"
        preset = get_preset(req.preset)
        if mode not in preset.allowed_modes:
            raise ValueError(
                f"Preset {req.preset} is not allowed for mode {mode}"
            )

        configured, bridge_detail = remote_bridge_configured()
        if not configured:
            raise PermissionError(
                f"Remote media bridge not configured: {bridge_detail}"
            )

        resolved_tuning = self._resolve_job_tuning(req)

        remote_source = self.resolve_remote_source(
            req.rootKey,
            req.title,
            req.videoFile,
            source_title=req.sourceTitle,
        )
        remote_info = remote_stat(remote_source)
        ext = Path(remote_source).suffix.lower()
        if ext not in SUPPORTED_FORMATS:
            raise ValueError(f"Unsupported format: {ext}")

        source_size = remote_info.size
        job_id = str(uuid.uuid4())
        work_dir, local_source, local_out_dir = self.build_local_work_paths(
            job_id, req.videoFile
        )

        # Duration/fps probed after pull in the worker (source not local yet).
        source_duration_sec = 0.0
        source_fps = 24.0

        if mode == "replace":
            writable, detail = check_source_root_writable(req.rootKey)
            if not writable:
                raise PermissionError(
                    f"Fedora source root not writable for replace mode: {detail}"
                )
            # Container/ext chosen after local pull when auto container needs probe.
            # Use source extension as placeholder; worker may adjust after pull.
            stem = Path(req.videoFile).stem
            placeholder_ext = ext if ext in (".mkv", ".mp4") else ".mkv"
            local_temp = os.path.join(
                local_out_dir, f"{stem}.converting{placeholder_ext}"
            )
            remote_dir = os.path.dirname(remote_source).replace("\\", "/")
            remote_temp = f"{remote_dir}/{stem}.converting{placeholder_ext}"
            remote_final = f"{remote_dir}/{stem}{placeholder_ext}"
            if remote_final != remote_source and remote_exists(remote_final):
                raise FileExistsError(remote_final)
            output_dir = local_out_dir
            output_path = local_temp
            final_path = local_temp
        else:
            remote_dir, remote_final = self.build_remote_jellyfin_paths(
                req.title, req.videoFile, mode
            )
            if remote_exists(remote_final) and not req.overwrite:
                raise FileExistsError(remote_final)
            remote_temp = None
            stem = Path(req.videoFile).stem
            output_dir = local_out_dir
            output_path = os.path.join(output_dir, f"{stem}.mp4")
            final_path = output_path

        job = Job(
            id=job_id,
            title=req.title,
            video_file=req.videoFile,
            root_key=req.rootKey,
            source_path=local_source,
            output_dir=output_dir,
            output_path=output_path,
            mode=mode,
            preset=req.preset,
            tuning=resolved_tuning,
            source_size_bytes=source_size,
            source_duration_sec=source_duration_sec,
            source_fps=source_fps,
            final_output_path=final_path if mode == "replace" else None,
            remote_source_path=remote_source,
            remote_temp_path=remote_temp,
            remote_final_path=remote_final,
            work_dir=work_dir,
        )

        with self.lock:
            self.jobs[job.id] = job
            if job.id in self.history:
                self.history.remove(job.id)
            self.history.insert(0, job.id)

        threading.Thread(target=self._run_worker, args=(job.id,), daemon=True).start()
        return job

    def get_job(self, job_id: str) -> Optional[Job]:
        job = self.jobs.get(job_id)
        if job:
            refresh_running_stats(job)
        return job

    def list_history(self) -> List[Dict[str, Any]]:
        with self.lock:
            ids = list(self.history)
        results = []
        for job_id in ids:
            job = self.jobs.get(job_id)
            if job:
                results.append(job.to_dict(include_logs=False))
        return results

    def cancel_job(self, job_id: str) -> Job:
        job = self.jobs.get(job_id)
        if not job:
            raise KeyError(job_id)
        if job.status in ("done", "failed", "cancelled"):
            return job
        job.cancel_requested = True
        if job.process and job.process.poll() is None:
            job.process.terminate()
        return job

    def cancel_active(self) -> None:
        with self.worker_lock:
            active_id = self.active_job_id
        if active_id:
            try:
                self.cancel_job(active_id)
            except KeyError:
                pass

    def clear_history(self) -> None:
        with self.lock:
            active_id = self.active_job_id
            if active_id:
                self.history = [active_id]
                active_job = self.jobs.get(active_id)
                self.jobs = {active_id: active_job} if active_job else {}
            else:
                self.history.clear()
                self.jobs.clear()
        self._save_history()

    def remove_history_entry(self, job_id: str) -> None:
        with self.lock:
            if job_id not in self.history:
                raise KeyError(job_id)
            if self.active_job_id == job_id:
                raise ValueError("Cannot remove the active conversion job")
            self.history = [entry_id for entry_id in self.history if entry_id != job_id]
            self.jobs.pop(job_id, None)
        self._save_history()

    def _acquire_worker_slot(self, job_id: str) -> None:
        while True:
            with self.worker_lock:
                if self.active_job_id is None:
                    self.active_job_id = job_id
                    return
            time.sleep(0.25)

    def _run_worker(self, job_id: str) -> None:
        self._acquire_worker_slot(job_id)

        job = self.jobs[job_id]
        temp_output_path = job.output_path
        try:
            if not os.path.isfile(HANDBRAKE_PATH):
                raise FileNotFoundError(f"HandBrakeCLI not found at {HANDBRAKE_PATH}")
            if not job.remote_source_path:
                raise RemoteMediaError("Job missing remote_source_path")

            job.status = "running"
            job.started_at = time.time()
            os.makedirs(job.output_dir, exist_ok=True)
            os.makedirs(os.path.dirname(job.source_path), exist_ok=True)

            job.append_log(f"PULL: {job.remote_source_path}")
            sftp_get(job.remote_source_path, job.source_path)
            job.append_log(
                f"PULL complete ({os.path.getsize(job.source_path)} bytes) → {job.source_path}"
            )

            job.source_duration_sec, job.source_fps = probe_source_timing(
                job.source_path
            )

            preset = get_preset(job.preset)
            tuning = dict(job.tuning) if job.tuning else {}
            keep_all_audio = bool(tuning.get("keepAllAudio", False))
            uses_single_track = (
                job.preset in ("jellyfin-library", "vrchat-stream")
                or (tuning and not keep_all_audio)
            )
            if uses_single_track:
                preferred_track = int(tuning.get("audioTrack", 1) or 1)
                selected_track = resolve_single_audio_track(
                    job.source_path, preferred_track, job
                )
                tuning["audioTrack"] = selected_track
                tuning["keepAllAudio"] = False
                job.tuning = tuning

            # Finalize local/remote replace filenames now that source is local.
            if job.mode == "replace":
                stem = Path(job.video_file).stem
                ext = pick_output_container(
                    job.source_path, preset, job.tuning
                )
                temp_output_path = os.path.join(
                    job.output_dir, f"{stem}.converting{ext}"
                )
                job.output_path = temp_output_path
                job.final_output_path = temp_output_path
                remote_dir = os.path.dirname(job.remote_source_path).replace("\\", "/")
                job.remote_temp_path = f"{remote_dir}/{stem}.converting{ext}"
                job.remote_final_path = f"{remote_dir}/{stem}{ext}"

            encoding_options = build_handbrake_options(
                job.source_path, preset, job.preset, job.tuning
            )

            if os.path.exists(temp_output_path):
                safe_local_remove(temp_output_path)

            cmd = (
                [HANDBRAKE_PATH, "-i", job.source_path, "-o", temp_output_path]
                + encoding_options
            )
            job.append_log(f"ENCODE: {job.title}")
            job.append_log(f"Mode: {job.mode}, Preset: {job.preset}")
            if job.tuning:
                job.append_log(f"Tuning: {json.dumps(job.tuning)}")
            job.append_log(f"Command: {' '.join(cmd)}")

            job.process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )

            assert job.process.stdout is not None
            for line in job.process.stdout:
                if job.cancel_requested:
                    break
                job.append_log(line)
                parse_progress_line(job, line)
                if job.started_at:
                    job.elapsed_sec = time.time() - job.started_at

            if job.cancel_requested:
                if job.process.poll() is None:
                    job.process.kill()
                if os.path.exists(temp_output_path):
                    try:
                        safe_local_remove(temp_output_path)
                    except OSError:
                        pass
                job.status = "cancelled"
                job.error = "Conversion cancelled"
                job.finished_at = time.time()
                return

            return_code = job.process.wait()
            job.finished_at = time.time()
            if job.started_at:
                job.elapsed_sec = job.finished_at - job.started_at

            if return_code != 0 or not os.path.isfile(temp_output_path):
                job.status = "failed"
                log_text = "\n".join(job.log_lines).lower()
                if return_code == 0 and not os.path.isfile(temp_output_path):
                    if "unknown option" in log_text:
                        job.error = (
                            "HandBrake rejected CLI options — check resolution "
                            "or encoder settings in the log"
                        )
                    else:
                        job.error = (
                            "HandBrake finished but the output file was not created"
                        )
                else:
                    job.error = f"HandBrake exited with code {return_code}"
                job.append_log(job.error)
                if os.path.exists(temp_output_path):
                    try:
                        safe_local_remove(temp_output_path)
                    except OSError:
                        pass
                return

            output_size = os.path.getsize(temp_output_path)
            if output_size < 1_048_576:
                job.status = "failed"
                job.error = "Output file too small — original kept"
                job.append_log(job.error)
                try:
                    safe_local_remove(temp_output_path)
                except OSError:
                    pass
                return

            audio_count, _sub_count = probe_output_track_counts(temp_output_path)
            if audio_count == 0:
                job.status = "failed"
                job.error = (
                    "Output has no audio tracks — check source audio language/tags "
                    "and preset audio selection"
                )
                job.append_log(job.error)
                try:
                    safe_local_remove(temp_output_path)
                except OSError:
                    pass
                return

            if job.mode == "replace":
                threshold = job.source_size_bytes * REPLACE_MIN_SAVINGS_RATIO
                if output_size >= threshold:
                    job.status = "failed"
                    job.error = (
                        "Output not smaller enough — original kept "
                        f"({output_size} >= {threshold:.0f} bytes)"
                    )
                    job.append_log(job.error)
                    try:
                        safe_local_remove(temp_output_path)
                    except OSError:
                        pass
                    return

                if not job.remote_temp_path or not job.remote_final_path:
                    raise RemoteMediaError("Missing remote replace paths")

                job.append_log(f"PUBLISH: {job.remote_temp_path}")
                sftp_put(temp_output_path, job.remote_temp_path)
                verify_remote_matches_local(temp_output_path, job.remote_temp_path)
                job.append_log("PUBLISH verified (size + sha256)")

                # Replace on Fedora only — never os.remove on Samba mounts.
                if job.remote_source_path != job.remote_final_path:
                    job.append_log(f"REMOTE RM original: {job.remote_source_path}")
                    remote_rm_file(job.remote_source_path)
                if job.remote_temp_path != job.remote_final_path:
                    job.append_log(
                        f"REMOTE MV: {job.remote_temp_path} → {job.remote_final_path}"
                    )
                    remote_mv(job.remote_temp_path, job.remote_final_path)

                job.output_path = job.remote_final_path
                job.bytes_saved = max(0, job.source_size_bytes - output_size)
                job.output_size_bytes = output_size
                job.status = "done"
                job.percent = 100.0
                job.append_log(
                    f"SUCCESS: replaced on Fedora {job.remote_final_path} "
                    f"(saved {job.bytes_saved} bytes)"
                )
                append_file_log(job)
                try:
                    safe_local_remove(temp_output_path)
                    safe_local_remove(job.source_path)
                except OSError:
                    pass
                return

            # jellyfin / tv — publish finished encode to Fedora output library
            remote_final = job.remote_final_path
            if not remote_final:
                _, remote_final = self.build_remote_jellyfin_paths(
                    job.title, job.video_file, job.mode
                )
                job.remote_final_path = remote_final

            job.append_log(f"PUBLISH: {remote_final}")
            sftp_put(temp_output_path, remote_final)
            verify_remote_matches_local(temp_output_path, remote_final)
            job.append_log("PUBLISH verified (size + sha256)")

            job.status = "done"
            job.percent = 100.0
            job.output_size_bytes = output_size
            job.output_path = remote_final
            job.append_log(f"SUCCESS: {remote_final}")
            append_file_log(job)
            try:
                safe_local_remove(temp_output_path)
                safe_local_remove(job.source_path)
            except OSError:
                pass
        except Exception as exc:
            job.status = "failed"
            job.error = str(exc)
            job.finished_at = time.time()
            job.append_log(f"ERROR: {exc}")
            if temp_output_path and os.path.exists(temp_output_path):
                try:
                    safe_local_remove(temp_output_path)
                except OSError:
                    pass
        finally:
            if job.status in ("done", "failed", "cancelled"):
                if not job.finished_at:
                    job.finished_at = time.time()
                self._persist_job(job)
            with self.worker_lock:
                if self.active_job_id == job_id:
                    self.active_job_id = None


def probe_source_timing(source_path: str) -> tuple[float, float]:
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=avg_frame_rate",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                source_path,
            ],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        if result.returncode != 0:
            return 0.0, 24.0

        payload = json.loads(result.stdout or "{}")
        duration = 0.0
        fmt = payload.get("format") or {}
        if isinstance(fmt.get("duration"), str):
            duration = float(fmt["duration"])
        elif isinstance(fmt.get("duration"), (int, float)):
            duration = float(fmt["duration"])

        fps = 24.0
        streams = payload.get("streams") or []
        if streams:
            rate = streams[0].get("avg_frame_rate", "")
            if isinstance(rate, str) and rate and rate != "0/0":
                if "/" in rate:
                    num, den = rate.split("/", 1)
                    den_val = float(den)
                    fps = float(num) / den_val if den_val else 24.0
                else:
                    fps = float(rate)

        return max(0.0, duration), max(1.0, fps)
    except (OSError, subprocess.TimeoutExpired, ValueError, json.JSONDecodeError):
        return 0.0, 24.0


def format_duration_hms(total_seconds: float) -> str:
    total = max(0, int(round(total_seconds)))
    hours, remainder = divmod(total, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours}:{minutes:02d}:{seconds:02d}"


def parse_handbrake_eta(raw: str) -> Optional[str]:
    match = re.match(r"(\d+)h(\d+)m(\d+)s", raw.strip())
    if not match:
        return None
    hours = int(match.group(1))
    minutes = int(match.group(2))
    seconds = int(match.group(3))
    return format_duration_hms(hours * 3600 + minutes * 60 + seconds)


def refresh_running_stats(job: Job) -> None:
    if job.status != "running" or not job.started_at:
        return
    elapsed = time.time() - job.started_at
    job.elapsed_sec = elapsed

    if job.percent >= 0.5:
        remaining = elapsed * (100.0 - job.percent) / job.percent
        job.eta = format_duration_hms(remaining)

    if job.source_duration_sec > 0 and elapsed >= 1.0 and job.percent > 0:
        encoded_seconds = job.source_duration_sec * (job.percent / 100.0)
        speed = encoded_seconds / elapsed
        job.fps = f"{speed * job.source_fps:.1f}"


def parse_progress_line(job: Job, line: str) -> None:
    try:
        if not re.search(r"Encoding:\s*task\s+\d+\s+of\s+\d+", line, re.I):
            return

        task_match = re.search(
            r"Encoding:\s*task\s+(\d+)\s+of\s+(\d+)",
            line,
            re.I,
        )
        percent_match = re.search(r"(\d+(?:\.\d+)?)\s*%", line)
        if task_match and percent_match:
            task_num = int(task_match.group(1))
            task_total = max(1, int(task_match.group(2)))
            local_percent = float(percent_match.group(1))
            job.percent = (
                (task_num - 1 + local_percent / 100.0) / task_total
            ) * 100.0

        fps_match = re.search(
            r"\(([\d.]+)\s*fps,\s*avg\s+([\d.]+)\s*fps",
            line,
        )
        if fps_match:
            instant = float(fps_match.group(1))
            avg = float(fps_match.group(2))
            chosen = avg if avg > 0 else instant
            if chosen > 0:
                job.fps = f"{chosen:.1f}"

        refresh_running_stats(job)
    except Exception:
        pass


def append_file_log(job: Job) -> None:
    try:
        log_dir = os.path.dirname(LOG_FILE)
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as handle:
            handle.write(f"\n[{datetime.now().isoformat()}] Web agent job {job.id}\n")
            handle.write(f"  Title: {job.title}\n")
            handle.write(f"  Output: {job.output_path}\n")
    except OSError:
        pass


def check_handbrake() -> bool:
    return os.path.isfile(HANDBRAKE_PATH)


def _probe_dir_writable(output_dir: str) -> tuple[bool, str]:
    try:
        os.makedirs(output_dir, exist_ok=True)
        test_path = os.path.join(output_dir, ".write-test")
        with open(test_path, "w", encoding="utf-8") as handle:
            handle.write("ok")
        os.remove(test_path)
        return True, output_dir
    except OSError as exc:
        return False, str(exc)


def _check_dir_writable(cache_key: str, output_dir: str) -> tuple[bool, str]:
    now = time.time()
    with _writable_cache_lock:
        cached = _writable_cache.get(cache_key)
        if cached and now - cached[3] < WRITABLE_CACHE_TTL_SEC:
            return cached[0], cached[1]

    probe_error: Optional[str] = None
    try:
        from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout

        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(_probe_dir_writable, output_dir)
            try:
                ok, detail = future.result(timeout=WRITABLE_PROBE_TIMEOUT_SEC)
            except FuturesTimeout:
                ok, detail = False, f"Write probe timed out after {WRITABLE_PROBE_TIMEOUT_SEC:.0f}s"
                probe_error = detail
            else:
                if not ok:
                    probe_error = detail
    except Exception as exc:  # noqa: BLE001 - keep health endpoint resilient
        ok, detail = False, str(exc)
        probe_error = detail

    with _writable_cache_lock:
        prior = _writable_cache.get(cache_key)

    if ok:
        entry = (True, detail, now, now)
    elif prior and prior[0] and now - prior[2] < WRITABLE_STALE_OK_SEC:
        entry = (
            True,
            f"{prior[1]} (cached; recheck failed: {probe_error or detail})",
            prior[2],
            now,
        )
    else:
        entry = (False, detail, 0.0, now)

    with _writable_cache_lock:
        _writable_cache[cache_key] = entry
    return entry[0], entry[1]


def check_output_writable() -> tuple[bool, str]:
    return probe_remote_output_writable("jellyfin")


def check_tv_output_writable() -> tuple[bool, str]:
    return probe_remote_output_writable("tv")


def build_health_payload() -> Dict[str, Any]:
    bridge_ok, bridge_detail = remote_bridge_configured()
    ssh_ok, ssh_detail = (False, "bridge not configured")
    if bridge_ok:
        ssh_ok, ssh_detail = ssh_reachable()

    writable, detail = (False, "SSH unreachable")
    tv_writable, tv_detail = (False, "SSH unreachable")
    source_writable: Dict[str, bool] = {key: False for key in REMOTE_SOURCE_ROOTS}
    if ssh_ok:
        writable, detail = check_output_writable()
        tv_writable, tv_detail = check_tv_output_writable()
        source_writable = check_all_source_roots_writable()

    work_ok, work_detail = _check_dir_writable("work-root", WORK_ROOT)
    hb = check_handbrake()
    nvenc = check_nvenc_available()
    enabled = agent_state.is_enabled()

    encoder_ok = nvenc if "nvenc" in HANDBRAKE_ENCODER.lower() else True
    remote_ok = bridge_ok and ssh_ok and work_ok
    movies_ready = enabled and hb and writable and encoder_ok and remote_ok
    tv_ready = enabled and hb and tv_writable and encoder_ok and remote_ok
    replace_ready = (
        enabled and hb and encoder_ok and remote_ok and any(source_writable.values())
    )
    ready = movies_ready or replace_ready or tv_ready

    disabled_reason: Optional[str] = None
    if not enabled:
        disabled_reason = "Agent is disabled"
    elif not hb:
        disabled_reason = "HandBrakeCLI not found"
    elif not encoder_ok:
        disabled_reason = "NVENC is not available (check GPU passthrough)"
    elif not bridge_ok:
        disabled_reason = f"Remote media bridge not configured: {bridge_detail}"
    elif not ssh_ok:
        disabled_reason = f"Fedora SSH unreachable: {ssh_detail}"
    elif not work_ok:
        disabled_reason = f"Local work dir not writable: {work_detail}"
    elif not writable and not tv_writable and not any(source_writable.values()):
        disabled_reason = f"Fedora library roots not writable: {detail}"
    elif not writable:
        disabled_reason = f"Movies Jellyfin output not writable on Fedora: {detail}"
    elif not tv_writable:
        disabled_reason = f"TV Jellyfin output not writable on Fedora: {tv_detail}"

    return {
        "ok": ready,
        "enabled": enabled,
        "version": AGENT_VERSION,
        "handbrakeFound": hb,
        "handbrakePath": HANDBRAKE_PATH,
        "handbrakeEncoder": HANDBRAKE_ENCODER,
        "nvencAvailable": nvenc,
        "moviesReady": movies_ready,
        "tvReady": tv_ready,
        "replaceReady": replace_ready,
        "outputDir": resolve_remote_movies_output_dir(),
        "outputWritable": writable,
        "outputDetail": detail,
        "tvOutputDir": resolve_remote_tv_output_dir(),
        "tvOutputWritable": tv_writable,
        "tvOutputDetail": tv_detail,
        "sourceRootsWritable": source_writable,
        "remoteBridgeConfigured": bridge_ok,
        "remoteBridgeDetail": bridge_detail if bridge_ok else bridge_detail,
        "fedoraSshOk": ssh_ok,
        "fedoraSshDetail": ssh_detail,
        "workRoot": WORK_ROOT,
        "workRootWritable": work_ok,
        "modes": ["jellyfin", "replace", "tv"],
        "activeJobId": manager.active_job_id,
        "activeBunnyUploadJobId": bunny_manager.active_job_id,
        "bunnyConfigured": bunny_manager.is_configured(),
        "disabledReason": disabled_reason,
    }


def require_enabled() -> None:
    if not agent_state.is_enabled():
        raise HTTPException(status_code=503, detail="Agent is disabled")


manager = JobManager()
app = FastAPI(title="Movie Night Converter Agent", version=AGENT_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> Dict[str, Any]:
    return build_health_payload()


@app.get("/admin/state")
def admin_state() -> Dict[str, Any]:
    payload = build_health_payload()
    payload["reachable"] = True
    return payload


@app.post("/admin/enable")
def admin_enable() -> Dict[str, Any]:
    agent_state.enable()
    return build_health_payload()


@app.post("/admin/disable")
def admin_disable(req: DisableRequest | None = None) -> Dict[str, Any]:
    cancel = True if req is None else req.cancelActive
    if cancel:
        manager.cancel_active()
        bunny_manager.cancel_active()
    agent_state.disable()
    return build_health_payload()


@app.post("/admin/reset")
def admin_reset() -> Dict[str, Any]:
    manager.cancel_active()
    bunny_manager.cancel_active()
    manager.clear_history()
    bunny_manager.clear_jobs()
    agent_state.enable()
    return build_health_payload()


@app.get("/presets")
def presets(mode: str | None = None) -> Dict[str, Any]:
    return {"presets": list_presets(mode)}


@app.get("/presets/{preset_id}")
def preset_detail(preset_id: str) -> Dict[str, Any]:
    try:
        return get_preset_detail(preset_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/presets/{preset_id}/preview")
def preset_preview(
    preset_id: str, req: PresetPreviewRequest | None = None
) -> Dict[str, Any]:
    try:
        preset = get_preset(preset_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    overrides: Dict[str, Any] | None = None
    if req and req.tuning is not None:
        overrides = req.tuning.model_dump(exclude_none=True)

    try:
        tuning = validate_tuning(preset_id, overrides)
        encoder = tuning.get("encoder", "")
        if "nvenc" in encoder.lower() and not check_nvenc_available():
            raise ValueError(
                f"Encoder {encoder} requires NVENC, which is not available"
            )
        options, _resolved = apply_tuning(preset_id, overrides)
        estimated = estimate_size_ratio(
            tuning["quality"],
            tuning["encoder"],
            tuning["resolutionMode"],
            preset.estimated_size_ratio,
        )
        return {
            "cliPreview": options,
            "summary": build_summary_for_tuning(preset_id, tuning),
            "estimatedSizeRatio": estimated,
            "tuning": tuning,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/jobs")
def create_job(req: CreateJobRequest) -> Dict[str, Any]:
    require_enabled()
    if not check_handbrake():
        raise HTTPException(status_code=503, detail="HandBrakeCLI not found")
    if "nvenc" in HANDBRAKE_ENCODER.lower() and not check_nvenc_available():
        raise HTTPException(status_code=503, detail="NVENC is not available")

    configured, bridge_detail = remote_bridge_configured()
    if not configured:
        raise HTTPException(
            status_code=503,
            detail=f"Remote media bridge not configured: {bridge_detail}",
        )
    ssh_ok, ssh_detail = ssh_reachable()
    if not ssh_ok:
        raise HTTPException(
            status_code=503,
            detail=f"Fedora SSH unreachable: {ssh_detail}",
        )

    job_mode = req.mode if req.mode in ("jellyfin", "replace", "tv") else "jellyfin"
    if job_mode in ("jellyfin", "tv"):
        if job_mode == "tv":
            writable, detail = check_tv_output_writable()
        else:
            writable, detail = check_output_writable()
        if not writable:
            raise HTTPException(
                status_code=503,
                detail=f"Fedora output not writable: {detail}",
            )
    else:
        root_writable, detail = check_source_root_writable(req.rootKey)
        if not root_writable:
            raise HTTPException(
                status_code=503,
                detail=f"Fedora source root not writable for replace: {detail}",
            )

    try:
        job = manager.create_job(req)
        return job.to_dict(include_logs=False)
    except FileExistsError as exc:
        raise HTTPException(
            status_code=409,
            detail={"message": "Output file already exists", "outputPath": str(exc)},
        ) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> Dict[str, Any]:
    job = manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job.to_dict(include_logs=True)


@app.delete("/jobs/{job_id}")
def delete_job(job_id: str) -> Dict[str, Any]:
    try:
        job = manager.cancel_job(job_id)
        return job.to_dict(include_logs=False)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc


@app.post("/jobs/{job_id}/open-folder")
def open_folder(job_id: str) -> Dict[str, Any]:
    job = manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if sys.platform == "win32":
        os.startfile(job.output_dir)  # type: ignore[attr-defined]
        return {"ok": True}
    raise HTTPException(
        status_code=501,
        detail="Open folder is not supported in the Docker agent",
    )


@app.post("/check-output")
def check_output(req: CheckOutputRequest) -> Dict[str, Any]:
    mode = req.mode if req.mode in ("jellyfin", "tv") else "jellyfin"
    return manager.check_output(req.title, req.videoFile, mode)


@app.get("/history")
def history() -> Dict[str, Any]:
    return {"jobs": manager.list_history()}


@app.delete("/history/{job_id}")
def delete_history_entry(job_id: str) -> Dict[str, Any]:
    try:
        manager.remove_history_entry(job_id)
        return {"ok": True}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.delete("/history")
def clear_history() -> Dict[str, Any]:
    manager.clear_history()
    return {"ok": True}


@app.get("/jellyfin-library")
def jellyfin_library() -> Dict[str, Any]:
    return {"files": bunny_manager.scan_jellyfin_library()}


@app.post("/bunny-upload")
def bunny_upload(req: BunnyUploadRequest) -> Dict[str, Any]:
    require_enabled()
    if not bunny_manager.is_configured():
        raise HTTPException(status_code=503, detail="Bunny storage is not configured on agent")
    try:
        job = bunny_manager.create_upload(req)
        return job.to_dict(include_logs=False)
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/bunny-upload/{job_id}")
def get_bunny_upload(job_id: str) -> Dict[str, Any]:
    job = bunny_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job.to_dict(include_logs=True)


def main() -> None:
    print(f"Movie Night Converter Agent v{AGENT_VERSION}")
    print(f"Listening on http://{AGENT_HOST}:{AGENT_PORT}")
    print(f"Agent enabled at startup: {agent_state.is_enabled()}")
    uvicorn.run(app, host=AGENT_HOST, port=AGENT_PORT, log_level="info")


if __name__ == "__main__":
    main()
