import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { fetchJellyfinPoster } from "@/lib/jellyfin";
import {
  getPosterMimeType,
  isMoviesLibraryConfigured,
  movieUsesJellyfinPoster,
  resolveMoviePosterPath,
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
    if (await movieUsesJellyfinPoster(id)) {
      const poster = await fetchJellyfinPoster(id);
      if (poster) {
        return new NextResponse(new Uint8Array(poster.data), {
          headers: {
            "Content-Type": poster.contentType,
            "Cache-Control": "public, max-age=3600",
          },
        });
      }
    }

    const posterPath = await resolveMoviePosterPath(id);
    if (!posterPath) {
      return NextResponse.json({ error: "Poster not found" }, { status: 404 });
    }

    const data = await fs.readFile(posterPath);
    const mimeType = getPosterMimeType(path.extname(posterPath).slice(1));

    return new NextResponse(data, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Failed to load movie poster:", error);
    return NextResponse.json(
      { error: "Failed to load poster" },
      { status: 500 },
    );
  }
}
