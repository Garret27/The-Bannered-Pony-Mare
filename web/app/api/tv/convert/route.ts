import { NextResponse } from "next/server";
import {
  createConversionJob,
  getAgentHealth,
  type EncodingTuning,
} from "@/lib/converter-agent";
import {
  getEpisodeById,
  getTvAgentTitle,
  getTvSourceTitle,
  isTvLibraryConfigured,
} from "@/lib/tv-library";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isTvLibraryConfigured()) {
    return NextResponse.json(
      { error: "JELLYFIN_URL and JELLYFIN_API_KEY are not configured" },
      { status: 503 },
    );
  }

  const health = await getAgentHealth();
  if (!health.ok) {
    return NextResponse.json(
      { error: health.error },
      { status: 503 },
    );
  }
  if (health.health.tvOutputWritable !== true) {
    return NextResponse.json(
      { error: "H drive TV Jellyfin output is not writable" },
      { status: 503 },
    );
  }

  let body: {
    episodeId?: string;
    overwrite?: boolean;
    preset?: string;
    tuning?: EncodingTuning;
  };
  try {
    body = (await request.json()) as {
      episodeId?: string;
      overwrite?: boolean;
      preset?: string;
      tuning?: EncodingTuning;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.episodeId) {
    return NextResponse.json({ error: "episodeId is required" }, { status: 400 });
  }

  const preset = body.preset?.trim() || "jellyfin-library";
  const tuning =
    body.tuning && typeof body.tuning === "object" ? body.tuning : undefined;

  if (
    tuning?.audioTrack !== undefined &&
    (!Number.isInteger(tuning.audioTrack) || tuning.audioTrack < 1)
  ) {
    return NextResponse.json(
      { error: "tuning.audioTrack must be an integer >= 1" },
      { status: 400 },
    );
  }

  const result = await getEpisodeById(body.episodeId);
  if (!result) {
    return NextResponse.json({ error: "Episode not found" }, { status: 404 });
  }

  const { episode } = result;
  const jobResult = await createConversionJob({
    title: getTvAgentTitle(episode),
    sourceTitle: getTvSourceTitle(episode),
    videoFile: episode.videoFile,
    rootKey: episode.rootKey,
    overwrite: body.overwrite === true,
    mode: "tv",
    preset,
    tuning,
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
  const health = await getAgentHealth();
  if (!health.ok) {
    return NextResponse.json(
      { ok: false, error: health.error },
      { status: 503 },
    );
  }
  return NextResponse.json(health.health);
}
