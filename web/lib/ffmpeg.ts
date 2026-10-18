import { execFile } from "child_process";
import fs from "fs/promises";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

/** Keep probes bounded so large MKVs on slow mounts cannot hang forever. */
const FFPROBE_TIMEOUT_MS = 30_000;
const FFPROBE_ANALYZE = ["-analyzeduration", "50M", "-probesize", "50M"];

const SIDECAR_EXTENSIONS = new Set([".srt", ".ass", ".ssa", ".vtt"]);

export type SidecarSubtitle = {
  id: string;
  filename: string;
  language: string;
  label: string;
};

export type SubtitleTrack = {
  streamIndex: number;
  language: string;
  name: string | null;
  forced: boolean;
  sdh: boolean;
  captions: boolean;
  label: string;
};

function sanitizeName(name: string): string {
  return name
    .replace(/ /g, "_")
    .replace(/\./g, "_")
    .replace(/[()[\]]/g, "_");
}

function buildTrackLabel(track: Omit<SubtitleTrack, "label">): string {
  const parts = [track.language || "und"];
  if (track.forced) parts.push("forced");
  if (track.sdh) parts.push("sdh");
  else if (track.captions) parts.push("cc");
  if (track.name) parts.push(sanitizeName(track.name));
  parts.push(`stream${track.streamIndex}`);
  return parts.join(" - ");
}

export async function probeSubtitleTracks(
  videoPath: string,
): Promise<SubtitleTrack[]> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v",
      "error",
      ...FFPROBE_ANALYZE,
      "-select_streams",
      "s",
      "-show_entries",
      "stream=index,codec_name:stream_tags=language,title:disposition=forced,hearing_impaired,captions",
      "-of",
      "json",
      videoPath,
    ],
    { maxBuffer: 10 * 1024 * 1024, timeout: FFPROBE_TIMEOUT_MS },
  );

  const parsed = JSON.parse(stdout || "{}") as {
    streams?: Array<{
      index?: number;
      codec_name?: string;
      tags?: { language?: string; title?: string; name?: string };
      disposition?: {
        forced?: number;
        hearing_impaired?: number;
        captions?: number;
      };
    }>;
  };

  const tracks: SubtitleTrack[] = [];

  for (const stream of parsed.streams ?? []) {
    if (typeof stream.index !== "number") continue;

    const current = {
      streamIndex: stream.index,
      language: stream.tags?.language?.trim() || "und",
      name: stream.tags?.title?.trim() || stream.tags?.name?.trim() || null,
      forced: stream.disposition?.forced === 1,
      sdh: stream.disposition?.hearing_impaired === 1,
      captions: stream.disposition?.captions === 1,
    };

    // Title often marks SDH when disposition flags are unset.
    if (
      !current.sdh &&
      current.name &&
      /\b(sdh|cc|hearing)\b/i.test(current.name)
    ) {
      current.sdh = true;
    }

    tracks.push({ ...current, label: buildTrackLabel(current) });
  }

  return tracks;
}

function languageFromSidecarName(filename: string, videoBase: string): string {
  const stem = path.basename(filename, path.extname(filename));
  if (stem === videoBase) return "und";

  const prefix = `${videoBase}.`;
  if (!stem.startsWith(prefix)) return "und";

  const tags = stem
    .slice(prefix.length)
    .split(".")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  const lang = tags.find((tag) => /^[a-z]{2,3}$/.test(tag) && tag !== "sdh");
  return lang ?? "und";
}

/** External subtitle files next to a video (e.g. Movie.eng.srt). */
export async function listSidecarSubtitles(
  videoPath: string,
): Promise<SidecarSubtitle[]> {
  const dir = path.dirname(videoPath);
  const videoBase = path.basename(videoPath, path.extname(videoPath));

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const sidecars: SidecarSubtitle[] = [];

  for (const filename of entries) {
    const ext = path.extname(filename).toLowerCase();
    if (!SIDECAR_EXTENSIONS.has(ext)) continue;

    const stem = path.basename(filename, path.extname(filename));
    if (stem !== videoBase && !stem.startsWith(`${videoBase}.`)) continue;

    const language = languageFromSidecarName(filename, videoBase);
    const parts = [language, "sidecar", filename];
    sidecars.push({
      id: filename,
      filename,
      language,
      label: parts.join(" - "),
    });
  }

  sidecars.sort((a, b) => a.filename.localeCompare(b.filename));
  return sidecars;
}

export async function extractTrack(
  videoPath: string,
  streamIndex: number,
  outputPath: string,
): Promise<void> {
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-nostdin",
      "-loglevel",
      "error",
      "-i",
      videoPath,
      "-map",
      `0:${streamIndex}`,
      "-c:s",
      "srt",
      outputPath,
    ],
    { maxBuffer: 10 * 1024 * 1024 },
  );
}

export function getMoviesDir(): string | null {
  const dir = process.env.MOVIES_DIR?.trim();
  return dir || null;
}

export function isPathInsideDir(filePath: string, baseDir: string): boolean {
  const resolvedFile = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir);
  return (
    resolvedFile === resolvedBase ||
    resolvedFile.startsWith(resolvedBase + path.sep)
  );
}

export type AudioTrackInfo = {
  streamIndex: number;
  language: string;
  codec: string;
  channels: number | null;
};

export type VideoMetadata = {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioTracks: AudioTrackInfo[];
  subtitleTrackCount: number;
};

export async function probeVideoMetadata(
  videoPath: string,
): Promise<VideoMetadata> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v",
      "error",
      ...FFPROBE_ANALYZE,
      "-show_entries",
      "stream=index,codec_type,codec_name,channels,width,height:stream_tags=language:format=duration",
      "-of",
      "json",
      videoPath,
    ],
    { maxBuffer: 10 * 1024 * 1024, timeout: FFPROBE_TIMEOUT_MS },
  );

  const parsed = JSON.parse(stdout) as {
    streams?: Array<{
      index: number;
      codec_type?: string;
      codec_name?: string;
      channels?: number;
      width?: number;
      height?: number;
      tags?: { language?: string };
    }>;
    format?: { duration?: string };
  };

  let width: number | null = null;
  let height: number | null = null;
  let videoCodec: string | null = null;
  const audioTracks: AudioTrackInfo[] = [];
  let subtitleTrackCount = 0;

  for (const stream of parsed.streams ?? []) {
    if (stream.codec_type === "video" && videoCodec === null) {
      width = stream.width ?? null;
      height = stream.height ?? null;
      videoCodec = stream.codec_name ?? null;
    } else if (stream.codec_type === "audio") {
      audioTracks.push({
        streamIndex: stream.index,
        language: stream.tags?.language ?? "und",
        codec: stream.codec_name ?? "unknown",
        channels:
          typeof stream.channels === "number" && stream.channels > 0
            ? stream.channels
            : null,
      });
    } else if (stream.codec_type === "subtitle") {
      subtitleTrackCount += 1;
    }
  }

  const durationRaw = parsed.format?.duration;
  const durationSec =
    durationRaw !== undefined ? parseFloat(durationRaw) : null;

  return {
    durationSec: Number.isFinite(durationSec) ? durationSec : null,
    width,
    height,
    videoCodec,
    audioTracks,
    subtitleTrackCount,
  };
}
