import { NextResponse } from "next/server";
import { readEventTitles, writeEventTitle } from "@/lib/event-titles";
import { isEvent } from "@/lib/paths";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ event: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { event } = await context.params;
  if (!isEvent(event)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  const titles = await readEventTitles();
  return NextResponse.json({ event, movieTitle: titles[event] });
}

export async function PUT(request: Request, context: RouteContext) {
  const { event } = await context.params;
  if (!isEvent(event)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  try {
    const body = (await request.json()) as { movieTitle?: unknown };
    if (typeof body.movieTitle !== "string") {
      return NextResponse.json(
        { error: "movieTitle must be a string" },
        { status: 400 },
      );
    }

    const movieTitle = body.movieTitle.trim();
    if (movieTitle.length > 200) {
      return NextResponse.json(
        { error: "Movie title must be 200 characters or fewer" },
        { status: 400 },
      );
    }

    const titles = await writeEventTitle(event, movieTitle);
    return NextResponse.json({
      message: movieTitle ? "Movie title saved" : "Movie title cleared",
      event,
      movieTitle: titles[event],
    });
  } catch (error) {
    console.error("Failed to save movie title:", error);
    return NextResponse.json(
      { error: "Failed to save movie title" },
      { status: 500 },
    );
  }
}
