import { createReadStream } from "fs";
import fs from "fs/promises";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import {
  getMovieById,
  getVideoMimeType,
  isMoviesLibraryConfigured,
  resolveMovieVideoPath,
} from "@/lib/movies-library";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function streamResponse(
  videoPath: string,
  mimeType: string,
  fileSize: number,
  start: number,
  end: number,
) {
  const stream = createReadStream(videoPath, { start, end });
  const webStream = Readable.toWeb(stream) as ReadableStream;

  const headers: Record<string, string> = {
    "Content-Type": mimeType,
    "Content-Length": String(end - start + 1),
    "Accept-Ranges": "bytes",
  };

  if (start !== 0 || end !== fileSize - 1) {
    return new NextResponse(webStream, {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      },
    });
  }

  return new NextResponse(webStream, { headers });
}

export async function GET(request: Request, context: RouteContext) {
  if (!isMoviesLibraryConfigured()) {
    return NextResponse.json(
      { error: "JELLYFIN_URL and JELLYFIN_API_KEY are not configured" },
      { status: 503 },
    );
  }

  const { id } = await context.params;

  try {
    const videoPath = await resolveMovieVideoPath(id);
    if (!videoPath) {
      return NextResponse.json({ error: "Movie not found" }, { status: 404 });
    }

    const movieInfo = await getMovieById(id);
    if (!movieInfo) {
      return NextResponse.json({ error: "Movie not found" }, { status: 404 });
    }

    const stat = await fs.stat(videoPath);
    const fileSize = stat.size;
    const mimeType = getVideoMimeType(movieInfo.movie.extension);
    const rangeHeader = request.headers.get("range");

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (!match) {
        return new NextResponse(null, { status: 416 });
      }

      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${fileSize}` },
        });
      }

      return streamResponse(videoPath, mimeType, fileSize, start, end);
    }

    return streamResponse(videoPath, mimeType, fileSize, 0, fileSize - 1);
  } catch (error) {
    console.error("Failed to stream movie:", error);
    return NextResponse.json(
      { error: "Failed to stream movie" },
      { status: 500 },
    );
  }
}
