import { NextResponse } from "next/server";
import { sendScheduledAnnouncementNow } from "@/lib/announcement-schedules";
import { isEvent } from "@/lib/paths";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ event: string; id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { event, id } = await context.params;
  if (!isEvent(event)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  try {
    const schedule = await sendScheduledAnnouncementNow(event, id);
    return NextResponse.json({
      schedule,
      message: "Announcement posted to Discord",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send announcement";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
