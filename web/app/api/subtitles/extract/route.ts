import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { atomicWrite } from "@/lib/atomic-write";
import {
  extractTrack,
  isPathInsideDir,
  listSidecarSubtitles,
  probeSubtitleTracks,
  type SidecarSubtitle,
} from "@/lib/ffmpeg";
import {
  isDockerLibraryPath,
  mapHostLibraryPathToDocker,
} from "@/lib/jellyfin";
import {
  getMoviesRoots,
  isMoviesLibraryConfigured,
  resolveMovieVideoPath,
} from "@/lib/movies-library";
import { resolveEpisodeVideoPath } from "@/lib/tv-library";
import { getSubtitleFilename, getSubtitlePath, isEvent } from "@/lib/paths";

export const runtime = "nodejs";

const TEMP_ROOT = path.join("/tmp", "movie-night-extract");
const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mkv",
  ".avi",
  ".mov",
  ".webm",
  ".m4v",
  ".wmv",
  ".mpg",
  ".mpeg",
]);

type TempSession = {
  videoPath: string;
  originalName: string;
  sidecars: SidecarSubtitle[];
};

const sessions = new Map<string, TempSession>();

async function ensureTempRoot() {
  await fs.mkdir(TEMP_ROOT, { recursive: true });
}

async function cleanupSession(tempId: string) {
  const session = sessions.get(tempId);
  if (!session) return;

  sessions.delete(tempId);
  const sessionDir = path.dirname(session.videoPath);
  // Library probes point at the real movie path — only delete upload temp dirs.
  if (sessionDir.startsWith(TEMP_ROOT)) {
    await fs.rm(sessionDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function applyContent(
  content: string,
  event: string | undefined,
  tempId: string,
) {
  if (event && isEvent(event)) {
    const subtitlePath = getSubtitlePath(event);
    await atomicWrite(subtitlePath, content);
    const stat = await fs.stat(subtitlePath);

    await cleanupSession(tempId);

    return NextResponse.json({
      message: "Subtitle extracted and applied",
      filename: getSubtitleFilename(event),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      preview: content.slice(0, 2000),
    });
  }

  return NextResponse.json({
    message: "Subtitle extracted",
    preview: content.slice(0, 2000),
    content,
  });
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const body = (await request.json()) as {
        action?: string;
        movieId?: string;
        videoPath?: string;
        tempId?: string;
        streamIndex?: number;
        sidecarId?: string;
        event?: string;
      };

      if (body.action === "probe_library" || body.action === "probe_path") {
        let videoPath: string | null = null;

        if (body.action === "probe_library") {
          if (!body.movieId) {
            return NextResponse.json(
              { error: "movieId is required" },
              { status: 400 },
            );
          }

          if (!isMoviesLibraryConfigured()) {
            return NextResponse.json(
              { error: "JELLYFIN_URL and JELLYFIN_API_KEY are not configured" },
              { status: 503 },
            );
          }

          videoPath = await resolveMovieVideoPath(body.movieId);
          if (!videoPath) {
            videoPath = await resolveEpisodeVideoPath(body.movieId);
          }
          if (!videoPath) {
            return NextResponse.json({ error: "Media not found" }, { status: 404 });
          }
        } else {
          const rawCandidate = body.videoPath?.trim();
          if (!rawCandidate) {
            return NextResponse.json(
              { error: "videoPath is required" },
              { status: 400 },
            );
          }

          // Converter returns Fedora absolute paths; map to Samba RO mounts.
          const candidate = mapHostLibraryPathToDocker(rawCandidate);

          const roots = getMoviesRoots();
          const allowed =
            isDockerLibraryPath(candidate) ||
            roots.some((root) => isPathInsideDir(candidate, root)) ||
            isPathInsideDir(candidate, "/movies-e") ||
            isPathInsideDir(candidate, "/movies-j") ||
            isPathInsideDir(candidate, "/tv-h");

          if (!allowed) {
            return NextResponse.json(
              { error: "videoPath is outside the movie library" },
              { status: 403 },
            );
          }

          try {
            await fs.access(candidate);
          } catch {
            return NextResponse.json(
              { error: "Video file not found" },
              { status: 404 },
            );
          }

          videoPath = candidate;
        }

        const [tracks, sidecars] = await Promise.all([
          probeSubtitleTracks(videoPath),
          listSidecarSubtitles(videoPath),
        ]);

        const tempId = randomUUID();
        sessions.set(tempId, {
          videoPath,
          originalName: path.basename(videoPath),
          sidecars,
        });

        return NextResponse.json({
          tempId,
          originalName: path.basename(videoPath),
          tracks,
          sidecars,
          source: body.action === "probe_library" ? "library" : "path",
        });
      }

      if (!body.tempId) {
        return NextResponse.json(
          { error: "tempId is required" },
          { status: 400 },
        );
      }

      const session = sessions.get(body.tempId);
      if (!session) {
        return NextResponse.json(
          { error: "Session expired. Select the video again." },
          { status: 404 },
        );
      }

      if (body.sidecarId) {
        const sidecar = session.sidecars.find(
          (item) => item.id === body.sidecarId,
        );
        if (!sidecar) {
          return NextResponse.json(
            { error: "Sidecar subtitle not found" },
            { status: 404 },
          );
        }

        const ext = path.extname(sidecar.filename).toLowerCase();
        if (ext !== ".srt") {
          return NextResponse.json(
            {
              error:
                "Only .srt sidecar files can be applied directly. Convert other formats first.",
            },
            { status: 400 },
          );
        }

        const sidecarPath = path.join(
          path.dirname(session.videoPath),
          sidecar.filename,
        );
        const content = await fs.readFile(sidecarPath, "utf-8");
        return applyContent(content, body.event, body.tempId);
      }

      if (body.streamIndex === undefined) {
        return NextResponse.json(
          { error: "streamIndex or sidecarId is required" },
          { status: 400 },
        );
      }

      const sessionDir = path.dirname(session.videoPath);
      const outputDir = sessionDir.startsWith(TEMP_ROOT)
        ? sessionDir
        : path.join(TEMP_ROOT, body.tempId);
      await fs.mkdir(outputDir, { recursive: true });
      const outputPath = path.join(outputDir, "extracted.srt");

      await extractTrack(session.videoPath, body.streamIndex, outputPath);
      const content = await fs.readFile(outputPath, "utf-8");
      return applyContent(content, body.event, body.tempId);
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "No file uploaded. Use field name 'file'." },
        { status: 400 },
      );
    }

    const ext = path.extname(file.name).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { error: "Unsupported video format" },
        { status: 400 },
      );
    }

    await ensureTempRoot();

    const tempId = randomUUID();
    const sessionDir = path.join(TEMP_ROOT, tempId);
    await fs.mkdir(sessionDir, { recursive: true });

    const videoPath = path.join(sessionDir, `input${ext}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(videoPath, buffer);

    const tracks = await probeSubtitleTracks(videoPath);
    sessions.set(tempId, {
      videoPath,
      originalName: file.name,
      sidecars: [],
    });

    return NextResponse.json({
      tempId,
      originalName: file.name,
      tracks,
      sidecars: [],
      source: "upload",
    });
  } catch (error) {
    console.error("Subtitle extraction failed:", error);
    const message =
      error instanceof Error ? error.message : "Subtitle extraction failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
