import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { isEvent, getSubtitlePath, getSubtitleFilename } from "@/lib/paths";
import { atomicWrite } from "@/lib/atomic-write";
import { publishResultToMessage, publishSubtitle } from "@/lib/deploy";
import {
  parseSrt,
  serializeSrt,
  validateSrt,
  type SrtCue,
} from "@/lib/srt";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ event: string }>;
};

async function readSubtitleFile(event: Parameters<typeof getSubtitlePath>[0]) {
  const outputPath = getSubtitlePath(event);
  const content = await fs.readFile(outputPath, "utf-8");
  const stat = await fs.stat(outputPath);
  const cues = parseSrt(content);

  return {
    content,
    cues,
    cueCount: cues.length,
    filename: getSubtitleFilename(event),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

export async function GET(_request: Request, context: RouteContext) {
  const { event } = await context.params;

  if (!isEvent(event)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  try {
    const data = await readSubtitleFile(event);
    return NextResponse.json(data);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return NextResponse.json(
        { error: "Subtitle file not found" },
        { status: 404 },
      );
    }
    console.error("Failed to read subtitle:", error);
    return NextResponse.json(
      { error: "Failed to read subtitle" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const { event } = await context.params;

  if (!isEvent(event)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  try {
    const body = (await request.json()) as {
      content?: string;
      cues?: SrtCue[];
    };

    let content: string;

    if (typeof body.content === "string") {
      content = body.content;
    } else if (Array.isArray(body.cues)) {
      content = serializeSrt(body.cues);
    } else {
      return NextResponse.json(
        { error: "Provide either 'content' (raw SRT) or 'cues' (structured array)" },
        { status: 400 },
      );
    }

    const cues = parseSrt(content);
    const issues = validateSrt(cues);
    const errors = issues.filter((issue) => issue.severity === "error");

    if (errors.length > 0) {
      return NextResponse.json(
        { error: "Invalid subtitle content", issues },
        { status: 400 },
      );
    }

    const outputPath = getSubtitlePath(event);
    await atomicWrite(outputPath, content);
    const stat = await fs.stat(outputPath);
    const github = await publishSubtitle(event);

    return NextResponse.json({
      message: publishResultToMessage("Subtitle", github),
      filename: getSubtitleFilename(event),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      cueCount: cues.length,
      issues: issues.filter((issue) => issue.severity === "warning"),
      github,
    });
  } catch (error) {
    console.error("Failed to save subtitle:", error);
    return NextResponse.json(
      { error: "Failed to save subtitle" },
      { status: 500 },
    );
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

    const ext = path.extname(file.name).toLowerCase();
    if (ext !== ".srt") {
      return NextResponse.json(
        { error: "Invalid file type. Only .srt files are accepted." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const outputPath = getSubtitlePath(event);

    await atomicWrite(outputPath, buffer);

    const stat = await fs.stat(outputPath);
    const cues = parseSrt(buffer.toString("utf-8"));
    const github = await publishSubtitle(event);

    return NextResponse.json({
      message: publishResultToMessage("Subtitle", github),
      filename: getSubtitleFilename(event),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      cueCount: cues.length,
      github,
    });
  } catch (error) {
    console.error("Failed to save subtitle:", error);
    return NextResponse.json(
      { error: "Failed to save subtitle" },
      { status: 500 },
    );
  }
}
