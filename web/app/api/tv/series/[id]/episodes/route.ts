import { NextResponse } from "next/server";
import {
  getJellyfinItemById,
  isTvJellyfinOutputPath,
} from "@/lib/jellyfin";
import {
  formatEpisodeCode,
  groupEpisodesIntoSeasons,
  isTvLibraryConfigured,
  listEpisodesForSeries,
  markConvertedEpisodes,
} from "@/lib/tv-library";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  if (!isTvLibraryConfigured()) {
    return NextResponse.json(
      { error: "JELLYFIN_URL and JELLYFIN_API_KEY are not configured" },
      { status: 503 },
    );
  }

  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const seasonParam = searchParams.get("season");
  const checkConverted = searchParams.get("checkConverted") === "true";

  try {
    const raw = await getJellyfinItemById(id);
    if (!raw) {
      return NextResponse.json({ error: "Series not found" }, { status: 404 });
    }
    if (raw.Path && isTvJellyfinOutputPath(raw.Path)) {
      return NextResponse.json(
        { error: "This show is already in the Jellyfin TV library" },
        { status: 404 },
      );
    }

    let episodes = await listEpisodesForSeries(id);

    if (seasonParam !== null) {
      const season = Number.parseInt(seasonParam, 10);
      if (!Number.isNaN(season)) {
        episodes = episodes.filter((episode) => episode.season === season);
      }
    }

    if (checkConverted) {
      episodes = await markConvertedEpisodes(episodes);
    } else {
      episodes = episodes.map((episode) => ({ ...episode, converted: false }));
    }

    const mappedEpisodes = episodes.map((episode) => ({
      ...episode,
      code: formatEpisodeCode(episode.season, episode.episode),
    }));

    if (checkConverted && seasonParam !== null) {
      return NextResponse.json({
        convertedIds: mappedEpisodes
          .filter((episode) => episode.converted)
          .map((episode) => episode.id),
        episodes: mappedEpisodes,
      });
    }

    const seasons = groupEpisodesIntoSeasons(
      checkConverted
        ? episodes
        : episodes.map((episode) => ({ ...episode, converted: false })),
    );

    return NextResponse.json({
      series: {
        id: raw.Id,
        title: raw.Name,
        year: raw.ProductionYear || undefined,
        hasPoster: Boolean(raw.ImageTags?.Primary),
        overview: raw.Overview,
      },
      seasons,
      episodes: mappedEpisodes,
    });
  } catch (error) {
    console.error("Failed to list episodes:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to list episodes",
      },
      { status: 500 },
    );
  }
}
