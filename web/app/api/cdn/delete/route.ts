import { NextResponse } from "next/server";
import {
  deleteFileFromBunny,
  isBunnyConfigured,
  isSafeBunnyFilename,
} from "@/lib/bunny-storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isBunnyConfigured()) {
    return NextResponse.json(
      { error: "Bunny storage is not configured" },
      { status: 503 },
    );
  }

  let body: { filename?: string };
  try {
    body = (await request.json()) as { filename?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const filename = body.filename?.trim();
  if (!filename || !isSafeBunnyFilename(filename)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  try {
    await deleteFileFromBunny(filename);
    return NextResponse.json({
      message: `Deleted ${filename} from Bunny`,
      filename,
    });
  } catch (error) {
    console.error("Bunny delete failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete from Bunny",
      },
      { status: 500 },
    );
  }
}
