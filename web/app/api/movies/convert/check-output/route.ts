import { NextResponse } from "next/server";
import { checkOutputOnAgent } from "@/lib/converter-agent";
import {
  getAgentTitle,
  getMovieById,
  isMoviesLibraryConfigured,
} from "@/lib/movies-library";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isMoviesLibraryConfigured()) {
    return NextResponse.json(
      { error: "JELLYFIN_URL and JELLYFIN_API_KEY are not configured" },
      { status: 503 },
    );
  }

  const movieId = new URL(request.url).searchParams.get("movieId");
  if (!movieId) {
    return NextResponse.json({ error: "movieId is required" }, { status: 400 });
  }

  const result = await getMovieById(movieId);
  if (!result) {
    return NextResponse.json({ error: "Movie not found" }, { status: 404 });
  }

  const checkResult = await checkOutputOnAgent({
    title: getAgentTitle(result.movie),
    videoFile: result.movie.videoFile,
  });

  if (!checkResult.ok) {
    return NextResponse.json({ error: checkResult.error }, { status: 503 });
  }

  return NextResponse.json(checkResult.check);
}
