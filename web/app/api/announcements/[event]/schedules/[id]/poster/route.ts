import { NextResponse } from "next/server";
import {
  clearSchedulePosterOverride,
  getScheduledAnnouncement,
  saveSchedulePosterOverride,
} from "@/lib/announcement-schedules";
import { isEvent, getSchedulePosterPath } from "@/lib/paths";
import fs from "fs/promises";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ event: string; id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { event, id } = await context.params;
  if (!isEvent(event)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  const schedule = await getScheduledAnnouncement(event, id);
  if (!schedule) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!schedule.hasPosterOverride) {
    return NextResponse.json({ error: "No poster override" }, { status: 404 });
  }

  try {
    const buffer = await fs.readFile(getSchedulePosterPath(id));
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Poster file missing" }, { status: 404 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { event, id } = await context.params;
  if (!isEvent(event)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length === 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }

    const schedule = await saveSchedulePosterOverride(event, id, buffer);
    return NextResponse.json({
      schedule,
      message: "Poster override saved for this scheduled announcement",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save poster override";
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
    const schedule = await clearSchedulePosterOverride(event, id);
    return NextResponse.json({
      schedule,
      message: "Poster override cleared — event poster will be used",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to clear poster override";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
