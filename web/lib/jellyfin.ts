import path from "path";
import { getSettingsSync } from "./settings";

const DEFAULT_JELLYFIN_URL = "http://192.168.0.130:8096";
const FETCH_TIMEOUT_MS = 15_000;
const ITEM_FIELDS =
  "Path,MediaSources,ImageTags,ProductionYear,Overview,SortName,Size,SeriesName,SeriesId,ParentIndexNumber,IndexNumber,SeasonName,Type,DateCreated";

export class JellyfinConfigError extends Error {
  constructor(message = "JELLYFIN_URL and JELLYFIN_API_KEY must be configured") {
    super(message);
    this.name = "JellyfinConfigError";
  }
}

export type JellyfinItem = {
  Id: string;
  Name: string;
  Path?: string;
  Type?: string;
  ProductionYear?: number;
  Overview?: string;
  Size?: number;
  SeriesId?: string;
  SeriesName?: string;
  SeasonName?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  DateCreated?: string;
  ImageTags?: { Primary?: string };
  MediaSources?: Array<{ Size?: number; Path?: string }>;
};

type JellyfinItemsResponse = {
  Items: JellyfinItem[];
  TotalRecordCount: number;
};

type JellyfinUser = {
  Id: string;
  Name: string;
  Policy?: { IsAdministrator?: boolean };
};

type JellyfinPublicInfo = {
  ServerName?: string;
  Version?: string;
};

let cachedUserId: string | null = null;

function readRuntimeEnv(name: string): string {
  return (process.env as Record<string, string | undefined>)[name]?.trim() || "";
}

export function getJellyfinUrl(): string {
  const fromEnv = readRuntimeEnv("JELLYFIN_URL");
  return (
    fromEnv ||
    getSettingsSync().movies.jellyfinUrl.trim() ||
    DEFAULT_JELLYFIN_URL
  ).replace(/\/$/, "");
}

export function getJellyfinApiKey(): string {
  const key = getSettingsSync().movies.jellyfinApiKey.trim();
  if (!key) {
    throw new JellyfinConfigError();
  }
  return key;
}

export function isJellyfinConfigured(): boolean {
  const settings = getSettingsSync().movies;
  return Boolean(
    settings.jellyfinApiKey.trim() &&
      (settings.jellyfinUrl.trim() || DEFAULT_JELLYFIN_URL),
  );
}

function jellyfinHeaders(): Record<string, string> {
  const token = getJellyfinApiKey();
  // Jellyfin 12+ accepts Authorization MediaBrowser; X-Emby-Token alone can 401.
  return {
    Authorization: `MediaBrowser Client="MovieNight", Device="MovieNightWeb", DeviceId="movie-night-web", Version="1.0.0", Token="${token}"`,
    "X-Emby-Token": token,
    Accept: "application/json",
  };
}

async function jellyfinFetch<T>(
  apiPath: string,
  init?: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${getJellyfinUrl()}${apiPath}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...jellyfinHeaders(),
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Jellyfin request failed (${response.status})${body ? `: ${body.slice(0, 200)}` : ""}`,
      );
    }

    if (response.status === 204) {
      return {} as T;
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Jellyfin request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function getJellyfinUserId(): Promise<string> {
  const override = getSettingsSync().movies.jellyfinUserId.trim();
  if (override) return override;

  if (cachedUserId) return cachedUserId;

  // API keys cannot use /Users/Me on Jellyfin 10.x — resolve an admin user instead.
  const users = await jellyfinFetch<JellyfinUser[]>("/Users");
  const admin = users.find((user) => user.Policy?.IsAdministrator) ?? users[0];
  if (!admin?.Id) {
    throw new Error("No Jellyfin users found");
  }

  cachedUserId = admin.Id;
  return admin.Id;
}

export async function listJellyfinMovies(options: {
  startIndex?: number;
  limit?: number;
  searchTerm?: string;
}): Promise<{ items: JellyfinItem[]; total: number }> {
  const userId = await getJellyfinUserId();
  const params = new URLSearchParams({
    Recursive: "true",
    IncludeItemTypes: "Movie",
    Fields: ITEM_FIELDS,
    SortBy: "SortName",
    StartIndex: String(options.startIndex ?? 0),
    Limit: String(options.limit ?? 100),
  });

  if (options.searchTerm?.trim()) {
    params.set("SearchTerm", options.searchTerm.trim());
  }

  const data = await jellyfinFetch<JellyfinItemsResponse>(
    `/Users/${encodeURIComponent(userId)}/Items?${params.toString()}`,
  );

  return {
    items: data.Items ?? [],
    total: data.TotalRecordCount ?? 0,
  };
}

export async function listJellyfinSeries(options: {
  startIndex?: number;
  limit?: number;
  searchTerm?: string;
  sortBy?: "SortName" | "DateCreated";
  sortOrder?: "Ascending" | "Descending";
}): Promise<{ items: JellyfinItem[]; total: number }> {
  const userId = await getJellyfinUserId();
  const params = new URLSearchParams({
    Recursive: "true",
    IncludeItemTypes: "Series",
    Fields: ITEM_FIELDS,
    SortBy: options.sortBy ?? "SortName",
    SortOrder: options.sortOrder ?? "Ascending",
    StartIndex: String(options.startIndex ?? 0),
    Limit: String(options.limit ?? 48),
  });

  if (options.searchTerm?.trim()) {
    params.set("SearchTerm", options.searchTerm.trim());
  }

  const data = await jellyfinFetch<JellyfinItemsResponse>(
    `/Users/${encodeURIComponent(userId)}/Items?${params.toString()}`,
  );

  return {
    items: data.Items ?? [],
    total: data.TotalRecordCount ?? 0,
  };
}

export async function listJellyfinEpisodes(
  seriesId: string,
): Promise<JellyfinItem[]> {
  const userId = await getJellyfinUserId();
  const params = new URLSearchParams({
    Fields: ITEM_FIELDS,
    SortBy: "ParentIndexNumber,IndexNumber,SortName",
  });

  const data = await jellyfinFetch<JellyfinItemsResponse>(
    `/Shows/${encodeURIComponent(seriesId)}/Episodes?userId=${encodeURIComponent(userId)}&${params.toString()}`,
  );

  return data.Items ?? [];
}

export async function listJellyfinEpisodesByDate(options: {
  startIndex?: number;
  limit?: number;
}): Promise<{ items: JellyfinItem[]; total: number }> {
  const userId = await getJellyfinUserId();
  const params = new URLSearchParams({
    Recursive: "true",
    IncludeItemTypes: "Episode",
    Fields: ITEM_FIELDS,
    SortBy: "DateCreated",
    SortOrder: "Descending",
    StartIndex: String(options.startIndex ?? 0),
    Limit: String(options.limit ?? 100),
  });
  const data = await jellyfinFetch<JellyfinItemsResponse>(
    `/Users/${encodeURIComponent(userId)}/Items?${params.toString()}`,
  );
  return {
    items: data.Items ?? [],
    total: data.TotalRecordCount ?? 0,
  };
}

export async function listJellyfinEpisodesBySize(options: {
  startIndex?: number;
  limit?: number;
  searchTerm?: string;
  sortOrder?: "Ascending" | "Descending";
}): Promise<{ items: JellyfinItem[]; total: number }> {
  const userId = await getJellyfinUserId();
  const params = new URLSearchParams({
    Recursive: "true",
    IncludeItemTypes: "Episode",
    Fields: ITEM_FIELDS,
    SortBy: "Size,SortName",
    SortOrder: options.sortOrder ?? "Descending",
    StartIndex: String(options.startIndex ?? 0),
    Limit: String(options.limit ?? 100),
  });
  if (options.searchTerm?.trim()) {
    params.set("SearchTerm", options.searchTerm.trim());
  }
  const data = await jellyfinFetch<JellyfinItemsResponse>(
    `/Users/${encodeURIComponent(userId)}/Items?${params.toString()}`,
  );
  return {
    items: data.Items ?? [],
    total: data.TotalRecordCount ?? 0,
  };
}

export async function fetchAllJellyfinMovies(): Promise<JellyfinItem[]> {
  const pageSize = 200;
  const all: JellyfinItem[] = [];
  let startIndex = 0;
  let total = Infinity;

  while (startIndex < total) {
    const page = await listJellyfinMovies({ startIndex, limit: pageSize });
    total = page.total;
    all.push(...page.items);
    if (page.items.length === 0) break;
    startIndex += page.items.length;
  }

  return all;
}

export async function getJellyfinItemById(
  itemId: string,
): Promise<JellyfinItem | null> {
  try {
    // /Items/{id} returns 400 on some Jellyfin builds — use the user-scoped route.
    const userId = await getJellyfinUserId();
    return await jellyfinFetch<JellyfinItem>(
      `/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(itemId)}?Fields=${ITEM_FIELDS}`,
    );
  } catch {
    return null;
  }
}

export async function listJellyfinSeasons(
  seriesId: string,
): Promise<JellyfinItem[]> {
  const userId = await getJellyfinUserId();
  const params = new URLSearchParams({
    userId,
    Fields: "ImageTags,IndexNumber,Name,Path",
  });
  const data = await jellyfinFetch<JellyfinItemsResponse>(
    `/Shows/${encodeURIComponent(seriesId)}/Seasons?${params.toString()}`,
  );
  return data.Items ?? [];
}

export function jellyfinPosterUrl(itemId: string, maxWidth = 400): string {
  return `${getJellyfinUrl()}/Items/${encodeURIComponent(itemId)}/Images/Primary?maxWidth=${maxWidth}`;
}

export async function fetchJellyfinPoster(
  itemId: string,
  maxWidth = 400,
): Promise<{ data: Buffer; contentType: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(jellyfinPosterUrl(itemId, maxWidth), {
      signal: controller.signal,
      headers: jellyfinHeaders(),
    });

    if (!response.ok) return null;

    const contentType =
      response.headers.get("Content-Type") ?? "image/jpeg";
    const data = Buffer.from(await response.arrayBuffer());
    return { data, contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type PathMapping = {
  winPrefix: string;
  dockerPrefix: string;
  rootKey: string;
};

const DEFAULT_TV_SOURCE_PREFIX = "/data/tv-shows-h-drive";
const DEFAULT_TV_SOURCE_E_PREFIX = "/data/tv-shows-e-drive";
const DEFAULT_TV_SOURCE_J_PREFIX = "/data/tv-shows-j-drive";
/** Jellyfin library for already-converted VRC/Jellyfin TV output */
const DEFAULT_TV_JELLYFIN_PREFIX = "/data/tv-h";

export function getTvSourcePathPrefix(): string {
  return (
    getSettingsSync().movies.jellyfinPathHPrefix.trim() ||
    DEFAULT_TV_SOURCE_PREFIX
  );
}

export function getTvJellyfinOutputPathPrefix(): string {
  return (
    getSettingsSync().movies.jellyfinPathHJellyfinPrefix.trim() ||
    DEFAULT_TV_JELLYFIN_PREFIX
  );
}

function getTvSourceMappings(): PathMapping[] {
  return [
    {
      winPrefix: getTvSourcePathPrefix(),
      dockerPrefix: "/tv-h/TV Shows H Drive",
      rootKey: "h",
    },
    {
      winPrefix: DEFAULT_TV_SOURCE_E_PREFIX,
      dockerPrefix: "/movies-e/TV Shows E Drive",
      rootKey: "te",
    },
    {
      winPrefix: DEFAULT_TV_SOURCE_J_PREFIX,
      dockerPrefix: "/movies-j/TV Shows J Drive",
      rootKey: "tj",
    },
  ];
}

export function getJellyfinPathMappings(): PathMapping[] {
  const settings = getSettingsSync().movies;
  return [
    {
      winPrefix:
        settings.jellyfinPathEPrefix.trim() || "/data/movies-e-original",
      dockerPrefix: "/movies-e/Movies E Drive",
      rootKey: "e",
    },
    {
      winPrefix:
        settings.jellyfinPathJPrefix.trim() || "/data/movies-j-original",
      dockerPrefix: "/movies-j/Movies J Drive",
      rootKey: "j",
    },
    ...getTvSourceMappings(),
  ];
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function pathStartsWithPrefix(normalized: string, prefix: string): boolean {
  const p = normalizePath(prefix).replace(/\/+$/, "").toLowerCase();
  const n = normalized.toLowerCase();
  return n === p || n.startsWith(`${p}/`);
}

/**
 * Fedora NTFS mount roots → Docker Desktop Samba RO mounts used by movie-night-web.
 * Converter-agent returns Fedora absolute paths after SSH publish; the web container
 * reads the same files via /movies-e|/movies-j|/tv-h.
 */
const FEDORA_MOUNT_TO_DOCKER: Array<{ fedora: string; docker: string }> = [
  { fedora: "/mnt/bigger-media", docker: "/movies-e" },
  { fedora: "/mnt/18tb-media", docker: "/movies-j" },
  { fedora: "/mnt/external-media", docker: "/tv-h" },
];

/** True if path is already under a web-container library mount. */
export function isDockerLibraryPath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return (
    pathStartsWithPrefix(normalized, "/movies-e") ||
    pathStartsWithPrefix(normalized, "/movies-j") ||
    pathStartsWithPrefix(normalized, "/tv-h")
  );
}

/**
 * Map a host/Fedora library path to the path visible inside movie-night-web.
 * Passes through Docker mount paths unchanged.
 */
export function mapHostLibraryPathToDocker(filePath: string): string {
  const normalized = normalizePath(filePath).trim();
  if (!normalized) return normalized;
  if (isDockerLibraryPath(normalized)) {
    return normalized;
  }
  for (const { fedora, docker } of FEDORA_MOUNT_TO_DOCKER) {
    if (pathStartsWithPrefix(normalized, fedora)) {
      return docker + normalized.slice(fedora.length);
    }
  }
  return normalized;
}

/** Already-converted TV under H:\TV Shows H Drive - Jellyfin (Jellyfin /data/tv-h). */
export function isTvJellyfinOutputPath(jellyfinPath: string): boolean {
  const normalized = normalizePath(jellyfinPath);
  if (pathStartsWithPrefix(normalized, getTvJellyfinOutputPathPrefix())) {
    return true;
  }
  // Windows / share-style paths for the Jellyfin output folder
  return /\/TV Shows H Drive - Jellyfin(\/|$)/i.test(normalized);
}

export function isTvSourceRootKey(rootKey: string): boolean {
  return rootKey === "h" || rootKey === "te" || rootKey === "tj";
}

/** Source TV under E/H/J TV Shows libraries (not converted VRC output). */
export function isTvSourcePath(jellyfinPath: string): boolean {
  if (isTvJellyfinOutputPath(jellyfinPath)) return false;
  const normalized = normalizePath(jellyfinPath);
  for (const mapping of getTvSourceMappings()) {
    if (pathStartsWithPrefix(normalized, mapping.winPrefix)) return true;
  }
  // Windows share-style paths for source (must not match "... - Jellyfin")
  return /\/TV Shows [EHJ] Drive\//i.test(normalized);
}

/**
 * Map a Jellyfin file Path to the Docker mount. folderName is the relative
 * directory under the source root (supports nested TV season folders).
 */
export function mapJellyfinPathToDocker(
  jellyfinPath: string,
): { dockerPath: string; rootKey: string; folderName: string } | null {
  const normalized = normalizePath(jellyfinPath);

  // Never map already-converted Jellyfin TV output as a convertible source.
  if (isTvJellyfinOutputPath(normalized)) {
    return null;
  }

  const mappings = [...getJellyfinPathMappings()];

  // Fallback: detect TV source folders by name when path uses Windows layout.
  const tvFolderMatchers: Array<{
    pattern: RegExp;
    dockerPrefix: string;
    rootKey: string;
    marker: string;
  }> = [
    {
      pattern: /\/TV Shows H Drive\//i,
      dockerPrefix: "/tv-h/TV Shows H Drive",
      rootKey: "h",
      marker: "/TV Shows H Drive",
    },
    {
      pattern: /\/TV Shows E Drive\//i,
      dockerPrefix: "/movies-e/TV Shows E Drive",
      rootKey: "te",
      marker: "/TV Shows E Drive",
    },
    {
      pattern: /\/TV Shows J Drive\//i,
      dockerPrefix: "/movies-j/TV Shows J Drive",
      rootKey: "tj",
      marker: "/TV Shows J Drive",
    },
  ];

  for (const matcher of tvFolderMatchers) {
    if (
      matcher.pattern.test(normalized) &&
      !isTvJellyfinOutputPath(normalized)
    ) {
      const idx = normalized.toLowerCase().indexOf(matcher.marker.toLowerCase());
      if (idx >= 0) {
        mappings.unshift({
          winPrefix: normalized.slice(0, idx + matcher.marker.length),
          dockerPrefix: matcher.dockerPrefix,
          rootKey: matcher.rootKey,
        });
      }
    }
  }

  for (const mapping of mappings) {
    const prefix = normalizePath(mapping.winPrefix);
    if (!pathStartsWithPrefix(normalized, prefix)) {
      continue;
    }

    const relative = normalized
      .slice(normalizePath(prefix).replace(/\/+$/, "").length)
      .replace(/^\/+/, "");
    if (!relative) {
      // Series/folder root — still a valid source mapping with empty relative file.
      return {
        dockerPath: normalizePath(mapping.dockerPrefix),
        rootKey: mapping.rootKey,
        folderName: "",
      };
    }

    const parts = relative.split("/").filter(Boolean);
    if (parts.length === 0) return null;

    const relativeDir = parts.slice(0, -1).join("/");
    const folderName =
      relativeDir ||
      (parts.length === 1 ? parts[0] : "") ||
      path.posix.basename(path.posix.dirname(normalized)) ||
      parts[0];

    const dockerPath = path.posix.join(
      normalizePath(mapping.dockerPrefix),
      ...parts,
    );

    return {
      dockerPath,
      rootKey: mapping.rootKey,
      folderName,
    };
  }

  return null;
}

export function itemHasPoster(item: JellyfinItem): boolean {
  return Boolean(item.ImageTags?.Primary);
}

export function itemSizeBytes(item: JellyfinItem): number {
  if (typeof item.Size === "number" && item.Size > 0) return item.Size;
  const source = item.MediaSources?.[0];
  if (typeof source?.Size === "number" && source.Size > 0) return source.Size;
  return 0;
}

export async function getJellyfinHealth(): Promise<{
  ok: boolean;
  serverName?: string;
  version?: string;
  movieCount?: number;
  mappedSample?: boolean;
  error?: string;
}> {
  if (!isJellyfinConfigured()) {
    return { ok: false, error: "Jellyfin is not configured" };
  }

  try {
    const publicInfo = await jellyfinFetch<JellyfinPublicInfo>(
      "/System/Info/Public",
    );
    await getJellyfinUserId();

    const sample = await listJellyfinMovies({ limit: 1 });
    let mappedSample = false;
    const firstPath = sample.items[0]?.Path;
    if (firstPath) {
      mappedSample = mapJellyfinPathToDocker(firstPath) !== null;
    }

    return {
      ok: true,
      serverName: publicInfo.ServerName,
      version: publicInfo.Version,
      movieCount: sample.total,
      mappedSample,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Jellyfin unreachable",
    };
  }
}
