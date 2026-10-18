import { NextResponse } from "next/server";
import { EVENTS } from "@/lib/paths";
import { getEventFileStatus } from "@/lib/files";
import { readRedirects } from "@/lib/redirects";
import { readEventTitles } from "@/lib/event-titles";
import { parseMovieTitleFromRedirectUrl } from "@/lib/discord-announcements";

export const runtime = "nodejs";

export async function GET() {
  try {
    const events = Object.fromEntries(
      await Promise.all(
        EVENTS.map(async (event) => [event, await getEventFileStatus(event)]),
      ),
    );
    const [redirects, movieTitles] = await Promise.all([
      readRedirects(),
      readEventTitles(),
    ]);

    const displayTitles = Object.fromEntries(
      EVENTS.map((event) => [
        event,
        movieTitles[event] ||
          parseMovieTitleFromRedirectUrl(redirects[event].url),
      ]),
    );

    return NextResponse.json({
      events,
      redirects,
      movieTitles: displayTitles,
    });
  } catch (error) {
    console.error("Failed to read status:", error);
    return NextResponse.json(
      { error: "Failed to read current file status" },
      { status: 500 },
    );
  }
}
