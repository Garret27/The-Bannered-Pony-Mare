import { NextResponse } from "next/server";
import { scanJellyfinOutputLibrary } from "@/lib/jellyfin-output";

export const runtime = "nodejs";

export async function GET() {
  try {
    const files = await scanJellyfinOutputLibrary();
    return NextResponse.json({ files });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to scan Jellyfin output folder",
        files: [],
      },
      { status: 503 },
    );
  }
}
