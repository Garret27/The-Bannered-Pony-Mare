import { getSettingsSync } from "./settings";

const API_BASE = "https://api.opensubtitles.com/api/v1";
const USER_AGENT = "MovieNightManager/1.0.0";

export class OpenSubtitlesConfigError extends Error {
  constructor(message = "OpenSubtitles is not configured") {
    super(message);
    this.name = "OpenSubtitlesConfigError";
  }
}

export class OpenSubtitlesApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "OpenSubtitlesApiError";
    this.status = status;
  }
}

export type OpenSubtitlesFeature = {
  id: number;
  title: string;
  year: number | null;
  type: string;
  imdbId: number | null;
  posterUrl: string | null;
  url: string | null;
};

export type OpenSubtitlesSearchResult = {
  id: string;
  fileId: number;
  language: string;
  release: string;
  downloadCount: number;
  hearingImpaired: boolean;
  fps: number;
  fromTrusted: boolean;
  uploader: string;
  featureTitle: string;
  year: number | null;
};

type TokenCache = {
  token: string;
  expiresAt: number;
};

let tokenCache: TokenCache | null = null;

function getApiKey(): string {
  const key = getSettingsSync().opensubtitles.apiKey.trim();
  if (!key) {
    throw new OpenSubtitlesConfigError("OPENSUBTITLES_API_KEY is not configured");
  }
  return key;
}

export function isOpenSubtitlesConfigured(): boolean {
  return Boolean(getSettingsSync().opensubtitles.apiKey.trim());
}

async function opensubtitlesFetch(
  path: string,
  options: RequestInit = {},
  auth = false,
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("Api-Key", getApiKey());
  headers.set("User-Agent", USER_AGENT);

  if (auth) {
    const token = await getAuthToken();
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  return response;
}

async function getAuthToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }

  const username = getSettingsSync().opensubtitles.username.trim();
  const password = getSettingsSync().opensubtitles.password.trim();

  if (!username || !password) {
    throw new OpenSubtitlesConfigError(
      "OPENSUBTITLES_USERNAME and OPENSUBTITLES_PASSWORD are required for downloads",
    );
  }

  const response = await opensubtitlesFetch("/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });

  const data = (await response.json()) as {
    token?: string;
    status?: number;
    message?: string;
  };

  if (!response.ok || !data.token) {
    throw new OpenSubtitlesApiError(
      data.message ?? "OpenSubtitles login failed",
      response.status,
    );
  }

  tokenCache = {
    token: data.token,
    expiresAt: Date.now() + 12 * 60 * 60 * 1000,
  };

  return data.token;
}

function mapFeature(item: Record<string, unknown>): OpenSubtitlesFeature {
  const attributes = (item.attributes ?? {}) as Record<string, unknown>;
  const img = attributes.img_url;
  const related = attributes.related_links;

  let posterUrl: string | null = null;
  if (typeof img === "string" && img.trim()) {
    posterUrl = img;
  } else if (typeof related === "object" && related && "img_url" in related) {
    const relatedImg = (related as { img_url?: unknown }).img_url;
    if (typeof relatedImg === "string" && relatedImg.trim()) {
      posterUrl = relatedImg;
    }
  }

  const id = Number(attributes.feature_id ?? item.id ?? 0);
  const title = String(
    attributes.title ?? attributes.feature_name ?? attributes.name ?? "Unknown title",
  );
  const yearRaw = attributes.year;
  const year =
    yearRaw !== undefined && yearRaw !== null && String(yearRaw).trim() !== ""
      ? Number(yearRaw)
      : null;

  return {
    id,
    title,
    year: Number.isFinite(year) ? year : null,
    type: String(attributes.feature_type ?? attributes.type ?? item.type ?? "Movie"),
    imdbId: attributes.imdb_id ? Number(attributes.imdb_id) : null,
    posterUrl,
    url: typeof attributes.url === "string" ? attributes.url : null,
  };
}

function mapSearchResult(item: Record<string, unknown>): OpenSubtitlesSearchResult {
  const attributes = (item.attributes ?? {}) as Record<string, unknown>;
  const featureDetails = (attributes.feature_details ?? {}) as Record<string, unknown>;
  const files = (attributes.files ?? []) as Array<Record<string, unknown>>;
  const primaryFile = files[0] ?? {};

  return {
    id: String(item.id ?? primaryFile.file_id ?? ""),
    fileId: Number(primaryFile.file_id ?? item.id ?? 0),
    language: String(attributes.language ?? "unknown"),
    release: String(attributes.release ?? primaryFile.file_name ?? "Unknown release"),
    downloadCount: Number(attributes.download_count ?? 0),
    hearingImpaired: Boolean(attributes.hearing_impaired),
    fps: Number(attributes.fps ?? 0),
    fromTrusted: Boolean(attributes.from_trusted),
    uploader: (() => {
      const uploader = attributes.uploader;
      if (typeof uploader === "object" && uploader && "name" in uploader) {
        return String((uploader as { name?: string }).name ?? "");
      }
      return String(uploader ?? "");
    })(),
    featureTitle: String(
      featureDetails.movie_name ?? featureDetails.title ?? attributes.movie_name ?? "",
    ),
    year: featureDetails.year ? Number(featureDetails.year) : null,
  };
}

export async function searchFeatures(options: {
  query: string;
  year?: number;
}): Promise<OpenSubtitlesFeature[]> {
  const params = new URLSearchParams();
  params.set("query", options.query.trim());
  params.set("type", "movie");
  if (options.year) params.set("year", String(options.year));

  const response = await opensubtitlesFetch(`/features?${params.toString()}`);

  const data = (await response.json()) as {
    data?: Array<Record<string, unknown>>;
    message?: string;
  };

  if (!response.ok) {
    throw new OpenSubtitlesApiError(
      data.message ?? "OpenSubtitles feature search failed",
      response.status,
    );
  }

  return (data.data ?? [])
    .map(mapFeature)
    .filter((feature) => feature.id > 0);
}

export async function searchSubtitlesByFeature(options: {
  featureId: number;
  languages?: string;
}): Promise<OpenSubtitlesSearchResult[]> {
  const params = new URLSearchParams();
  params.set("id", String(options.featureId));
  params.set("languages", options.languages ?? "en");
  params.set("order_by", "download_count");

  const response = await opensubtitlesFetch(`/subtitles?${params.toString()}`);

  const data = (await response.json()) as {
    data?: Array<Record<string, unknown>>;
    message?: string;
  };

  if (!response.ok) {
    throw new OpenSubtitlesApiError(
      data.message ?? "OpenSubtitles subtitle search failed",
      response.status,
    );
  }

  return (data.data ?? [])
    .map(mapSearchResult)
    .filter((result) => result.fileId > 0);
}

export async function downloadSubtitle(fileId: number): Promise<string> {
  const response = await opensubtitlesFetch(
    "/download",
    {
      method: "POST",
      body: JSON.stringify({ file_id: fileId }),
    },
    true,
  );

  const data = (await response.json()) as {
    link?: string;
    file_name?: string;
    message?: string;
  };

  if (!response.ok || !data.link) {
    throw new OpenSubtitlesApiError(
      data.message ?? "OpenSubtitles download failed",
      response.status,
    );
  }

  const fileResponse = await fetch(data.link);
  if (!fileResponse.ok) {
    throw new OpenSubtitlesApiError(
      "Failed to fetch subtitle file from download link",
      fileResponse.status,
    );
  }

  const buffer = Buffer.from(await fileResponse.arrayBuffer());
  const text = buffer.toString("utf-8");

  if (data.file_name?.toLowerCase().endsWith(".zip")) {
    throw new OpenSubtitlesApiError(
      "Downloaded a ZIP archive; only direct SRT downloads are supported",
      415,
    );
  }

  return text;
}
