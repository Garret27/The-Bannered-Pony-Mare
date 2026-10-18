import { NextResponse } from "next/server";
import { postAnnouncement, type SendAnnouncementInput } from "@/lib/discord-announcements";
import { isEvent } from "@/lib/paths";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ event: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { event } = await context.params;

  if (!isEvent(event)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  let body: SendAnnouncementInput;
  try {
    body = (await request.json()) as SendAnnouncementInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await postAnnouncement(event, body);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
    }

    return NextResponse.json({ message: "Announcement posted to Discord" });
  } catch (error) {
    console.error("Failed to post announcement:", error);
    return NextResponse.json(
      { error: "Failed to post announcement to Discord" },
      { status: 500 },
    );
  }
}
