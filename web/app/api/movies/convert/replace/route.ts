import { NextResponse } from "next/server";
import {
  createConversionJob,
  getAgentHealth,
  getConversionPresets,
  type EncodingTuning,
} from "@/lib/converter-agent";
import {
  getAgentTitle,
  getMovieById,
  isMoviesLibraryConfigured,
} from "@/lib/movies-library";

export const runtime = "nodejs";

const DEFAULT_REPLACE_PRESET = "jellyfin-balanced";

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

  let body: {
    movieId?: string;
    preset?: string;
    confirm?: boolean;
    tuning?: EncodingTuning;
  };
  try {
    body = (await request.json()) as {
      movieId?: string;
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

  if (!body.movieId) {
    return NextResponse.json({ error: "movieId is required" }, { status: 400 });
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
  const result = await getMovieById(body.movieId);
  if (!result) {
    return NextResponse.json({ error: "Movie not found" }, { status: 404 });
  }

  const { movie } = result;
  if (!rootWritable[movie.rootKey]) {
    return NextResponse.json(
      { error: `Source drive ${movie.rootKey.toUpperCase()} is not writable` },
      { status: 503 },
    );
  }

  const jobResult = await createConversionJob({
    title: getAgentTitle(movie),
    videoFile: movie.videoFile,
    rootKey: movie.rootKey,
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
