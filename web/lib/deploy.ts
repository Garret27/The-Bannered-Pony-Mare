import fs from "fs/promises";
import {
  type Event,
  EVENT_LABELS,
  getPosterFilename,
  getPosterPath,
  getSubtitleFilename,
  getSubtitlePath,
} from "./paths";
import {
  type GitHubPublishResult,
  tryPublishFileToGitHub,
} from "./github";

export type { GitHubPublishResult };

export async function publishPoster(event: Event): Promise<GitHubPublishResult> {
  const filename = getPosterFilename(event);
  const content = await fs.readFile(getPosterPath(event));
  const label = EVENT_LABELS[event];

  return tryPublishFileToGitHub(
    filename,
    content,
    `Update ${label} poster`,
  );
}

export async function publishSubtitle(event: Event): Promise<GitHubPublishResult> {
  const filename = getSubtitleFilename(event);
  const content = await fs.readFile(getSubtitlePath(event), "utf-8");
  const label = EVENT_LABELS[event];

  return tryPublishFileToGitHub(
    filename,
    content,
    `Update ${label} subtitles`,
  );
}

export function publishResultToMessage(
  assetLabel: string,
  github: GitHubPublishResult,
): string {
  if ("skipped" in github && github.skipped) {
    return `${assetLabel} saved`;
  }

  if (github.published) {
    return `${assetLabel} saved and published to GitHub`;
  }

  if ("error" in github) {
    return `${assetLabel} saved locally; GitHub publish failed: ${github.error}`;
  }

  return `${assetLabel} saved`;
}
