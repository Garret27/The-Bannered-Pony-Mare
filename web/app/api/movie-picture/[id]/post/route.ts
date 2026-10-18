import { NextResponse } from "next/server";
import { postPhotoToDiscord } from "@/lib/discord-photo";
import { EVENT_LABELS, isEvent } from "@/lib/paths";
import {
  readPhotoBuffer,
  VrchatPhotoNotFoundError,
} from "@/lib/vrchat-photos";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type PostBody = {
  event?: string;
  caption?: string;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.event || !isEvent(body.event)) {
    return NextResponse.json(
      { error: "event must be 'main' or 'hspc'" },
      { status: 400 },
    );
  }

  try {
    const { buffer, filename } = await readPhotoBuffer(id);
    const result = await postPhotoToDiscord(
      body.event,
      buffer,
      filename,
      body.caption,
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status ?? 400 },
      );
    }

    return NextResponse.json({
      message: `Photo posted to ${EVENT_LABELS[body.event]} Discord`,
    });
  } catch (error) {
    if (error instanceof VrchatPhotoNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error("Failed to post VRChat photo to Discord:", error);
    return NextResponse.json(
      { error: "Failed to post photo to Discord" },
      { status: 500 },
    );
  }
}
