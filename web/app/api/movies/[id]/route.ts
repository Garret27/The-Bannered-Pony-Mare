import { NextResponse } from "next/server";
import { formatBytes } from "@/lib/format";
import {
  getMovieById,
  isMoviesLibraryConfigured,
} from "@/lib/movies-library";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  if (!isMoviesLibraryConfigured()) {
    return NextResponse.json(
      { error: "JELLYFIN_URL and JELLYFIN_API_KEY are not configured" },
      { status: 503 },
    );
  }

  const { id } = await context.params;

  try {
    const result = await getMovieById(id);
    if (!result) {
      return NextResponse.json({ error: "Movie not found" }, { status: 404 });
    }

    const { movie } = result;

    return NextResponse.json({
      ...movie,
      sizeLabel: formatBytes(movie.sizeBytes),
    });
  } catch (error) {
    console.error("Failed to get movie:", error);
    return NextResponse.json(
      { error: "Failed to get movie" },
      { status: 500 },
    );
  }
}
