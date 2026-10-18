import { getSettingsSync } from "./settings";

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

export class TmdbConfigError extends Error {
  constructor() {
    super("TMDB_API_KEY is not configured");
    this.name = "TmdbConfigError";
  }
}

export class TmdbApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "TmdbApiError";
    this.status = status;
  }
}

export function getTmdbApiKey(): string {
  const key = getSettingsSync().tmdb.apiKey.trim();
  if (!key) {
    throw new TmdbConfigError();
  }
  return key;
}

export function isTmdbConfigured(): boolean {
  return Boolean(getSettingsSync().tmdb.apiKey.trim());
}
export function tmdbImageUrl(
  filePath: string | null,
  size: "w342" | "w500" | "original" = "w342",
): string | null {
  if (!filePath) return null;
  return `${TMDB_IMAGE_BASE}/${size}${filePath}`;
}

export type MovieSearchResult = {
  id: number;
  title: string;
  year: string | null;
  overview: string;
  posterPath: string | null;
  posterUrl: string | null;
};

export type MoviePosterOption = {
  filePath: string;
  previewUrl: string;
  language: string | null;
  width: number;
  height: number;
  voteAverage: number;
};

type TmdbSearchResponse = {
  results: Array<{
    id: number;
    title: string;
    release_date?: string;
    overview?: string;
    poster_path?: string | null;
  }>;
};

type TmdbImagesResponse = {
  posters: Array<{
    file_path: string;
    iso_639_1?: string | null;
    width: number;
    height: number;
    vote_average?: number;
  }>;
};

async function tmdbFetch<T>(path: string): Promise<T> {
  const apiKey = getTmdbApiKey();
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set("api_key", apiKey);

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new TmdbApiError(
      text || `TMDB request failed (${response.status})`,
      response.status,
    );
  }

  return response.json() as Promise<T>;
}

export async function searchMovies(query: string): Promise<MovieSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const data = await tmdbFetch<TmdbSearchResponse>(
    `/search/movie?query=${encodeURIComponent(trimmed)}&include_adult=false`,
  );

  return data.results.map((movie) => ({
    id: movie.id,
    title: movie.title,
    year: movie.release_date?.slice(0, 4) ?? null,
    overview: movie.overview ?? "",
    posterPath: movie.poster_path ?? null,
    posterUrl: tmdbImageUrl(movie.poster_path ?? null, "w342"),
  }));
}

function posterSortScore(language: string | null): number {
  if (language === "en") return 0;
  if (language === null) return 1;
  return 2;
}

export async function getMoviePosters(
  movieId: number,
): Promise<MoviePosterOption[]> {
  const data = await tmdbFetch<TmdbImagesResponse>(`/movie/${movieId}/images`);

  return data.posters
    .map((poster) => ({
      filePath: poster.file_path,
      previewUrl: tmdbImageUrl(poster.file_path, "w342")!,
      language: poster.iso_639_1 ?? null,
      width: poster.width,
      height: poster.height,
      voteAverage: poster.vote_average ?? 0,
    }))
    .sort((a, b) => {
      const langDiff =
        posterSortScore(a.language) - posterSortScore(b.language);
      if (langDiff !== 0) return langDiff;
      if (b.voteAverage !== a.voteAverage) return b.voteAverage - a.voteAverage;
      return b.width - a.width;
    });
}

export async function downloadPoster(filePath: string): Promise<Buffer> {
  if (!filePath.startsWith("/")) {
    throw new Error("Invalid TMDB poster path");
  }

  const url = tmdbImageUrl(filePath, "original");
  if (!url) {
    throw new Error("Invalid TMDB poster path");
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new TmdbApiError(
      `Failed to download poster (${response.status})`,
      response.status,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
