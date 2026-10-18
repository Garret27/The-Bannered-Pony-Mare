import { NextResponse } from "next/server";
import { isEvent } from "@/lib/paths";
import { publishResultToMessage } from "@/lib/deploy";
import { writeEventTitle } from "@/lib/event-titles";
import { savePosterBuffer } from "@/lib/poster";
import {
  downloadPoster,
  isTmdbConfigured,
  TmdbApiError,
  TmdbConfigError,
} from "@/lib/tmdb";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ event: string }>;
};

type ApplyBody = {
  filePath?: string;
  movieTitle?: string;
  applyMovieTitle?: boolean;
};

export async function POST(request: Request, context: RouteContext) {
  const { event } = await context.params;

  if (!isEvent(event)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  if (!isTmdbConfigured()) {
    return NextResponse.json(
      { error: "TMDB_API_KEY is not configured" },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json()) as ApplyBody;

    if (!body.filePath || typeof body.filePath !== "string") {
      return NextResponse.json(
        { error: "filePath is required" },
        { status: 400 },
      );
    }

    if (
      body.applyMovieTitle === true &&
      (typeof body.movieTitle !== "string" || !body.movieTitle.trim())
    ) {
      return NextResponse.json(
        { error: "movieTitle is required when applying the title" },
        { status: 400 },
      );
    }

    const buffer = await downloadPoster(body.filePath);
    const saved = await savePosterBuffer(event, buffer);
    let movieTitle: string | undefined;
    if (body.applyMovieTitle === true) {
      movieTitle = body.movieTitle!.trim().slice(0, 200);
      await writeEventTitle(event, movieTitle);
    }

    return NextResponse.json({
      message: publishResultToMessage("Poster", saved.github),
      movieTitle,
      ...saved,
    });
  } catch (error) {
    if (error instanceof TmdbConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof TmdbApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to apply TMDB poster:", error);
    return NextResponse.json(
      { error: "Failed to apply poster" },
      { status: 500 },
    );
  }
}
