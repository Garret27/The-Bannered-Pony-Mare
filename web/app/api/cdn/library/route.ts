import { NextResponse } from "next/server";
import { isBunnyConfigured, listMovies } from "@/lib/bunny-storage";

export const runtime = "nodejs";

export async function GET() {
  if (!isBunnyConfigured()) {
    return NextResponse.json(
      { error: "Bunny storage is not configured" },
      { status: 503 },
    );
  }

  try {
    const movies = await listMovies();
    return NextResponse.json({ movies, total: movies.length });
  } catch (error) {
    console.error("Failed to list Bunny library:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list CDN files" },
      { status: 500 },
    );
  }
}
