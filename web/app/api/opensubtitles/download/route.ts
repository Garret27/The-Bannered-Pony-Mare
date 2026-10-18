import fs from "fs/promises";
import { NextResponse } from "next/server";
import { atomicWrite } from "@/lib/atomic-write";
import {
  downloadSubtitle,
  isOpenSubtitlesConfigured,
  OpenSubtitlesApiError,
  OpenSubtitlesConfigError,
} from "@/lib/opensubtitles";
import { isEvent, getSubtitlePath, getSubtitleFilename } from "@/lib/paths";
import { countCues } from "@/lib/srt";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isOpenSubtitlesConfigured()) {
    return NextResponse.json(
      { error: "OPENSUBTITLES_API_KEY is not configured" },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json()) as {
      fileId?: number;
      event?: string;
      previewOnly?: boolean;
    };

    if (!body.fileId || body.fileId <= 0) {
      return NextResponse.json({ error: "fileId is required" }, { status: 400 });
    }

    const content = await downloadSubtitle(body.fileId);

    if (body.previewOnly) {
      return NextResponse.json({
        preview: content.slice(0, 2000),
        cueCount: countCues(content),
      });
    }

    if (!body.event || !isEvent(body.event)) {
      return NextResponse.json(
        { error: "event is required (main or hspc)" },
        { status: 400 },
      );
    }

    const outputPath = getSubtitlePath(body.event);
    await atomicWrite(outputPath, content);
    const stat = await fs.stat(outputPath);

    return NextResponse.json({
      message: "Subtitle downloaded and applied",
      filename: getSubtitleFilename(body.event),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      cueCount: countCues(content),
      preview: content.slice(0, 2000),
    });
  } catch (error) {
    if (error instanceof OpenSubtitlesConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof OpenSubtitlesApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("OpenSubtitles download failed:", error);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
