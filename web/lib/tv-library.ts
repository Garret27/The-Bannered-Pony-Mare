import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { isPathInsideDir } from "./ffmpeg";
import {
  fetchJellyfinPoster,
  getJellyfinItemById,
  isJellyfinConfigured,
  isTvJellyfinOutputPath,
  isTvSourcePath,
  isTvSourceRootKey,
  itemHasPoster,
  itemSizeBytes,
  listJellyfinEpisodes,
  listJellyfinEpisodesByDate,
  listJellyfinEpisodesBySize,
  listJellyfinSeries,
  mapJellyfinPathToDocker,
  type JellyfinItem,
} from "./jellyfin";
import { getVideoMimeType } from "./movies-library";
import {
  buildTvShowFolderName,
  formatEpisodeCode,
  type TvEpisodeEntry,
  type TvSeriesEntry,
} from "./tv-types";

export { getVideoMimeType };
export {
  buildTvShowFolderName,
  formatEpisodeCode,
  getTvAgentTitle,
  getTvSourceTitle,
  type TvEpisodeEntry,
  type TvSeriesEntry,
} from "./tv-types";

const TV_SOURCE_ROOTS = [
  process.env.TV_SOURCE_H?.trim() || "/tv-h/TV Shows H Drive",
  process.env.TV_SOURCE_E?.trim() || "/movies-e/TV Shows E Drive",
  process.env.TV_SOURCE_J?.trim() || "/movies-j/TV Shows J Drive",
];

const TV_OUTPUT_DIR =
  process.env.TV_OUTPUT_DIR?.trim() || "/tv-h/TV Shows H Drive - Jellyfin";

export type TvSeasonEntry = {
  season: number;
  label: string;
  episodeCount: number;
};

export function isTvLibraryConfigured(): boolean {
  return isJellyfinConfigured();
}

function seriesFromItem(item: JellyfinItem): TvSeriesEntry | null {
  const itemPath = item.Path?.trim();
  if (!itemPath) return null;
  if (isTvJellyfinOutputPath(itemPath)) return null;
  if (!isTvSourcePath(itemPath)) return null;

  return {
    id: item.Id,
    title: item.Name,
    year: item.ProductionYear || undefined,
    hasPoster: itemHasPoster(item),
    overview: item.Overview,
    addedAt: item.DateCreated,
  };
}

function episodeFromItem(
  item: JellyfinItem,
  seriesFallback?: { id: string; name: string; year?: number },
): TvEpisodeEntry | null {
  const itemPath =
    item.Path?.trim() || item.MediaSources?.[0]?.Path?.trim() || "";
  if (!itemPath) return null;
  if (isTvJellyfinOutputPath(itemPath)) return null;

  const mapped = mapJellyfinPathToDocker(itemPath);
  if (!mapped || !isTvSourceRootKey(mapped.rootKey)) return null;

  const videoFile = path.basename(itemPath);
  const extension = path.extname(videoFile).toLowerCase().slice(1);
  if (!extension) return null;

  const season = item.ParentIndexNumber ?? 0;
  const episode = item.IndexNumber ?? 0;
  const seriesName =
    item.SeriesName?.trim() || seriesFallback?.name?.trim() || "Unknown Series";
  const seriesId = item.SeriesId || seriesFallback?.id || "";
  const year = item.ProductionYear || seriesFallback?.year;

  // Output layout matches desktop converter: Show (Year)/Season N.
  // Source may live under a folder without the year — keep the real disk path.
  const folderName = buildTvShowFolderName(seriesName, year, season);
  const sourceFolderName = mapped.folderName || folderName;

  return {
    id: item.Id,
    seriesId,
    seriesName,
    title: item.Name,
    season,
    episode,
    year: year || undefined,
    folderName,
    sourceFolderName,
    videoFile,
    extension,
    sizeBytes: itemSizeBytes(item),
    format: extension,
    rootKey: mapped.rootKey,
    hasPoster: itemHasPoster(item),
    addedAt: item.DateCreated,
  };
}

function seasonLabel(season: number): string {
  return season === 0 ? "Specials" : `Season ${season}`;
}

export async function searchTvSeries(options: {
  query?: string;
  page?: number;
  limit?: number;
}): Promise<{ series: TvSeriesEntry[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 48));
  const skip = (page - 1) * limit;

  const matched: TvSeriesEntry[] = [];
  let matchedCount = 0;
  let startIndex = 0;
  let jellyfinTotal = Infinity;
  const batchSize = 100;

  while (startIndex < jellyfinTotal) {
    const result = await listJellyfinSeries({
      startIndex,
      limit: batchSize,
      searchTerm: options.query,
    });
    jellyfinTotal = result.total;

    for (const item of result.items) {
      const entry = seriesFromItem(item);
      if (!entry) continue;

      if (matchedCount >= skip && matched.length < limit) {
        matched.push(entry);
      }
      matchedCount += 1;
    }

    startIndex += result.items.length;
    if (result.items.length === 0) break;

    // Once the requested page is full, keep counting remaining matches for total.
    if (matched.length >= limit) {
      // Continue scanning so `total` is accurate for H-source shows only.
      continue;
    }
  }

  return { series: matched, total: matchedCount, page, limit };
}

export async function listRecentlyAddedTvSeries(
  limit = 12,
): Promise<TvSeriesEntry[]> {
  const target = Math.min(24, Math.max(1, limit));
  const matched: TvSeriesEntry[] = [];
  let startIndex = 0;
  let jellyfinTotal = Infinity;
  const batchSize = 100;

  // Jellyfin sorts every TV library together, so keep paging until enough
  // entries match the E/H/J source folders (excluding the VRC/output library).
  while (startIndex < jellyfinTotal && matched.length < target) {
    const result = await listJellyfinSeries({
      startIndex,
      limit: batchSize,
      sortBy: "DateCreated",
      sortOrder: "Descending",
    });
    jellyfinTotal = result.total;

    for (const item of result.items) {
      const entry = seriesFromItem(item);
      if (entry) matched.push(entry);
      if (matched.length >= target) break;
    }

    if (result.items.length === 0) break;
    startIndex += result.items.length;
  }

  return matched;
}

export async function listRecentlyAddedTvEpisodes(
  limit = 20,
): Promise<TvEpisodeEntry[]> {
  const target = Math.min(50, Math.max(1, limit));
  const matched: TvEpisodeEntry[] = [];
  let startIndex = 0;
  let jellyfinTotal = Infinity;
  const batchSize = 100;

  // Episodes from all Jellyfin TV libraries are interleaved by added date.
  // Page until we have enough entries from the E/H/J source folders.
  while (startIndex < jellyfinTotal && matched.length < target) {
    const result = await listJellyfinEpisodesByDate({
      startIndex,
      limit: batchSize,
    });
    jellyfinTotal = result.total;

    for (const item of result.items) {
      const entry = episodeFromItem(item);
      if (entry) matched.push(entry);
      if (matched.length >= target) break;
    }

    if (result.items.length === 0) break;
    startIndex += result.items.length;
  }

  return matched;
}

type CachedTvEpisodeLibrary = {
  scannedAt: number;
  episodes: TvEpisodeEntry[];
  pathById: Map<string, string>;
};

let episodeLibraryCache: CachedTvEpisodeLibrary | null = null;
const EPISODE_LIBRARY_CACHE_MS = 5 * 60_000;

async function buildEpisodeLibraryFromJellyfin(
  searchTerm?: string,
): Promise<CachedTvEpisodeLibrary> {
  const episodes: TvEpisodeEntry[] = [];
  const pathById = new Map<string, string>();
  let startIndex = 0;
  let jellyfinTotal = Infinity;
  const batchSize = 200;

  while (startIndex < jellyfinTotal) {
    const page = await listJellyfinEpisodesBySize({
      startIndex,
      limit: batchSize,
      searchTerm,
      sortOrder: "Descending",
    });
    jellyfinTotal = page.total;

    for (const item of page.items) {
      const entry = episodeFromItem(item);
      if (!entry) continue;
      const itemPath =
        item.Path?.trim() || item.MediaSources?.[0]?.Path?.trim() || "";
      const mapped = itemPath ? mapJellyfinPathToDocker(itemPath) : null;
      episodes.push(entry);
      if (mapped) pathById.set(entry.id, mapped.dockerPath);
    }

    if (page.items.length === 0) break;
    startIndex += page.items.length;
  }

  return {
    scannedAt: Date.now(),
    episodes,
    pathById,
  };
}

async function applyLiveEpisodeSizes(
  library: CachedTvEpisodeLibrary,
): Promise<CachedTvEpisodeLibrary> {
  const episodes = await Promise.all(
    library.episodes.map(async (episode) => {
      const dockerPath = library.pathById.get(episode.id);
      if (!dockerPath) return episode;
      try {
        const stat = await fsPromises.stat(dockerPath);
        if (stat.isFile() && stat.size > 0) {
          return { ...episode, sizeBytes: stat.size };
        }
      } catch {
        // Keep Jellyfin-reported size if the file is unavailable.
      }
      return episode;
    }),
  );
  return { ...library, episodes };
}

export async function searchTvEpisodes(options: {
  query?: string;
  page?: number;
  limit?: number;
  sort?: "title" | "size";
  order?: "asc" | "desc";
  minSizeBytes?: number;
  rootKey?: string;
  extension?: string;
  forceRefresh?: boolean;
  liveSizes?: boolean;
}): Promise<{
  episodes: Array<TvEpisodeEntry & { code: string }>;
  total: number;
  page: number;
  limit: number;
  scannedAt: string;
  totalSizeBytes: number;
  filteredTotal: number;
}> {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const query = options.query?.trim() ?? "";
  const sort = options.sort ?? "size";
  const order = options.order ?? "desc";
  const minSizeBytes = Math.max(0, options.minSizeBytes ?? 0);
  const rootKey = options.rootKey?.trim().toLowerCase();
  const extension = options.extension?.trim().toLowerCase().replace(/^\./, "");
  const useLiveSizes = options.liveSizes ?? false;

  // SearchTerm changes the Jellyfin result set — don't reuse the unfiltered cache.
  let library: CachedTvEpisodeLibrary;
  if (query) {
    library = await buildEpisodeLibraryFromJellyfin(query);
  } else if (
    !options.forceRefresh &&
    episodeLibraryCache &&
    Date.now() - episodeLibraryCache.scannedAt < EPISODE_LIBRARY_CACHE_MS
  ) {
    library = episodeLibraryCache;
  } else {
    library = await buildEpisodeLibraryFromJellyfin();
    episodeLibraryCache = library;
  }

  if (useLiveSizes) {
    library = await applyLiveEpisodeSizes(library);
  }

  let filtered = library.episodes;
  if (minSizeBytes > 0) {
    filtered = filtered.filter((episode) => episode.sizeBytes >= minSizeBytes);
  }
  if (rootKey === "h" || rootKey === "te" || rootKey === "tj") {
    filtered = filtered.filter((episode) => episode.rootKey === rootKey);
  }
  if (extension) {
    filtered = filtered.filter(
      (episode) => episode.extension.toLowerCase() === extension,
    );
  }
  if (query) {
    const needle = query.toLowerCase();
    filtered = filtered.filter((episode) => {
      const haystack = `${episode.seriesName} ${episode.title} ${formatEpisodeCode(episode.season, episode.episode)}`.toLowerCase();
      return haystack.includes(needle);
    });
  }

  filtered = [...filtered].sort((a, b) => {
    if (sort === "title") {
      const left = `${a.seriesName} ${a.title}`.localeCompare(
        `${b.seriesName} ${b.title}`,
      );
      return order === "desc" ? -left : left;
    }
    const diff = a.sizeBytes - b.sizeBytes;
    return order === "desc" ? -diff : diff;
  });

  const totalSizeBytes = filtered.reduce(
    (sum, episode) => sum + episode.sizeBytes,
    0,
  );
  const start = (page - 1) * limit;
  let slice = filtered.slice(start, start + limit);

  if (useLiveSizes) {
    const pageLibrary: CachedTvEpisodeLibrary = {
      scannedAt: library.scannedAt,
      episodes: slice,
      pathById: library.pathById,
    };
    slice = (await applyLiveEpisodeSizes(pageLibrary)).episodes;
  }

  const mapped = slice.map((episode) => ({
    ...episode,
    code: formatEpisodeCode(episode.season, episode.episode),
  }));

  return {
    episodes: mapped,
    total: filtered.length,
    page,
    limit,
    scannedAt: new Date(library.scannedAt).toISOString(),
    totalSizeBytes,
    filteredTotal: filtered.length,
  };
}

export async function getTvSeriesById(
  seriesId: string,
): Promise<TvSeriesEntry | null> {
  const item = await getJellyfinItemById(seriesId);
  if (!item) return null;
  return seriesFromItem(item);
}

export async function listEpisodesForSeries(
  seriesId: string,
): Promise<TvEpisodeEntry[]> {
  const series = await getTvSeriesById(seriesId);
  // Series may fail source-path filter if Path is missing on the Series item;
  // still try episodes and keep those that map to H source.
  const seriesMeta = series
    ? { id: series.id, name: series.title, year: series.year }
    : undefined;

  let seriesNameFallback = seriesMeta;
  if (!seriesNameFallback) {
    const raw = await getJellyfinItemById(seriesId);
    if (raw) {
      // Allow browsing when series Path is missing but episodes are on H source.
      if (raw.Path && isTvJellyfinOutputPath(raw.Path)) {
        return [];
      }
      seriesNameFallback = {
        id: raw.Id,
        name: raw.Name,
        year: raw.ProductionYear || undefined,
      };
    }
  }

  const items = await listJellyfinEpisodes(seriesId);
  const episodes: TvEpisodeEntry[] = [];

  for (const item of items) {
    const entry = episodeFromItem(item, seriesNameFallback);
    if (entry) episodes.push(entry);
  }

  episodes.sort((a, b) => {
    if (a.season !== b.season) return a.season - b.season;
    return a.episode - b.episode;
  });

  return episodes;
}

async function listOutputFileNames(folderName: string): Promise<Set<string>> {
  const names = new Set<string>();
  const parts = folderName.split("/");
  const variants = [folderName];

  if (parts.length >= 2) {
    const showFolder = parts[0]!;
    const seasonFolder = parts.slice(1).join("/");
    const withoutYear = showFolder
      .replace(/\s*\((?:19|20)\d{2}\)\s*$/, "")
      .trim();
    if (withoutYear && withoutYear !== showFolder) {
      variants.push(`${withoutYear}/${seasonFolder}`);
    }
  }

  for (const variant of variants) {
    try {
      const entries = await fsPromises.readdir(
        path.join(TV_OUTPUT_DIR, variant),
      );
      for (const name of entries) {
        names.add(name.toLowerCase());
      }
    } catch {
      // Folder missing for this layout variant.
    }
  }

  return names;
}

/** Flags episodes whose converted mp4 already exists in the Jellyfin TV output. */
export async function markConvertedEpisodes<T extends TvEpisodeEntry>(
  episodes: T[],
): Promise<T[]> {
  const folderNames = Array.from(
    new Set(episodes.map((episode) => episode.folderName)),
  );
  const listings = await Promise.all(
    folderNames.map(async (folderName) => {
      return [folderName, await listOutputFileNames(folderName)] as const;
    }),
  );
  const byFolder = new Map(listings);

  return episodes.map((episode) => {
    const names = byFolder.get(episode.folderName);
    const outputName = `${path.parse(episode.videoFile).name}.mp4`.toLowerCase();
    return { ...episode, converted: names?.has(outputName) ?? false };
  });
}

export function groupEpisodesIntoSeasons(
  episodes: TvEpisodeEntry[],
): TvSeasonEntry[] {
  const counts = new Map<number, number>();
  for (const episode of episodes) {
    counts.set(episode.season, (counts.get(episode.season) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort(([a], [b]) => a - b)
    .map(([season, episodeCount]) => ({
      season,
      label: seasonLabel(season),
      episodeCount,
    }));
}

export async function getEpisodeById(
  episodeId: string,
): Promise<{ episode: TvEpisodeEntry; dockerPath: string } | null> {
  const item = await getJellyfinItemById(episodeId);
  if (!item) return null;

  let seriesMeta: { id: string; name: string; year?: number } | undefined;
  if (item.SeriesId) {
    const series = await getTvSeriesById(item.SeriesId);
    if (series) {
      seriesMeta = { id: series.id, name: series.title, year: series.year };
    } else {
      const raw = await getJellyfinItemById(item.SeriesId);
      if (raw) {
        seriesMeta = {
          id: raw.Id,
          name: raw.Name,
          year: raw.ProductionYear || undefined,
        };
      }
    }
  }

  const entry = episodeFromItem(item, seriesMeta);
  if (!entry) return null;

  const itemPath =
    item.Path?.trim() || item.MediaSources?.[0]?.Path?.trim() || "";
  const mapped = mapJellyfinPathToDocker(itemPath);
  if (!mapped || !isTvSourceRootKey(mapped.rootKey)) return null;

  const insideKnownRoot = TV_SOURCE_ROOTS.some(
    (root) =>
      isPathInsideDir(mapped.dockerPath, root) ||
      isPathInsideDir(mapped.dockerPath, path.dirname(root)),
  );
  if (
    !insideKnownRoot &&
    !isPathInsideDir(mapped.dockerPath, "/tv-h") &&
    !isPathInsideDir(mapped.dockerPath, "/movies-e") &&
    !isPathInsideDir(mapped.dockerPath, "/movies-j")
  ) {
    return null;
  }

  return { episode: entry, dockerPath: mapped.dockerPath };
}

export async function resolveEpisodeVideoPath(
  episodeId: string,
): Promise<string | null> {
  const result = await getEpisodeById(episodeId);
  if (!result) return null;

  try {
    await fsPromises.access(result.dockerPath, fs.constants.R_OK);
    return result.dockerPath;
  } catch {
    return null;
  }
}

export async function getEpisodePoster(
  episodeId: string,
): Promise<{ data: Buffer; contentType: string } | null> {
  const item = await getJellyfinItemById(episodeId);
  if (!item) return null;

  const posterId = item.SeriesId || item.Id;
  return fetchJellyfinPoster(posterId);
}

export async function getSeriesPoster(
  seriesId: string,
): Promise<{ data: Buffer; contentType: string } | null> {
  return fetchJellyfinPoster(seriesId);
}
