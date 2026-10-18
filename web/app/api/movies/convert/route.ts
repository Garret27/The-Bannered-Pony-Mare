import { NextResponse } from "next/server";
import {
  createConversionJob,
  getAgentHealth,
  type EncodingTuning,
} from "@/lib/converter-agent";
import {
  getAgentTitle,
  getMovieById,
  isMoviesLibraryConfigured,
} from "@/lib/movies-library";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isMoviesLibraryConfigured()) {
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
  if (!health.health.outputWritable) {
    return NextResponse.json(
      { error: "J drive output is not writable" },
      { status: 503 },
    );
  }

  let body: {
    movieId?: string;
    overwrite?: boolean;
    preset?: string;
    tuning?: EncodingTuning;
  };
  try {
    body = (await request.json()) as {
      movieId?: string;
      overwrite?: boolean;
      preset?: string;
      tuning?: EncodingTuning;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.movieId) {
    return NextResponse.json({ error: "movieId is required" }, { status: 400 });
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

  const result = await getMovieById(body.movieId);
  if (!result) {
    return NextResponse.json({ error: "Movie not found" }, { status: 404 });
  }

  const { movie } = result;
  const jobResult = await createConversionJob({
    title: getAgentTitle(movie),
    videoFile: movie.videoFile,
    rootKey: movie.rootKey,
    overwrite: body.overwrite === true,
    mode: "jellyfin",
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
