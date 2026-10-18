import { NextResponse } from "next/server";
import {
  getEpisodePoster,
  getSeriesPoster,
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
    const poster =
      (await getSeriesPoster(id)) ?? (await getEpisodePoster(id));
    if (!poster) {
      return NextResponse.json({ error: "Poster not found" }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(poster.data), {
      headers: {
        "Content-Type": poster.contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Failed to load TV poster:", error);
    return NextResponse.json(
      { error: "Failed to load poster" },
      { status: 500 },
    );
  }
}
