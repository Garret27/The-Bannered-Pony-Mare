import { NextResponse } from "next/server";
import {
  createConversionJob,
  getAgentHealth,
  getConversionPresets,
  type EncodingTuning,
} from "@/lib/converter-agent";
import {
  getEpisodeById,
  getTvAgentTitle,
  getTvSourceTitle,
  isTvLibraryConfigured,
} from "@/lib/tv-library";

export const runtime = "nodejs";

const DEFAULT_REPLACE_PRESET = "jellyfin-balanced";

export async function POST(request: Request) {
  if (!isTvLibraryConfigured()) {
    return NextResponse.json(
      { error: "JELLYFIN_URL and JELLYFIN_API_KEY are not configured" },
      { status: 503 },
    );
  }

  const health = await getAgentHealth();
  if (!health.ok) {
    return NextResponse.json({ error: health.error }, { status: 503 });
  }

  let body: {
    episodeId?: string;
    preset?: string;
    confirm?: boolean;
    tuning?: EncodingTuning;
  };
  try {
    body = (await request.json()) as {
      episodeId?: string;
      preset?: string;
      confirm?: boolean;
      tuning?: EncodingTuning;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.confirm) {
    return NextResponse.json(
      { error: "confirm: true is required for in-place replacement" },
      { status: 400 },
    );
  }

  if (!body.episodeId) {
    return NextResponse.json(
      { error: "episodeId is required" },
      { status: 400 },
    );
  }

  const preset = body.preset?.trim() || DEFAULT_REPLACE_PRESET;
  const allowedPresets = await getConversionPresets("replace");
  if (!allowedPresets.ok) {
    return NextResponse.json(
      { error: allowedPresets.error },
      { status: 503 },
    );
  }
  const allowedIds = new Set(allowedPresets.presets.map((p) => p.id));
  if (!allowedIds.has(preset)) {
    return NextResponse.json(
      { error: `Invalid preset for replace mode: ${preset}` },
      { status: 400 },
    );
  }

  const rootWritable = health.health.sourceRootsWritable ?? {};
  const result = await getEpisodeById(body.episodeId);
  if (!result) {
    return NextResponse.json({ error: "Episode not found" }, { status: 404 });
  }

  const { episode } = result;
  if (!rootWritable[episode.rootKey]) {
    return NextResponse.json(
      {
        error: `Source drive ${episode.rootKey.toUpperCase()} is not writable`,
      },
      { status: 503 },
    );
  }

  const jobResult = await createConversionJob({
    title: getTvAgentTitle(episode),
    sourceTitle: getTvSourceTitle(episode),
    videoFile: episode.videoFile,
    rootKey: episode.rootKey,
    mode: "replace",
    preset,
    tuning: body.tuning,
  });

  if (!jobResult.ok) {
    return NextResponse.json(
      {
        error: jobResult.error,
        outputPath: jobResult.outputPath,
      },
      { status: jobResult.status },
    );
  }

  return NextResponse.json({ jobId: jobResult.job.id, job: jobResult.job });
}

export async function GET() {
  const presets = await getConversionPresets("replace");
  if (!presets.ok) {
    return NextResponse.json({ error: presets.error }, { status: 503 });
  }
  return NextResponse.json({ presets: presets.presets });
}
