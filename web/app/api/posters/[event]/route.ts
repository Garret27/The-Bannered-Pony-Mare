import fs from "fs/promises";
import { NextResponse } from "next/server";
import { isEvent, getPosterPath } from "@/lib/paths";
import { publishResultToMessage } from "@/lib/deploy";
import { savePosterBuffer } from "@/lib/poster";

export const runtime = "nodejs";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

type RouteContext = {
  params: Promise<{ event: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { event } = await context.params;

  if (!isEvent(event)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  try {
    const filePath = getPosterPath(event);
    const data = await fs.readFile(filePath);

    return new NextResponse(data, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-cache",
      },
    });
  } catch {
    return NextResponse.json({ error: "Poster not found" }, { status: 404 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { event } = await context.params;

  if (!isEvent(event)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "No file uploaded. Use field name 'file'." },
        { status: 400 },
      );
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Use JPG, PNG, WebP, or GIF." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await savePosterBuffer(event, buffer);

    return NextResponse.json({
      message: publishResultToMessage("Poster", saved.github),
      ...saved,
    });
  } catch (error) {
    console.error("Failed to process poster:", error);
    return NextResponse.json(
      { error: "Failed to process poster" },
      { status: 500 },
    );
  }
}
