import { NextResponse } from "next/server";
import {
  formatEpisodeCode,
  isTvLibraryConfigured,
  listRecentlyAddedTvEpisodes,
  listRecentlyAddedTvSeries,
  searchTvSeries,
} from "@/lib/tv-library";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isTvLibraryConfigured()) {
    return NextResponse.json(
      { error: "JELLYFIN_URL and JELLYFIN_API_KEY are not configured" },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? undefined;
  const page = Number(searchParams.get("page") ?? "1");
  const limit = Number(searchParams.get("limit") ?? "48");
  const recent = searchParams.get("recent") === "true";
  const recentEpisodes = searchParams.get("recentEpisodes") === "true";

  try {
    if (recentEpisodes) {
      const episodes = await listRecentlyAddedTvEpisodes(limit);
      return NextResponse.json({
        episodes: episodes.map((episode) => ({
          ...episode,
          code: formatEpisodeCode(episode.season, episode.episode),
        })),
      });
    }
    if (recent) {
      const series = await listRecentlyAddedTvSeries(limit);
      return NextResponse.json({ series });
    }
    const result = await searchTvSeries({ query: q, page, limit });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to list TV series:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to list TV series",
      },
      { status: 500 },
    );
  }
}
