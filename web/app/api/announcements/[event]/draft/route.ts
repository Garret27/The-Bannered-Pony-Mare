import { NextResponse } from "next/server";
import { buildAnnouncementDraft } from "@/lib/discord-announcements";
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

  try {
    const draft = await buildAnnouncementDraft(event);
    return NextResponse.json(draft);
  } catch (error) {
    console.error("Failed to build announcement draft:", error);
    return NextResponse.json(
      { error: "Failed to load announcement draft" },
      { status: 500 },
    );
  }
}
