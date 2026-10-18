import { NextResponse } from "next/server";
import {
  createScheduledAnnouncement,
  listScheduledAnnouncements,
  type CreateScheduleInput,
} from "@/lib/announcement-schedules";
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
    const schedules = await listScheduledAnnouncements(event);
    return NextResponse.json({ schedules });
  } catch (error) {
    console.error("Failed to list schedules:", error);
    return NextResponse.json(
      { error: "Failed to list scheduled announcements" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { event } = await context.params;
  if (!isEvent(event)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  let body: CreateScheduleInput;
  try {
    body = (await request.json()) as CreateScheduleInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const schedule = await createScheduledAnnouncement(event, body);
    return NextResponse.json({ schedule, message: "Announcement scheduled" });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to schedule announcement";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
