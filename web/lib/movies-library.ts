import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { isPathInsideDir } from "./ffmpeg";
import {
  fetchAllJellyfinMovies,
  getJellyfinItemById,
  isJellyfinConfigured,
  itemHasPoster,
  itemSizeBytes,
  listJellyfinMovies,
  mapJellyfinPathToDocker,
  type JellyfinItem,
} from "./jellyfin";
import { getSettingsSync } from "./settings";

const DEFAULT_ROOTS = [
  "/movies-e/Movies E Drive",
  "/movies-j/Movies J Drive",
];

const POSTER_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

const POSTER_EXACT_NAMES = [
  "poster.jpg",
  "poster.jpeg",
  "poster.png",
  "poster.webp",
  "folder.jpg",
  "folder.png",
  "cover.jpg",
  "cover.png",
];

const CACHE_TTL_MS = 5 * 60 * 1000;

const VIDEO_EXTENSIONS = new Set([
  ".mkv",
  ".mp4",
  ".avi",
  ".mov",
  ".wmv",
  ".flv",
  ".webm",
  ".m4v",
  ".mpg",
  ".mpeg",
  ".ts",
  ".mts",
  ".m2ts",
  ".vob",
  ".iso",
  ".3gp",
  ".f4v",
  ".ogv",
]);

export type MovieEntry = {
  id: string;
  title: string;
  folderName: string;
  videoFile: string;
  extension: string;
  sizeBytes: number;
  format: string;
  rootKey: string;
  hasPoster: boolean;
  year?: number;
};

type CachedLibrary = {
  scannedAt: number;
  movies: MovieEntry[];
  pathById: Map<string, string>;
  winPathById: Map<string, string>;
  posterPathById: Map<string, string>;
  jellyfinPosterById: Set<string>;
};

let cache: CachedLibrary | null = null;
let scanPromise: Promise<CachedLibrary> | null = null;

export function getMoviesRoots(): string[] {
  const envRoots = getSettingsSync().movies.roots.trim();
  if (envRoots) {
    return envRoots
      .split(",")
      .map((root) => root.trim())
      .filter(Boolean);
  }

  return DEFAULT_ROOTS;
}

export function isMoviesLibraryConfigured(): boolean {
  return isJellyfinConfigured();
}

function resolveVideoFileFromDir(
  dockerDir: string,
  preferredStem?: string,
): { videoFile: string; dockerPath: string; sizeBytes: number } | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dockerDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates: Array<{ name: string; sizeBytes: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(ext)) continue;
    // Skip in-progress converter temp files
    if (/\.converting\./i.test(entry.name)) continue;
    try {
      const fullPath = path.join(dockerDir, entry.name);
      const stat = fs.statSync(fullPath);
      candidates.push({ name: entry.name, sizeBytes: stat.size });
    } catch {
      // ignore unreadable files
    }
  }

  if (candidates.length === 0) return null;

  const preferred = preferredStem
    ? candidates.find(
        (c) =>
          path.basename(c.name, path.extname(c.name)).toLowerCase() ===
          preferredStem.toLowerCase(),
      )
    : undefined;

  const chosen =
    preferred ??
    [...candidates].sort((a, b) => b.sizeBytes - a.sizeBytes)[0];

  return {
    videoFile: chosen.name,
    dockerPath: path.join(dockerDir, chosen.name),
    sizeBytes: chosen.sizeBytes,
  };
}

function jellyfinItemToEntry(item: JellyfinItem): {
  entry: MovieEntry;
  dockerPath: string;
  winPath: string;
} | null {
  const mediaSourcePath = item.MediaSources?.find(
    (source) => source.Path?.trim(),
  )?.Path?.trim();
  const itemPath = item.Path?.trim() || mediaSourcePath;
  if (!itemPath) return null;

  const mapped = mapJellyfinPathToDocker(itemPath);
  if (!mapped) return null;

  let videoFile = path.basename(itemPath);
  let extension = path.extname(videoFile).toLowerCase().slice(1);
  let dockerPath = mapped.dockerPath;
  let sizeBytes = itemSizeBytes(item);
  let folderName = mapped.folderName;

  // Jellyfin sometimes keeps a folder / BluRay path after the rip was replaced
  // with a single video file (no extension on Path). Resolve the real file.
  if (!extension) {
    const resolved = resolveVideoFileFromDir(
      mapped.dockerPath,
      path.basename(mapped.dockerPath) || item.Name,
    );
    if (!resolved) return null;

    videoFile = resolved.videoFile;
    extension = path.extname(videoFile).toLowerCase().slice(1);
    dockerPath = resolved.dockerPath;
    if (!sizeBytes) sizeBytes = resolved.sizeBytes;
    folderName =
      mapped.folderName ||
      path.basename(mapped.dockerPath) ||
      path.basename(path.dirname(resolved.dockerPath));
  }

  if (!extension) return null;

  return {
    entry: {
      id: item.Id,
      title: item.Name,
      folderName,
      videoFile,
      extension,
      sizeBytes,
      format: extension,
      rootKey: mapped.rootKey,
      hasPoster: itemHasPoster(item),
      year: item.ProductionYear || undefined,
    },
    dockerPath,
    winPath: itemPath,
  };
}

async function findLocalPosterPath(
  dockerVideoPath: string,
): Promise<string | null> {
  const folderPath = path.dirname(dockerVideoPath);
  let files: string[];
  try {
    files = await fsPromises.readdir(folderPath);
  } catch {
    return null;
  }

  const images = files.filter((name) =>
    POSTER_EXTENSIONS.has(path.extname(name).toLowerCase()),
  );
  if (images.length === 0) return null;

  const byLowerName = new Map(
    images.map((name) => [name.toLowerCase(), name] as const),
  );

  for (const exact of POSTER_EXACT_NAMES) {
    const match = byLowerName.get(exact);
    if (match) return path.join(folderPath, match);
  }

  const posterMatch = images.find((name) =>
    /poster/i.test(path.basename(name, path.extname(name))),
  );
  if (posterMatch) return path.join(folderPath, posterMatch);

  return null;
}

async function buildLibraryFromItems(
  items: JellyfinItem[],
): Promise<CachedLibrary> {
  const movies: MovieEntry[] = [];
  const pathById = new Map<string, string>();
  const winPathById = new Map<string, string>();
  const posterPathById = new Map<string, string>();
  const jellyfinPosterById = new Set<string>();

  for (const item of items) {
    const mapped = jellyfinItemToEntry(item);
    if (!mapped) continue;

    movies.push(mapped.entry);
    pathById.set(mapped.entry.id, mapped.dockerPath);
    winPathById.set(mapped.entry.id, mapped.winPath);

    if (mapped.entry.hasPoster) {
      jellyfinPosterById.add(mapped.entry.id);
    } else {
      const localPoster = await findLocalPosterPath(mapped.dockerPath);
      if (localPoster) {
        mapped.entry.hasPoster = true;
        posterPathById.set(mapped.entry.id, localPoster);
      }
    }
  }

  movies.sort((a, b) => a.title.localeCompare(b.title));

  return {
    scannedAt: Date.now(),
    movies,
    pathById,
    winPathById,
    posterPathById,
    jellyfinPosterById,
  };
}

async function scanLibrary(): Promise<CachedLibrary> {
  const items = await fetchAllJellyfinMovies();
  return buildLibraryFromItems(items);
}

export async function getMovieLibrary(force = false): Promise<CachedLibrary> {
  if (force) {
    cache = null;
    scanPromise = null;
  }

  if (
    !force &&
    cache &&
    Date.now() - cache.scannedAt < CACHE_TTL_MS
  ) {
    return cache;
  }

  if (!scanPromise) {
    scanPromise = scanLibrary()
      .then((result) => {
        cache = result;
        return result;
      })
      .finally(() => {
        scanPromise = null;
      });
  }

  return scanPromise;
}

async function resolveLiveVideoAtPath(
  dockerPath: string,
): Promise<{
  dockerPath: string;
  videoFile: string;
  extension: string;
  sizeBytes: number;
} | null> {
  const tryStat = async (filePath: string) => {
    try {
      const stat = await fsPromises.stat(filePath);
      if (!stat.isFile()) return null;
      const videoFile = path.basename(filePath);
      const extension = path.extname(videoFile).toLowerCase().slice(1);
      if (!extension) return null;
      return {
        dockerPath: filePath,
        videoFile,
        extension,
        sizeBytes: stat.size,
      };
    } catch {
      return null;
    }
  };

  const direct = await tryStat(dockerPath);
  if (direct) return direct;

  const folderPath = path.dirname(dockerPath);
  let names: string[];
  try {
    names = await fsPromises.readdir(folderPath);
  } catch {
    return null;
  }

  let best: {
    dockerPath: string;
    videoFile: string;
    extension: string;
    sizeBytes: number;
  } | null = null;

  for (const name of names) {
    const ext = path.extname(name).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(ext)) continue;
    if (name.includes(".converting")) continue;

    const candidate = await tryStat(path.join(folderPath, name));
    if (!candidate) continue;
    if (!best || candidate.sizeBytes > best.sizeBytes) {
      best = candidate;
    }
  }

  return best;
}

async function applyLiveFileMetrics(
  library: CachedLibrary,
): Promise<CachedLibrary> {
  const movies: MovieEntry[] = [];
  const pathById = new Map(library.pathById);

  for (const movie of library.movies) {
    const dockerPath = library.pathById.get(movie.id);
    if (!dockerPath) continue;

    const live = await resolveLiveVideoAtPath(dockerPath);
    if (!live) continue;

    movies.push({
      ...movie,
      videoFile: live.videoFile,
      extension: live.extension,
      format: live.extension,
      sizeBytes: live.sizeBytes,
    });
    pathById.set(movie.id, live.dockerPath);
  }

  return {
    ...library,
    scannedAt: Date.now(),
    movies,
    pathById,
  };
}

export async function searchMovies(options: {
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
  movies: MovieEntry[];
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
  const sort = options.sort ?? (query ? "title" : "title");
  const order = options.order ?? "asc";
  const minSizeBytes = Math.max(0, options.minSizeBytes ?? 0);
  const rootKey = options.rootKey?.trim().toLowerCase();
  const extension = options.extension?.trim().toLowerCase().replace(/^\./, "");
  const useLiveSizes = options.liveSizes ?? false;

  const applyFilters = (movies: MovieEntry[]): MovieEntry[] => {
    let filtered = movies;
    if (minSizeBytes > 0) {
      filtered = filtered.filter((movie) => movie.sizeBytes >= minSizeBytes);
    }
    if (rootKey === "e" || rootKey === "j") {
      filtered = filtered.filter((movie) => movie.rootKey === rootKey);
    }
    if (extension) {
      filtered = filtered.filter(
        (movie) => movie.extension.toLowerCase() === extension,
      );
    }
    return filtered;
  };

  const sortMovies = (movies: MovieEntry[]): MovieEntry[] => {
    const sorted = [...movies];
    sorted.sort((a, b) => {
      if (sort === "size") {
        const diff = a.sizeBytes - b.sizeBytes;
        return order === "desc" ? -diff : diff;
      }
      const diff = a.title.localeCompare(b.title);
      return order === "desc" ? -diff : diff;
    });
    return sorted;
  };

  if (query) {
    // Jellyfin SearchTerm often fails on trailing years and on "." in titles
    // (e.g. "Dr. Strangelove", "A.I."). Collect variants and merge results.
    const searchTerms: string[] = [];
    const addSearchTerm = (term: string) => {
      const trimmed = term.trim();
      if (!trimmed) return;
      if (
        searchTerms.some(
          (existing) => existing.toLowerCase() === trimmed.toLowerCase(),
        )
      ) {
        return;
      }
      searchTerms.push(trimmed);
    };

    const withoutPeriods = (value: string) =>
      value.replace(/\./g, "").replace(/\s+/g, " ").trim();

    const normalizeIgnorePeriods = (value: string) =>
      withoutPeriods(value).toLowerCase();

    addSearchTerm(query);
    addSearchTerm(withoutPeriods(query));

    const withoutYear = query
      .replace(/\s*[\(\[]?(?:19|20)\d{2}[\)\]]?\s*$/i, "")
      .trim();
    addSearchTerm(withoutYear);
    addSearchTerm(withoutPeriods(withoutYear));

    const matchNeedles = [query, withoutYear]
      .map(normalizeIgnorePeriods)
      .filter(
        (needle, index, all) =>
          Boolean(needle) && all.indexOf(needle) === index,
      );

    const titleMatchesQuery = (title: string): boolean => {
      const haystack = normalizeIgnorePeriods(title);
      return matchNeedles.some((needle) => {
        if (needle.length >= 3) return haystack.includes(needle);
        // Short needles (e.g. "ai" from "A.I.") — require a whole-token match.
        return haystack.split(" ").some((token) => token === needle);
      });
    };

    const seenIds = new Set<string>();
    const jellyfinItems: JellyfinItem[] = [];
    for (const term of searchTerms) {
      const jellyfinResult = await listJellyfinMovies({
        searchTerm: term,
        startIndex: 0,
        limit: 1000,
      });
      for (const item of jellyfinResult.items) {
        if (seenIds.has(item.Id)) continue;
        seenIds.add(item.Id);
        jellyfinItems.push(item);
      }
    }

    const movies: MovieEntry[] = [];
    const pathById = new Map<string, string>();
    for (const item of jellyfinItems) {
      const mapped = jellyfinItemToEntry(item);
      if (!mapped) continue;
      if (!titleMatchesQuery(mapped.entry.title)) continue;
      movies.push(mapped.entry);
      pathById.set(mapped.entry.id, mapped.dockerPath);
    }

    // Jellyfin SearchTerm is inconsistent with punctuation; also match the
    // cached library while ignoring "." so "Dr Strangelove" still hits.
    const library = await getMovieLibrary(options.forceRefresh ?? false);
    for (const entry of library.movies) {
      if (pathById.has(entry.id)) continue;
      if (!titleMatchesQuery(entry.title)) continue;
      movies.push(entry);
      const dockerPath = library.pathById.get(entry.id);
      if (dockerPath) pathById.set(entry.id, dockerPath);
    }

    let workingMovies = movies;
    if (useLiveSizes) {
      const enriched = await applyLiveFileMetrics({
        scannedAt: Date.now(),
        movies,
        pathById,
        winPathById: new Map(),
        posterPathById: new Map(),
        jellyfinPosterById: new Set(),
      });
      workingMovies = enriched.movies;
    }

    const filtered = sortMovies(applyFilters(workingMovies));
    const totalSizeBytes = filtered.reduce(
      (sum, movie) => sum + movie.sizeBytes,
      0,
    );
    const start = (page - 1) * limit;
    const slice = filtered.slice(start, start + limit);

    return {
      movies: slice,
      total: filtered.length,
      page,
      limit,
      scannedAt: new Date().toISOString(),
      totalSizeBytes,
      filteredTotal: filtered.length,
    };
  }

  const library = await getMovieLibrary(options.forceRefresh ?? false);
  const sourceLibrary = useLiveSizes
    ? await applyLiveFileMetrics(library)
    : library;
  const filtered = sortMovies(applyFilters(sourceLibrary.movies));
  const totalSizeBytes = filtered.reduce(
    (sum, movie) => sum + movie.sizeBytes,
    0,
  );
  const start = (page - 1) * limit;
  const slice = filtered.slice(start, start + limit);

  return {
    movies: slice,
    total: filtered.length,
    page,
    limit,
    scannedAt: new Date(sourceLibrary.scannedAt).toISOString(),
    totalSizeBytes,
    filteredTotal: filtered.length,
  };
}

async function resolveEntryById(id: string): Promise<{
  entry: MovieEntry;
  dockerPath: string;
  library: CachedLibrary;
} | null> {
  const library = await getMovieLibrary();
  const cached = library.movies.find((movie) => movie.id === id);
  const dockerPath = library.pathById.get(id);

  if (cached && dockerPath) {
    return { entry: cached, dockerPath, library };
  }

  const item = await getJellyfinItemById(id);
  if (!item) return null;

  const mapped = jellyfinItemToEntry(item);
  if (!mapped) return null;

  return {
    entry: mapped.entry,
    dockerPath: mapped.dockerPath,
    library,
  };
}

export async function getMovieById(id: string): Promise<{
  movie: MovieEntry;
  videoPath: string;
} | null> {
  const result = await resolveEntryById(id);
  if (!result) return null;

  return {
    movie: result.entry,
    videoPath: result.dockerPath,
  };
}

export async function resolveMovieVideoPath(id: string): Promise<string | null> {
  const result = await getMovieById(id);
  if (!result) return null;

  const { videoPath } = result;
  const roots = getMoviesRoots();
  const inside = roots.some((root) => isPathInsideDir(videoPath, root));
  if (!inside) return null;

  try {
    await fsPromises.access(videoPath, fs.constants.R_OK);
    return videoPath;
  } catch {
    return null;
  }
}

export function getPosterMimeType(extension: string): string {
  switch (extension.toLowerCase()) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

export async function resolveMoviePosterSource(
  id: string,
): Promise<
  | { kind: "jellyfin" }
  | { kind: "file"; path: string }
  | null
> {
  const library = await getMovieLibrary();

  if (library.jellyfinPosterById.has(id)) {
    return { kind: "jellyfin" };
  }

  const resolved = await resolveEntryById(id);
  if (!resolved) return null;

  if (library.jellyfinPosterById.has(id)) {
    return { kind: "jellyfin" };
  }

  let posterPath = library.posterPathById.get(id);
  if (!posterPath) {
    posterPath =
      (await findLocalPosterPath(resolved.dockerPath)) ?? undefined;
    if (posterPath) {
      library.posterPathById.set(id, posterPath);
      resolved.entry.hasPoster = true;
    }
  }

  if (!posterPath) return null;

  const roots = getMoviesRoots();
  const inside = roots.some((root) => isPathInsideDir(posterPath!, root));
  if (!inside) return null;

  try {
    await fsPromises.access(posterPath, fs.constants.R_OK);
    return { kind: "file", path: posterPath };
  } catch {
    return null;
  }
}

export async function resolveMoviePosterPath(id: string): Promise<string | null> {
  const source = await resolveMoviePosterSource(id);
  if (!source || source.kind !== "file") return null;
  return source.path;
}

export function hasJellyfinPoster(id: string): boolean {
  if (!cache) return false;
  return cache.jellyfinPosterById.has(id);
}

export async function movieUsesJellyfinPoster(id: string): Promise<boolean> {
  const library = await getMovieLibrary();
  if (library.jellyfinPosterById.has(id)) return true;

  const item = await getJellyfinItemById(id);
  return item ? itemHasPoster(item) : false;
}

export function getVideoMimeType(extension: string): string {
  switch (extension.toLowerCase()) {
    case "mp4":
    case "m4v":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mkv":
      return "video/x-matroska";
    case "avi":
      return "video/x-msvideo";
    case "mov":
      return "video/quicktime";
    default:
      return "application/octet-stream";
  }
}

export function getAgentTitle(movie: MovieEntry): string {
  return movie.folderName;
}
