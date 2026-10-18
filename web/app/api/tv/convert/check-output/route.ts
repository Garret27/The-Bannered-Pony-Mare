import { NextResponse } from "next/server";
import { checkOutputOnAgent } from "@/lib/converter-agent";
import {
  getEpisodeById,
  getTvAgentTitle,
  isTvLibraryConfigured,
} from "@/lib/tv-library";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isTvLibraryConfigured()) {
    return NextResponse.json(
      { error: "JELLYFIN_URL and JELLYFIN_API_KEY are not configured" },
      { status: 503 },
    );
  }

  const episodeId = new URL(request.url).searchParams.get("episodeId");
  if (!episodeId) {
    return NextResponse.json({ error: "episodeId is required" }, { status: 400 });
  }

  const result = await getEpisodeById(episodeId);
  if (!result) {
    return NextResponse.json({ error: "Episode not found" }, { status: 404 });
  }

  const checkResult = await checkOutputOnAgent({
    title: getTvAgentTitle(result.episode),
    videoFile: result.episode.videoFile,
    mode: "tv",
  });

  if (!checkResult.ok) {
    return NextResponse.json({ error: checkResult.error }, { status: 503 });
  }

  return NextResponse.json(checkResult.check);
}
