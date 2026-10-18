import { NextResponse } from "next/server";
import {
  isOpenSubtitlesConfigured,
  OpenSubtitlesApiError,
  OpenSubtitlesConfigError,
  searchFeatures,
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
      query?: string;
      year?: number;
    };

    const query = body.query?.trim();
    if (!query || query.length < 2) {
      return NextResponse.json(
        { error: "Query must be at least 2 characters" },
        { status: 400 },
      );
    }

    const features = await searchFeatures({
      query,
      year: body.year,
    });

    return NextResponse.json({ features });
  } catch (error) {
    if (error instanceof OpenSubtitlesConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof OpenSubtitlesApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("OpenSubtitles feature search failed:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
