import { NextResponse } from "next/server";
import { getJellyfinHealth } from "@/lib/jellyfin";
import {
  getMoviesRoots,
  isMoviesLibraryConfigured,
} from "@/lib/movies-library";

export const runtime = "nodejs";

export async function GET() {
  const jellyfinConfigured = isMoviesLibraryConfigured();
  const movieRoots = getMoviesRoots();

  if (!jellyfinConfigured) {
    return NextResponse.json(
      {
        ok: false,
        jellyfin: { ok: false, error: "Jellyfin is not configured" },
        filesystem: { roots: movieRoots, configured: movieRoots.length > 0 },
      },
      { status: 503 },
    );
  }

  const jellyfin = await getJellyfinHealth();

  return NextResponse.json({
    ok: jellyfin.ok,
    jellyfin,
    filesystem: {
      roots: movieRoots,
      configured: movieRoots.length > 0,
    },
  });
}
