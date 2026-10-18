import { NextResponse } from "next/server";
import {
  isOpenSubtitlesConfigured,
  OpenSubtitlesApiError,
  OpenSubtitlesConfigError,
  searchSubtitlesByFeature,
} from "@/lib/opensubtitles";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isOpenSubtitlesConfigured()) {
    return NextResponse.json(
      { error: "OPENSUBTITLES_API_KEY is not configured" },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json()) as {
      featureId?: number;
      languages?: string;
    };

    const featureId = Number(body.featureId);
    if (!Number.isFinite(featureId) || featureId <= 0) {
      return NextResponse.json(
        { error: "featureId is required" },
        { status: 400 },
      );
    }

    const results = await searchSubtitlesByFeature({
      featureId,
      languages: body.languages ?? "en",
    });

    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof OpenSubtitlesConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof OpenSubtitlesApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("OpenSubtitles subtitle search failed:", error);
    return NextResponse.json({ error: "Subtitle search failed" }, { status: 500 });
  }
}
