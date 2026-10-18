export const JELLYFIN_OUTPUT_ROOT = "J:\\Movies J Drive - Jellyfin";
export const TV_JELLYFIN_OUTPUT_ROOT = "H:\\TV Shows H Drive - Jellyfin";

export function buildPlannedOutputPath(
  title: string,
  videoFile: string,
  root: string = JELLYFIN_OUTPUT_ROOT,
): string {
  const stem = videoFile.replace(/\.[^.]+$/, "");
  const normalizedRoot = root.replace(/\\+$/, "").replace(/\/+$/, "");
  const sep = normalizedRoot.includes("\\") ? "\\" : "/";
  // title may contain nested season folders using /
  const titlePath = title.split("/").join(sep);
  return `${normalizedRoot}${sep}${titlePath}${sep}${stem}.mp4`;
}

export function buildTvPlannedOutputPath(
  title: string,
  videoFile: string,
): string {
  return buildPlannedOutputPath(title, videoFile, TV_JELLYFIN_OUTPUT_ROOT);
}
