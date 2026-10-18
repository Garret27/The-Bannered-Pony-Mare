export type TvSeriesEntry = {
  id: string;
  title: string;
  year?: number;
  hasPoster: boolean;
  overview?: string;
  addedAt?: string;
};

export type TvEpisodeEntry = {
  id: string;
  seriesId: string;
  seriesName: string;
  title: string;
  season: number;
  episode: number;
  year?: number;
  /** Output relative dir under Jellyfin TV root, e.g. Show (2020)/Season 1 */
  folderName: string;
  /** Actual relative dir on the source drive (may omit year). */
  sourceFolderName: string;
  videoFile: string;
  extension: string;
  sizeBytes: number;
  format: string;
  rootKey: string;
  hasPoster: boolean;
  addedAt?: string;
  /** True when the Jellyfin TV output already has this episode's mp4. */
  converted?: boolean;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatEpisodeCode(season: number, episode: number): string {
  return `S${pad2(season)}E${pad2(episode)}`;
}

export function getTvAgentTitle(episode: TvEpisodeEntry): string {
  return episode.folderName;
}

export function getTvSourceTitle(episode: TvEpisodeEntry): string {
  return episode.sourceFolderName || episode.folderName;
}

export function buildTvShowFolderName(
  seriesName: string,
  year: number | undefined,
  season: number,
): string {
  const showFolder = year ? `${seriesName} (${year})` : seriesName;
  const seasonFolder = season === 0 ? "Specials" : `Season ${season}`;
  return `${showFolder}/${seasonFolder}`;
}
