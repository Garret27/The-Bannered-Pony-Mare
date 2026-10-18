import { NextResponse } from "next/server";
import { probeVideoMetadata } from "@/lib/ffmpeg";
import {
  getEpisodeById,
  isTvLibraryConfigured,
  resolveEpisodeVideoPath,
} from "@/lib/tv-library";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export async function GET(_request: Request, context: RouteContext) {
  if (!isTvLibraryConfigured()) {
    return NextResponse.json(
      { error: "JELLYFIN_URL and JELLYFIN_API_KEY are not configured" },
      { status: 503 },
    );
  }

  const { id } = await context.params;

  try {
    const videoPath = await resolveEpisodeVideoPath(id);
    if (!videoPath) {
      return NextResponse.json({ error: "Episode not found" }, { status: 404 });
    }

    const episodeInfo = await getEpisodeById(id);
    if (!episodeInfo) {
      return NextResponse.json({ error: "Episode not found" }, { status: 404 });
    }

    const metadata = await probeVideoMetadata(videoPath);

    return NextResponse.json({
      episodeId: id,
      durationSec: metadata.durationSec,
      durationLabel: formatDuration(metadata.durationSec),
      width: metadata.width,
      height: metadata.height,
      resolution:
        metadata.width && metadata.height
          ? `${metadata.width}×${metadata.height}`
          : null,
      videoCodec: metadata.videoCodec,
      audioTrackCount: metadata.audioTracks.length,
      audioLanguages: metadata.audioTracks.map((t) => t.language),
      audioTracks: metadata.audioTracks,
      subtitleTrackCount: metadata.subtitleTrackCount,
    });
  } catch (error) {
    console.error("Failed to probe episode:", error);
    return NextResponse.json(
      { error: "Failed to probe episode metadata" },
      { status: 500 },
    );
  }
}
