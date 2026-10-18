import { NextResponse } from "next/server";
import {
  cancelScheduledAnnouncement,
  updateScheduledAnnouncement,
  type UpdateScheduleInput,
} from "@/lib/announcement-schedules";
import { isEvent } from "@/lib/paths";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ event: string; id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { event, id } = await context.params;
  if (!isEvent(event)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  let body: UpdateScheduleInput;
  try {
    body = (await request.json()) as UpdateScheduleInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const schedule = await updateScheduledAnnouncement(event, id, body);
    return NextResponse.json({ schedule, message: "Schedule updated" });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update schedule";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { event, id } = await context.params;
  if (!isEvent(event)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  try {
    const schedule = await cancelScheduledAnnouncement(event, id);
    return NextResponse.json({ schedule, message: "Schedule cancelled" });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to cancel schedule";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
