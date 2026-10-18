import { NextResponse } from "next/server";
import { formatBytes } from "@/lib/format";
import {
  formatEpisodeCode,
  getEpisodeById,
  isTvLibraryConfigured,
} from "@/lib/tv-library";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  if (!isTvLibraryConfigured()) {
    return NextResponse.json(
      { error: "JELLYFIN_URL and JELLYFIN_API_KEY are not configured" },
      { status: 503 },
    );
  }

  const { id } = await context.params;

  try {
    const result = await getEpisodeById(id);
    if (!result) {
      return NextResponse.json({ error: "Episode not found" }, { status: 404 });
    }

    const { episode } = result;
    return NextResponse.json({
      ...episode,
      code: formatEpisodeCode(episode.season, episode.episode),
      sizeLabel: formatBytes(episode.sizeBytes),
    });
  } catch (error) {
    console.error("Failed to get episode:", error);
    return NextResponse.json(
      { error: "Failed to get episode" },
      { status: 500 },
    );
  }
}
