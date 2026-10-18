import fs from "fs/promises";
import {
  type Event,
  getPosterFilename,
  getPosterPath,
  getSubtitleFilename,
  getSubtitlePath,
} from "./paths";
import type { FileInfo } from "./format";
import { countCues } from "./srt";

async function getFileInfo(
  filePath: string,
  filename: string,
  includeCueCount = false,
): Promise<FileInfo> {
  try {
    const stat = await fs.stat(filePath);
    const info: FileInfo = {
      exists: true,
      filename,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    };

    if (includeCueCount) {
      try {
        const content = await fs.readFile(filePath, "utf-8");
        info.cueCount = countCues(content);
      } catch {
        info.cueCount = null;
      }
    }

    return info;
  } catch {
    return {
      exists: false,
      filename,
      size: null,
      modifiedAt: null,
      cueCount: includeCueCount ? null : undefined,
    };
  }
}

export async function getEventFileStatus(event: Event): Promise<{
  poster: FileInfo;
  subtitle: FileInfo;
}> {
  return {
    poster: await getFileInfo(getPosterPath(event), getPosterFilename(event)),
    subtitle: await getFileInfo(
      getSubtitlePath(event),
      getSubtitleFilename(event),
      true,
    ),
  };
}
