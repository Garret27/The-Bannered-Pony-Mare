import { getSettingsSync } from "./settings";

const DEFAULT_AGENT_URL = "http://converter-agent:8765";
const FETCH_TIMEOUT_MS = 10_000;

export type AgentHealth = {
  ok: boolean;
  enabled: boolean;
  version: string;
  handbrakeFound: boolean;
  handbrakePath: string;
  handbrakeEncoder?: string;
  nvencAvailable?: boolean;
  moviesReady?: boolean;
  tvReady?: boolean;
  replaceReady?: boolean;
  outputDir: string;
  outputWritable: boolean;
  outputDetail: string;
  tvOutputDir?: string;
  tvOutputWritable?: boolean;
  tvOutputDetail?: string;
  sourceRootsWritable?: Record<string, boolean>;
  remoteBridgeConfigured?: boolean;
  remoteBridgeDetail?: string;
  fedoraSshOk?: boolean;
  fedoraSshDetail?: string;
  workRoot?: string;
  workRootWritable?: boolean;
  modes?: string[];
  activeJobId: string | null;
  disabledReason?: string | null;
  bunnyConfigured?: boolean;
  activeBunnyUploadJobId?: string | null;
};

export type ConversionPreset = {
  id: string;
  label: string;
  description: string;
  allowedModes: string;
  estimatedSizeRatio?: number;
  defaults?: EncodingTuning;
};

export type EncodingTuning = {
  quality?: number;
  encoder?: string;
  resolutionMode?: "source" | "1080p" | "720p";
  audioBitrate?: number;
  /** 1-based HandBrake audio track index */
  audioTrack?: number;
  keepAllAudio?: boolean;
  keepSubtitles?: boolean;
  container?: "auto" | "mkv" | "mp4";
};

export type TuningFieldSchema = {
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  options?: string[];
  editable?: boolean;
  default?: string | number | boolean;
};

export type PresetDetail = {
  id: string;
  label: string;
  description: string;
  allowedModes: string[];
  estimatedSizeRatio: number;
  defaults: EncodingTuning;
  schema: Record<string, TuningFieldSchema>;
  summary: {
    video: string;
    audio: string;
    subtitles: string;
    container: string;
    preset?: string;
  };
  cliPreview: string[];
};

export type PresetPreview = {
  cliPreview: string[];
  summary: PresetDetail["summary"];
  estimatedSizeRatio: number;
  tuning: EncodingTuning;
};

export type AgentState = AgentHealth & {
  reachable: boolean;
};

export type AgentControlAction = "enable" | "disable" | "reset";

export type ConversionJob = {
  id: string;
  title: string;
  videoFile: string;
  rootKey: string;
  sourcePath?: string;
  /** Fedora absolute path of the original source (preferred for sidecar probe). */
  remoteSourcePath?: string;
  outputDir?: string;
  outputPath?: string;
  mode?: string;
  preset?: string;
  sourceSizeBytes?: number | null;
  bytesSaved?: number | null;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  percent: number;
  eta: string | null;
  fps: string | null;
  elapsedSec: number;
  error: string | null;
  outputSizeBytes: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  logLines?: string[];
};

export type JellyfinFile = {
  title: string;
  relativePath: string;
  filename: string;
  sizeBytes: number;
  fullPath: string;
  modifiedAt: string;
};

export type BunnyUploadJob = {
  id: string;
  filename: string;
  relativePath: string;
  sourcePath: string;
  status: "queued" | "running" | "done" | "failed";
  percent: number;
  bytesSent: number;
  totalBytes: number;
  elapsedSec: number;
  cdnUrl: string | null;
  error: string | null;
  logLines?: string[];
};

export type OutputCheck = {
  exists: boolean;
  outputPath: string;
  outputSizeBytes: number | null;
};

function getAgentBaseUrl(): string {
  return getSettingsSync().converter.agentUrl.trim() || DEFAULT_AGENT_URL;
}

async function agentFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<
  { ok: true; data: T } | { ok: false; status: number; error: string; outputPath?: string }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${getAgentBaseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    const data = (await response.json().catch(() => ({}))) as T & {
      detail?: string | { message?: string; outputPath?: string };
    };

    if (!response.ok) {
      let error = "Agent request failed";
      let outputPath: string | undefined;
      const detail = (data as { detail?: string | { message?: string; outputPath?: string } }).detail;
      if (typeof detail === "string") {
        error = detail;
      } else if (detail && typeof detail === "object") {
        error = detail.message ?? JSON.stringify(detail);
        outputPath = detail.outputPath;
      }
      return { ok: false, status: response.status, error, outputPath };
    }

    return { ok: true, data };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Converter agent timed out"
        : error instanceof Error
          ? error.message
          : "Converter agent unreachable";
    return { ok: false, status: 503, error: message };
  } finally {
    clearTimeout(timer);
  }
}

export async function getAgentHealth(): Promise<
  { ok: true; health: AgentHealth } | { ok: false; error: string }
> {
  const result = await agentFetch<AgentHealth>("/health");
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, health: result.data };
}

export async function createConversionJob(body: {
  title: string;
  /** Relative dir under the source root when it differs from output title (TV). */
  sourceTitle?: string;
  videoFile: string;
  rootKey: string;
  overwrite?: boolean;
  mode?: "jellyfin" | "replace" | "tv";
  preset?: string;
  tuning?: EncodingTuning;
}): Promise<
  | { ok: true; job: ConversionJob }
  | { ok: false; status: number; error: string; outputPath?: string }
> {
  const result = await agentFetch<ConversionJob>("/jobs", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error: result.error,
      outputPath: result.outputPath,
    };
  }
  return { ok: true, job: result.data };
}

export async function getConversionPresets(
  mode?: string,
): Promise<
  { ok: true; presets: ConversionPreset[] } | { ok: false; error: string }
> {
  const query = mode ? `?mode=${encodeURIComponent(mode)}` : "";
  const result = await agentFetch<{ presets: ConversionPreset[] }>(
    `/presets${query}`,
  );
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, presets: result.data.presets ?? [] };
}

export async function getPresetDetail(
  presetId: string,
): Promise<{ ok: true; preset: PresetDetail } | { ok: false; error: string }> {
  const result = await agentFetch<PresetDetail>(
    `/presets/${encodeURIComponent(presetId)}`,
  );
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, preset: result.data };
}

export async function previewPresetTuning(
  presetId: string,
  tuning?: EncodingTuning,
): Promise<{ ok: true; preview: PresetPreview } | { ok: false; error: string }> {
  const result = await agentFetch<PresetPreview>(
    `/presets/${encodeURIComponent(presetId)}/preview`,
    {
      method: "POST",
      body: JSON.stringify({ tuning: tuning ?? null }),
    },
  );
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, preview: result.data };
}

export async function getConversionJob(
  jobId: string,
): Promise<
  { ok: true; job: ConversionJob } | { ok: false; status: number; error: string }
> {
  const result = await agentFetch<ConversionJob>(`/jobs/${encodeURIComponent(jobId)}`);
  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error };
  }
  return { ok: true, job: result.data };
}

export async function cancelConversionJob(
  jobId: string,
): Promise<
  { ok: true; job: ConversionJob } | { ok: false; status: number; error: string }
> {
  const result = await agentFetch<ConversionJob>(
    `/jobs/${encodeURIComponent(jobId)}`,
    { method: "DELETE" },
  );
  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error };
  }
  return { ok: true, job: result.data };
}

export async function openJobOutputFolder(
  jobId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await agentFetch<{ ok: boolean }>(
    `/jobs/${encodeURIComponent(jobId)}/open-folder`,
    { method: "POST" },
  );
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true };
}

export async function checkOutputOnAgent(body: {
  title: string;
  videoFile: string;
  mode?: "jellyfin" | "tv";
}): Promise<
  { ok: true; check: OutputCheck } | { ok: false; error: string }
> {
  const result = await agentFetch<OutputCheck>("/check-output", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, check: result.data };
}

export async function getConversionHistory(): Promise<
  { ok: true; jobs: ConversionJob[] } | { ok: false; error: string }
> {
  const result = await agentFetch<{ jobs: ConversionJob[] }>("/history");
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, jobs: result.data.jobs ?? [] };
}

export async function deleteConversionHistoryEntry(
  jobId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await agentFetch<{ ok: boolean }>(
    `/history/${encodeURIComponent(jobId)}`,
    { method: "DELETE" },
  );
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true };
}

export async function clearConversionHistory(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const result = await agentFetch<{ ok: boolean }>("/history", {
    method: "DELETE",
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true };
}

export async function getAgentState(): Promise<
  { ok: true; state: AgentState } | { ok: false; error: string }
> {
  const result = await agentFetch<AgentState>("/admin/state");
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, state: { ...result.data, reachable: true } };
}

export async function controlAgent(
  action: AgentControlAction,
): Promise<
  { ok: true; state: AgentState } | { ok: false; error: string }
> {
  const path =
    action === "enable"
      ? "/admin/enable"
      : action === "disable"
        ? "/admin/disable"
        : "/admin/reset";

  const result = await agentFetch<AgentState>(path, {
    method: "POST",
    body:
      action === "disable"
        ? JSON.stringify({ cancelActive: true })
        : undefined,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, state: { ...result.data, reachable: true } };
}

export async function getJellyfinLibrary(): Promise<
  { ok: true; files: JellyfinFile[] } | { ok: false; error: string }
> {
  const result = await agentFetch<{ files: JellyfinFile[] }>("/jellyfin-library");
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, files: result.data.files ?? [] };
}

export async function startBunnyUploadOnAgent(body: {
  relativePath: string;
  overwrite?: boolean;
}): Promise<
  | { ok: true; job: BunnyUploadJob }
  | { ok: false; status: number; error: string }
> {
  const result = await agentFetch<BunnyUploadJob>("/bunny-upload", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error };
  }
  return { ok: true, job: result.data };
}

export async function getBunnyUploadJob(
  jobId: string,
): Promise<
  | { ok: true; job: BunnyUploadJob }
  | { ok: false; status: number; error: string }
> {
  const result = await agentFetch<BunnyUploadJob>(
    `/bunny-upload/${encodeURIComponent(jobId)}`,
  );
  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error };
  }
  return { ok: true, job: result.data };
}
