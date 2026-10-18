import fs from "fs/promises";
import {
  type Event,
  getPosterFilename,
  getPosterPath,
} from "./paths";
import { processPoster } from "./image";
import { publishPoster, type GitHubPublishResult } from "./deploy";

export type SavedPoster = {
  filename: string;
  size: number;
  modifiedAt: string;
  github: GitHubPublishResult;
};

export async function savePosterBuffer(
  event: Event,
  buffer: Buffer,
): Promise<SavedPoster> {
  const outputPath = getPosterPath(event);
  await processPoster(buffer, outputPath);

  const stat = await fs.stat(outputPath);
  const github = await publishPoster(event);

  return {
    filename: getPosterFilename(event),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    github,
  };
}
