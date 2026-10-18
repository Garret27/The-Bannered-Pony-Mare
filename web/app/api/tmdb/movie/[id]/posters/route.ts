import { NextResponse } from "next/server";
import {
  getMoviePosters,
  isTmdbConfigured,
  TmdbApiError,
  TmdbConfigError,
} from "@/lib/tmdb";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const movieId = Number.parseInt(id, 10);

  if (Number.isNaN(movieId)) {
    return NextResponse.json({ error: "Invalid movie ID" }, { status: 400 });
  }

  if (!isTmdbConfigured()) {
    return NextResponse.json(
      { error: "TMDB_API_KEY is not configured" },
      { status: 503 },
    );
  }

  try {
    const posters = await getMoviePosters(movieId);
    return NextResponse.json({ posters });
  } catch (error) {
    if (error instanceof TmdbConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof TmdbApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("TMDB poster fetch failed:", error);
    return NextResponse.json({ error: "Failed to load posters" }, { status: 500 });
  }
}
