import { NextResponse } from "next/server";
import fs from "fs/promises";
import {
  buildCdnUrl,
  fileExistsOnBunny,
  isBunnyConfigured,
  uploadFileToBunny,
} from "@/lib/bunny-storage";
import { prepareMp4UploadFromFile } from "@/lib/mp4-faststart";
import { createBunnyUploadJob } from "@/lib/bunny-upload-jobs";
import { createCountingReadStream } from "@/lib/stream-upload";
export const runtime = "nodejs";
export const maxDuration = 3600;

export async function POST(request: Request) {
  if (!isBunnyConfigured()) {
    return NextResponse.json(
      { error: "Bunny storage is not configured" },
      { status: 503 },
    );
  }

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    let body: { jellyfinRelativePath?: string; overwrite?: boolean };
    try {
      body = (await request.json()) as {
        jellyfinRelativePath?: string;
        overwrite?: boolean;
      };
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!body.jellyfinRelativePath?.trim()) {
      return NextResponse.json(
        { error: "jellyfinRelativePath is required" },
        { status: 400 },
      );
    }

    const filename = body.jellyfinRelativePath.split(/[/\\]/).pop() ?? "";
    if (!filename.toLowerCase().endsWith(".mp4")) {
      return NextResponse.json(
        { error: "Only .mp4 files can be uploaded" },
        { status: 400 },
      );
    }

    if (!body.overwrite && (await fileExistsOnBunny(filename))) {
      return NextResponse.json(
        {
          error: "File already exists on Bunny",
          filename,
          cdnUrl: buildCdnUrl(filename),
        },
        { status: 409 },
      );
    }

    try {
      const job = await createBunnyUploadJob({
        relativePath: body.jellyfinRelativePath.trim(),
        overwrite: body.overwrite === true,
      });

      return NextResponse.json({
        mode: "jellyfin",
        jobId: job.id,
        job,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Upload failed to start";
      const status = message.includes("already exists") ? 409 : 500;
      return NextResponse.json({ error: message }, { status });
    }
  }

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    const overwrite = formData.get("overwrite") === "true";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".mp4")) {
      return NextResponse.json(
        { error: "Only .mp4 files are supported" },
        { status: 400 },
      );
    }

    const filename = file.name;

    if (!overwrite && (await fileExistsOnBunny(filename))) {
      return NextResponse.json(
        {
          error: "File already exists on Bunny",
          filename,
          cdnUrl: buildCdnUrl(filename),
        },
        { status: 409 },
      );
    }

    try {
      const prepared = await prepareMp4UploadFromFile(file);
      try {
        const stat = await fs.stat(prepared.uploadPath);
        const uploadStream = createCountingReadStream(prepared.uploadPath, () => {});
        const { cdnUrl } = await uploadFileToBunny(
          filename,
          uploadStream as unknown as BodyInit,
          stat.size,
        );
        return NextResponse.json({
          mode: "direct",
          filename,
          cdnUrl,
        });
      } finally {
        await prepared.cleanup();
      }
    } catch (error) {
      console.error("Bunny direct upload failed:", error);
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Upload failed",
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json(
    { error: "Expected multipart/form-data or application/json" },
    { status: 400 },
  );
}
