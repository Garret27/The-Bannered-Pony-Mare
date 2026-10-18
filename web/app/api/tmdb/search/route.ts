import { NextResponse } from "next/server";
import {
  isTmdbConfigured,
  searchMovies,
  TmdbApiError,
  TmdbConfigError,
} from "@/lib/tmdb";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";

  if (!query.trim()) {
    return NextResponse.json({ results: [] });
  }

  if (!isTmdbConfigured()) {
    return NextResponse.json(
      { error: "TMDB_API_KEY is not configured" },
      { status: 503 },
    );
  }

  try {
    const results = await searchMovies(query);
    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof TmdbConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof TmdbApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("TMDB search failed:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
