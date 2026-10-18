#!/usr/bin/env python3
"""Linux/Docker configuration for the Movie Night converter agent."""

from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass
from typing import Any, Dict, List

SETTINGS_JSON_PATH = os.environ.get(
    "SETTINGS_JSON_PATH", "/data/movie-night-settings.json"
)


def _load_shared_settings() -> Dict[str, Any]:
    try:
        with open(SETTINGS_JSON_PATH, encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _setting(env_key: str, *json_path: str, default: str = "") -> str:
    env_value = os.environ.get(env_key, "").strip()
    if env_value:
        return env_value

    current: Any = _SHARED_SETTINGS
    for key in json_path:
        if not isinstance(current, dict):
            return default
        current = current.get(key)
    if isinstance(current, str) and current.strip():
        return current.strip()
    return default


_SHARED_SETTINGS = _load_shared_settings()

HANDBRAKE_PATH = os.environ.get("HANDBRAKE_PATH", "/usr/bin/HandBrakeCLI")
HANDBRAKE_ENCODER = _setting(
    "HANDBRAKE_ENCODER", "converter", "handbrakeEncoder", default="nvenc_h264"
)
HANDBRAKE_HEVC_ENCODER = os.environ.get("HANDBRAKE_HEVC_ENCODER", "nvenc_h265")

WORK_ROOT = os.environ.get("WORK_ROOT", "/work")

# Local cache dirs only (never Samba library mounts). Publish targets are remote.
MOVIES_OUTPUT_DIR = os.environ.get("MOVIES_OUTPUT_DIR", "/work/jellyfin-cache")
TV_OUTPUT_DIR = os.environ.get("TV_OUTPUT_DIR", "/work/tv-jellyfin-cache")

# Fedora absolute library roots (SSH/SFTP). rootKey → remote path.
REMOTE_SOURCE_ROOTS: Dict[str, str] = {
    "e": os.environ.get("REMOTE_MOVIES_E", "/mnt/bigger-media/Movies E Drive"),
    "j": os.environ.get("REMOTE_MOVIES_J", "/mnt/18tb-media/Movies J Drive"),
    "h": os.environ.get("REMOTE_TV_H", "/mnt/external-media/TV Shows H Drive"),
    "te": os.environ.get("REMOTE_TV_E", "/mnt/bigger-media/TV Shows E Drive"),
    "tj": os.environ.get("REMOTE_TV_J", "/mnt/18tb-media/TV Shows J Drive"),
}

REMOTE_MOVIES_OUTPUT = os.environ.get(
    "REMOTE_MOVIES_OUTPUT", "/mnt/18tb-media/Movies J Drive - Jellyfin"
)
REMOTE_TV_OUTPUT = os.environ.get(
    "REMOTE_TV_OUTPUT", "/mnt/external-media/TV Shows H Drive - Jellyfin"
)

# Back-compat alias used by older call sites (now remote paths, not local mounts).
MOVIES_SOURCE_ROOTS: Dict[str, str] = dict(REMOTE_SOURCE_ROOTS)

FEDORA_SSH_HOST = os.environ.get("FEDORA_SSH_HOST", "").strip()
FEDORA_SSH_PORT = int(os.environ.get("FEDORA_SSH_PORT", "22") or "22")
FEDORA_SSH_USER = os.environ.get("FEDORA_SSH_USER", "").strip()
FEDORA_SSH_KEY_PATH = os.environ.get(
    "FEDORA_SSH_KEY_PATH", "/tmp/agent-ssh/id_ed25519"
)
FEDORA_SSH_KNOWN_HOSTS = os.environ.get(
    "FEDORA_SSH_KNOWN_HOSTS", "/tmp/agent-ssh/known_hosts"
)

# Never allow local delete/rename under these prefixes (Samba / host mounts).
FORBIDDEN_LOCAL_PREFIXES = (
    "/movies-e",
    "/movies-j",
    "/tv-h",
    "/mnt/host",
    "/output/jellyfin",
)

AGENT_HOST = os.environ.get("AGENT_HOST", "0.0.0.0")
AGENT_PORT = int(os.environ.get("AGENT_PORT", "8765"))
AGENT_ENABLED = os.environ.get("AGENT_ENABLED", "false").lower() in (
    "1",
    "true",
    "yes",
)

MAX_LOG_LINES = int(os.environ.get("MAX_LOG_LINES", "200"))
MAX_JOB_HISTORY = int(os.environ.get("MAX_JOB_HISTORY", "0"))
MAX_PERSISTED_LOG_LINES = int(os.environ.get("MAX_PERSISTED_LOG_LINES", "50"))

LOG_FILE = os.environ.get("LOG_FILE", "/tmp/converter-agent.log")
JOB_HISTORY_PATH = os.environ.get(
    "JOB_HISTORY_PATH", "/data/converter-job-history.json"
)

REPLACE_MIN_SAVINGS_RATIO = float(
    os.environ.get("REPLACE_MIN_SAVINGS_RATIO", "0.95")
)

BUNNY_STORAGE_ZONE = _setting("BUNNY_STORAGE_ZONE", "bunny", "storageZone")
BUNNY_STORAGE_PASSWORD = _setting("BUNNY_STORAGE_PASSWORD", "bunny", "storagePassword")
BUNNY_STORAGE_HOST = (
    _setting(
        "BUNNY_STORAGE_REGION",
        "bunny",
        "storageRegion",
        default="ny.storage.bunnycdn.com",
    )
    .replace("https://", "")
    .replace("http://", "")
    .rstrip("/")
)
BUNNY_CDN_HOSTNAME = _setting(
    "BUNNY_CDN_HOSTNAME", "bunny", "cdnHostname", default="GarretStorage.b-cdn.net"
)
BUNNY_STORAGE_PREFIX = _setting(
    "BUNNY_STORAGE_PREFIX", "bunny", "prefix", default="Movies"
).strip("/")

SUPPORTED_FORMATS = {
    ".mkv",
    ".mp4",
    ".avi",
    ".mov",
    ".wmv",
    ".flv",
    ".webm",
    ".m4v",
    ".mpg",
    ".mpeg",
    ".ts",
    ".mts",
    ".m2ts",
    ".vob",
    ".3gp",
    ".f4v",
    ".ogv",
    ".divx",
    ".xvid",
}

_nvenc_cache: bool | None = None


@dataclass
class PresetConfig:
    id: str
    label: str
    description: str
    allowed_modes: List[str]
    force_mp4: bool
    keep_source_resolution: bool
    encoding_options: List[str]
    estimated_size_ratio: float = 0.55


def _jellyfin_track_options() -> List[str]:
    return [
        "--audio-copy-mask",
        "aac,ac3,eac3,dts,dtshd",
        "--audio-fallback",
        "av_aac",
        "--ab",
        "192",
        "--all-audio",
        "--subtitle",
        "scan",
        "--subtitle-burned",
        "none",
    ]


def _jellyfin_options(
    quality: str,
    *,
    encoder: str | None = None,
    max_width: int | None = None,
    max_height: int | None = None,
) -> List[str]:
    opts: List[str] = [
        "--encoder",
        encoder or HANDBRAKE_ENCODER,
        "--quality",
        quality,
        "--vfr",
    ]
    if max_width is not None and max_height is not None:
        opts.extend(["--maxWidth", str(max_width), "--maxHeight", str(max_height)])
    opts.extend(_jellyfin_track_options())
    return opts


def _jellyfin_library_options(
    quality: str, audio_bitrate: int = 160, audio_track: int = 1
) -> List[str]:
    """HandBrake profile for Jellyfin library MP4s (1080p cap, web optimized)."""
    track = max(1, int(audio_track))
    return [
        "--encoder",
        HANDBRAKE_ENCODER,
        "--quality",
        quality,
        "--rate",
        "30",
        "--vfr",
        "--maxWidth",
        "1920",
        "--maxHeight",
        "1080",
        "--audio",
        str(track),
        "--aencoder",
        "av_aac",
        "--ab",
        str(audio_bitrate),
        "--mixdown",
        "stereo",
        "--subtitle",
        "scan",
        "--subtitle-burned",
        "none",
        "--markers",
    ]


def _vrchat_options(quality: str, audio_track: int = 1) -> List[str]:
    """1920x960 MP4 for Bunny CDN / VRChat streaming (not general Jellyfin library)."""
    track = max(1, int(audio_track))
    return [
        "--encoder",
        HANDBRAKE_ENCODER,
        "--quality",
        quality,
        "--vfr",
        "--width",
        "1920",
        "--height",
        "960",
        "--audio",
        str(track),
        "--aencoder",
        "av_aac",
        "--ab",
        "192",
        "--mixdown",
        "stereo",
    ]


QUALITY_MIN = 18
QUALITY_MAX = 30
AUDIO_BITRATE_MIN = 96
AUDIO_BITRATE_MAX = 320
ENCODER_OPTIONS = ["nvenc_h264", "nvenc_h265", "x264"]
RESOLUTION_MODES = ["source", "1080p", "720p"]
CONTAINER_MODES = ["auto", "mkv", "mp4"]

RESOLUTION_BOUNDS: Dict[str, tuple[int, int] | None] = {
    "source": None,
    "1080p": (1920, 1080),
    "720p": (1280, 720),
}


def _default_tuning_for_preset(preset: PresetConfig) -> Dict[str, Any]:
    quality = "22"
    encoder = HANDBRAKE_ENCODER
    resolution_mode = "source"
    audio_bitrate = 192
    keep_all_audio = True
    keep_subtitles = True
    container = "auto"

    opts = preset.encoding_options
    for index, item in enumerate(opts):
        if item == "--quality" and index + 1 < len(opts):
            quality = opts[index + 1]
        if item == "--encoder" and index + 1 < len(opts):
            encoder = opts[index + 1]
        if item == "--ab" and index + 1 < len(opts):
            audio_bitrate = int(opts[index + 1])

    if preset.id == "jellyfin-1080p" or preset.id == "jellyfin-library":
        resolution_mode = "1080p"
    elif not preset.keep_source_resolution and preset.id == "vrchat-stream":
        resolution_mode = "1080p"

    if preset.id == "jellyfin-hevc-balanced" or preset.id == "jellyfin-hevc-max-savings":
        encoder = HANDBRAKE_HEVC_ENCODER

    if preset.id == "jellyfin-library":
        keep_all_audio = False
        keep_subtitles = True
        container = "mp4"
        quality = "30"
        audio_bitrate = 160
    elif preset.id == "vrchat-stream":
        keep_all_audio = False
        keep_subtitles = False
        container = "mp4"
        quality = "24"

    return {
        "quality": int(quality),
        "encoder": encoder,
        "resolutionMode": resolution_mode,
        "audioBitrate": audio_bitrate,
        "audioTrack": 1,
        "keepAllAudio": keep_all_audio,
        "keepSubtitles": keep_subtitles,
        "container": container,
    }


def preset_tuning_defaults(preset_id: str) -> Dict[str, Any]:
    return dict(_default_tuning_for_preset(get_preset(preset_id)))


def preset_tuning_schema(preset_id: str) -> Dict[str, Any]:
    preset = get_preset(preset_id)
    defaults = _default_tuning_for_preset(preset)
    locked_resolution = (
        preset.id in ("jellyfin-1080p", "jellyfin-library", "vrchat-stream")
    )
    is_vrchat = preset.id == "vrchat-stream"
    is_jellyfin_library = preset.id == "jellyfin-library"

    resolution_options = ["1080p"] if locked_resolution else RESOLUTION_MODES
    if preset.id == "jellyfin-1080p":
        resolution_options = ["1080p"]

    return {
        "quality": {
            "min": QUALITY_MIN,
            "max": QUALITY_MAX,
            "step": 1,
            "label": "Quality (CQ)",
            "editable": True,
        },
        "encoder": {
            "options": ["nvenc_h264", "nvenc_h265"]
            if not is_vrchat
            else [HANDBRAKE_ENCODER],
            "editable": not is_vrchat and not is_jellyfin_library,
            "default": defaults["encoder"],
        },
        "resolutionMode": {
            "options": resolution_options,
            "editable": not locked_resolution,
            "default": defaults["resolutionMode"],
        },
        "audioBitrate": {
            "min": AUDIO_BITRATE_MIN,
            "max": AUDIO_BITRATE_MAX,
            "step": 32,
            "label": "Audio bitrate (kbps)",
            "editable": not is_vrchat,
        },
        "audioTrack": {
            "min": 1,
            "max": 64,
            "step": 1,
            "label": "Audio track (HandBrake index)",
            "editable": is_jellyfin_library or is_vrchat,
            "default": defaults["audioTrack"],
        },
        "keepAllAudio": {
            "editable": not is_vrchat and not is_jellyfin_library,
            "default": defaults["keepAllAudio"],
        },
        "keepSubtitles": {
            "editable": not is_vrchat and not is_jellyfin_library,
            "default": defaults["keepSubtitles"],
        },
        "container": {
            "options": ["mp4"] if preset.force_mp4 else CONTAINER_MODES,
            "editable": not preset.force_mp4,
            "default": defaults["container"],
        },
    }


def estimate_size_ratio(
    quality: int,
    encoder: str,
    resolution_mode: str,
    base_ratio: float | None = None,
) -> float:
    anchor_quality = 22
    quality_factor = 1.0 + (quality - anchor_quality) * 0.04
    quality_factor = max(0.55, min(1.35, quality_factor))

    encoder_factor = 1.0
    if "265" in encoder or "hevc" in encoder.lower():
        encoder_factor = 0.72
    elif encoder == "x264":
        encoder_factor = 1.08

    resolution_factor = 1.0
    if resolution_mode == "1080p":
        resolution_factor = 0.88
    elif resolution_mode == "720p":
        resolution_factor = 0.65

    base = base_ratio if base_ratio is not None else 0.55
    return round(base * quality_factor * encoder_factor * resolution_factor, 3)


def _merge_tuning_dict(
    preset_id: str, overrides: Dict[str, Any] | None
) -> Dict[str, Any]:
    merged = preset_tuning_defaults(preset_id)
    if not overrides:
        return merged
    for key, value in overrides.items():
        if value is not None:
            merged[key] = value
    return merged


def validate_tuning(preset_id: str, overrides: Dict[str, Any] | None) -> Dict[str, Any]:
    merged = _merge_tuning_dict(preset_id, overrides)
    schema = preset_tuning_schema(preset_id)

    quality = int(merged["quality"])
    if quality < QUALITY_MIN or quality > QUALITY_MAX:
        raise ValueError(f"quality must be between {QUALITY_MIN} and {QUALITY_MAX}")

    encoder = str(merged["encoder"])
    allowed_encoders = schema["encoder"]["options"]
    if encoder not in allowed_encoders:
        raise ValueError(f"encoder must be one of: {', '.join(allowed_encoders)}")

    resolution_mode = str(merged["resolutionMode"])
    allowed_res = schema["resolutionMode"]["options"]
    if resolution_mode not in allowed_res:
        raise ValueError(f"resolutionMode must be one of: {', '.join(allowed_res)}")

    audio_bitrate = int(merged["audioBitrate"])
    if audio_bitrate < AUDIO_BITRATE_MIN or audio_bitrate > AUDIO_BITRATE_MAX:
        raise ValueError(
            f"audioBitrate must be between {AUDIO_BITRATE_MIN} and {AUDIO_BITRATE_MAX}"
        )

    container = str(merged["container"])
    allowed_containers = schema["container"]["options"]
    if container not in allowed_containers:
        raise ValueError(f"container must be one of: {', '.join(allowed_containers)}")

    merged["quality"] = quality
    merged["encoder"] = encoder
    merged["resolutionMode"] = resolution_mode
    merged["audioBitrate"] = audio_bitrate
    audio_track = int(merged.get("audioTrack", 1) or 1)
    if audio_track < 1:
        raise ValueError("audioTrack must be >= 1")
    merged["audioTrack"] = audio_track
    merged["keepAllAudio"] = bool(merged.get("keepAllAudio", True))
    merged["keepSubtitles"] = bool(merged.get("keepSubtitles", True))
    merged["container"] = container
    return merged


def _build_jellyfin_encoding_options(tuning: Dict[str, Any]) -> List[str]:
    bounds = RESOLUTION_BOUNDS.get(tuning["resolutionMode"])
    max_width = bounds[0] if bounds else None
    max_height = bounds[1] if bounds else None

    opts: List[str] = [
        "--encoder",
        tuning["encoder"],
        "--quality",
        str(tuning["quality"]),
        "--vfr",
    ]
    if max_width is not None and max_height is not None:
        opts.extend(["--maxWidth", str(max_width), "--maxHeight", str(max_height)])

    if tuning.get("keepAllAudio", True):
        opts.extend(
            [
                "--audio-copy-mask",
                "aac,ac3,eac3,dts,dtshd",
                "--audio-fallback",
                "av_aac",
                "--ab",
                str(tuning["audioBitrate"]),
                "--all-audio",
            ]
        )
    else:
        track = max(1, int(tuning.get("audioTrack", 1) or 1))
        opts.extend(
            [
                "--audio",
                str(track),
                "--aencoder",
                "av_aac",
                "--ab",
                str(tuning["audioBitrate"]),
                "--mixdown",
                "stereo",
            ]
        )

    if tuning.get("keepSubtitles", True):
        opts.extend(["--subtitle", "scan", "--subtitle-burned", "none"])

    return opts


def apply_tuning(
    preset_id: str, overrides: Dict[str, Any] | None = None
) -> tuple[List[str], Dict[str, Any]]:
    preset = get_preset(preset_id)
    tuning = validate_tuning(preset_id, overrides)
    audio_track = int(tuning.get("audioTrack", 1) or 1)

    if preset.id == "jellyfin-library":
        options = _jellyfin_library_options(
            str(tuning["quality"]), int(tuning["audioBitrate"]), audio_track
        )
    elif preset.id == "vrchat-stream":
        options = _vrchat_options(str(tuning["quality"]), audio_track)
    else:
        options = _build_jellyfin_encoding_options(tuning)

    container = tuning["container"]
    if container == "mkv":
        options = _strip_format_flag(options) + ["--format", "av_mkv"]
    elif container == "mp4":
        options = _strip_format_flag(options) + ["--format", "av_mp4", "--optimize"]

    return options, tuning


def _strip_format_flag(options: List[str]) -> List[str]:
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
    return filtered


def pick_container_from_tuning(
    source_path: str, preset: PresetConfig, tuning: Dict[str, Any]
) -> str:
    container = tuning.get("container", "auto")
    if container == "mkv":
        return ".mkv"
    if container == "mp4":
        return ".mp4"
    if preset.force_mp4:
        return ".mp4"
    audio_count, sub_count = probe_track_counts(source_path)
    if not tuning.get("keepAllAudio", True) or audio_count <= 1:
        if not tuning.get("keepSubtitles", True) or sub_count == 0:
            return ".mp4"
    if audio_count > 1 or sub_count > 0:
        return ".mkv"
    return ".mp4"


def probe_output_track_counts(source_path: str) -> tuple[int, int]:
    """Strict track counts for output validation (no optimistic fallbacks)."""
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
            timeout=120,
            check=False,
        )
        if result.returncode != 0:
            return 0, 0
        types = [line.strip() for line in result.stdout.splitlines() if line.strip()]
        audio = sum(1 for codec_type in types if codec_type == "audio")
        subs = sum(1 for codec_type in types if codec_type == "subtitle")
        return audio, subs
    except (OSError, subprocess.TimeoutExpired):
        return 0, 0


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
            timeout=120,
            check=False,
        )
        if result.returncode != 0:
            return 1, 0
        types = [line.strip() for line in result.stdout.splitlines() if line.strip()]
        audio = sum(1 for codec_type in types if codec_type == "audio")
        subs = sum(1 for codec_type in types if codec_type == "subtitle")
        return max(audio, 1), subs
    except (OSError, subprocess.TimeoutExpired):
        return 1, 0


def build_summary_for_tuning(preset_id: str, tuning: Dict[str, Any]) -> Dict[str, str]:
    preset = get_preset(preset_id)
    encoder_label = tuning["encoder"].replace("_", " ").upper()
    res_labels = {
        "source": "Keep source resolution",
        "1080p": "Cap at 1080p",
        "720p": "Cap at 720p",
    }
    audio = (
        "All audio tracks, copy when possible"
        if tuning.get("keepAllAudio", True)
        else (
            f"Track {tuning.get('audioTrack', 1)} → stereo AAC "
            f"{tuning['audioBitrate']} kbps"
        )
    )
    subs = (
        "Copy all, none burned"
        if tuning.get("keepSubtitles", True)
        else "None"
    )
    container_labels = {
        "auto": "Auto (MKV if multi-track/subs)",
        "mkv": "MKV",
        "mp4": "MP4",
    }
    return {
        "video": f"{encoder_label}, CQ {tuning['quality']}, {res_labels.get(tuning['resolutionMode'], tuning['resolutionMode'])}",
        "audio": audio,
        "subtitles": subs,
        "container": container_labels.get(tuning["container"], tuning["container"]),
        "preset": preset.label,
    }


def get_preset_detail(preset_id: str) -> Dict[str, Any]:
    preset = get_preset(preset_id)
    defaults = preset_tuning_defaults(preset_id)
    schema = preset_tuning_schema(preset_id)
    options, resolved = apply_tuning(preset_id, None)
    summary = build_summary_for_tuning(preset_id, resolved)
    estimated = estimate_size_ratio(
        resolved["quality"],
        resolved["encoder"],
        resolved["resolutionMode"],
        preset.estimated_size_ratio,
    )
    return {
        "id": preset.id,
        "label": preset.label,
        "description": preset.description,
        "allowedModes": preset.allowed_modes,
        "estimatedSizeRatio": estimated,
        "defaults": defaults,
        "schema": schema,
        "summary": summary,
        "cliPreview": options,
    }


def build_handbrake_options_with_tuning(
    source_path: str,
    preset_id: str,
    overrides: Dict[str, Any] | None = None,
) -> tuple[List[str], Dict[str, Any]]:
    preset = get_preset(preset_id)
    options, tuning = apply_tuning(preset_id, overrides)

    if tuning["container"] == "auto" and "--format" not in options:
        ext = pick_container_from_tuning(source_path, preset, tuning)
        format_flag = "av_mkv" if ext == ".mkv" else "av_mp4"
        options = options + ["--format", format_flag]
        if format_flag == "av_mp4" and "--optimize" not in options:
            options = options + ["--optimize"]

    return options, tuning


PRESETS: Dict[str, PresetConfig] = {
    "jellyfin-library": PresetConfig(
        id="jellyfin-library",
        label="Jellyfin Library",
        description="1080p cap, H.264 NVenc CQ 30, stereo AAC 160k, foreign-audio subs, chapters",
        allowed_modes=["jellyfin", "tv"],
        force_mp4=True,
        keep_source_resolution=False,
        encoding_options=_jellyfin_library_options("30"),
        estimated_size_ratio=0.50,
    ),
    "vrchat-stream": PresetConfig(
        id="vrchat-stream",
        label="VRChat / Bunny Stream",
        description="1920x960 H.264, stereo AAC — optimized for Bunny CDN / VRChat",
        allowed_modes=["jellyfin", "tv"],
        force_mp4=True,
        keep_source_resolution=False,
        encoding_options=_vrchat_options("24"),
        estimated_size_ratio=0.45,
    ),
    "jellyfin-high-quality": PresetConfig(
        id="jellyfin-high-quality",
        label="Jellyfin High Quality",
        description="Keep source resolution, all tracks & subs, light compression (CQ 20)",
        allowed_modes=["replace"],
        force_mp4=False,
        keep_source_resolution=True,
        encoding_options=_jellyfin_options("20"),
        estimated_size_ratio=0.65,
    ),
    "jellyfin-balanced": PresetConfig(
        id="jellyfin-balanced",
        label="Jellyfin Balanced",
        description="Keep source resolution, all tracks & subs, moderate savings (CQ 22)",
        allowed_modes=["replace"],
        force_mp4=False,
        keep_source_resolution=True,
        encoding_options=_jellyfin_options("22"),
        estimated_size_ratio=0.55,
    ),
    "jellyfin-max-savings": PresetConfig(
        id="jellyfin-max-savings",
        label="Jellyfin Max Savings",
        description="Keep all tracks & subs, aggressive H.264 compression (CQ 26)",
        allowed_modes=["replace"],
        force_mp4=False,
        keep_source_resolution=True,
        encoding_options=_jellyfin_options("26"),
        estimated_size_ratio=0.35,
    ),
    "jellyfin-1080p": PresetConfig(
        id="jellyfin-1080p",
        label="Jellyfin 1080p Cap",
        description="Downscale to 1080p max, all tracks & subs — good for 4K sources (CQ 22)",
        allowed_modes=["replace"],
        force_mp4=False,
        keep_source_resolution=False,
        encoding_options=_jellyfin_options("22", max_width=1920, max_height=1080),
        estimated_size_ratio=0.45,
    ),
    "jellyfin-hevc-balanced": PresetConfig(
        id="jellyfin-hevc-balanced",
        label="Jellyfin HEVC Balanced",
        description="H.265/HEVC, keep source resolution, all tracks & subs (CQ 22)",
        allowed_modes=["replace"],
        force_mp4=False,
        keep_source_resolution=True,
        encoding_options=_jellyfin_options("22", encoder=HANDBRAKE_HEVC_ENCODER),
        estimated_size_ratio=0.40,
    ),
    "jellyfin-hevc-max-savings": PresetConfig(
        id="jellyfin-hevc-max-savings",
        label="Jellyfin HEVC Max Savings",
        description="H.265/HEVC, keep source resolution, smallest files (CQ 26)",
        allowed_modes=["replace"],
        force_mp4=False,
        keep_source_resolution=True,
        encoding_options=_jellyfin_options("26", encoder=HANDBRAKE_HEVC_ENCODER),
        estimated_size_ratio=0.28,
    ),
}

DEFAULT_PRESET = "jellyfin-library"

ENCODING_OPTIONS: List[str] = PRESETS[DEFAULT_PRESET].encoding_options


def get_preset(preset_id: str) -> PresetConfig:
    preset = PRESETS.get(preset_id)
    if not preset:
        raise ValueError(f"Unknown preset: {preset_id}")
    return preset


def list_presets(mode: str | None = None) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    for preset in PRESETS.values():
        if mode and mode not in preset.allowed_modes:
            continue
        defaults = preset_tuning_defaults(preset.id)
        estimated = estimate_size_ratio(
            defaults["quality"],
            defaults["encoder"],
            defaults["resolutionMode"],
            preset.estimated_size_ratio,
        )
        results.append(
            {
                "id": preset.id,
                "label": preset.label,
                "description": preset.description,
                "allowedModes": ",".join(preset.allowed_modes),
                "estimatedSizeRatio": estimated,
                "defaults": defaults,
            }
        )
    return results


def resolve_movies_output_dir() -> str:
    """Local cache directory only (not the Fedora library)."""
    return MOVIES_OUTPUT_DIR


def resolve_tv_output_dir() -> str:
    """Local cache directory only (not the Fedora library)."""
    return TV_OUTPUT_DIR


def resolve_remote_movies_output_dir() -> str:
    return REMOTE_MOVIES_OUTPUT


def resolve_remote_tv_output_dir() -> str:
    return REMOTE_TV_OUTPUT


def resolve_output_dir_for_mode(mode: str) -> str:
    if mode == "tv":
        return resolve_tv_output_dir()
    return resolve_movies_output_dir()


def resolve_remote_output_dir_for_mode(mode: str) -> str:
    if mode == "tv":
        return resolve_remote_tv_output_dir()
    return resolve_remote_movies_output_dir()


def is_forbidden_local_library_path(path: str) -> bool:
    """True if path looks like a Samba/host library mount (must not delete/write)."""
    if not path:
        return False
    normalized = os.path.normpath(path).replace("\\", "/")
    lowered = normalized.lower()
    for prefix in FORBIDDEN_LOCAL_PREFIXES:
        p = prefix.rstrip("/")
        if lowered == p or lowered.startswith(p + "/"):
            return True
    # Windows drive letters that historically mapped to NAS shares
    if len(normalized) >= 2 and normalized[1] == ":" and normalized[0].upper() in "EHJ":
        return True
    return False


def check_nvenc_available() -> bool:
    global _nvenc_cache
    if _nvenc_cache is not None:
        return _nvenc_cache

    if "nvenc" not in HANDBRAKE_ENCODER.lower():
        _nvenc_cache = True
        return _nvenc_cache

    try:
        smi = subprocess.run(
            ["nvidia-smi"],
            capture_output=True,
            timeout=10,
            check=False,
        )
        if smi.returncode != 0:
            _nvenc_cache = False
            return _nvenc_cache

        hb = subprocess.run(
            [HANDBRAKE_PATH, "--version"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        combined = (hb.stdout or "") + (hb.stderr or "")
        if "libnvidia-encode" in combined.lower():
            _nvenc_cache = False
            return _nvenc_cache

        _nvenc_cache = True
    except (OSError, subprocess.TimeoutExpired):
        _nvenc_cache = False

    return _nvenc_cache
