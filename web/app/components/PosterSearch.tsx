"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Event } from "@/lib/paths";
import { EVENT_LABELS } from "@/lib/paths";
import { Toast } from "./Toast";
import styles from "./PosterSearch.module.css";

type MovieResult = {
  id: number;
  title: string;
  year: string | null;
  overview: string;
  posterPath: string | null;
  posterUrl: string | null;
};

type PosterOption = {
  filePath: string;
  previewUrl: string;
  language: string | null;
  width: number;
  height: number;
  voteAverage: number;
};

type ToastState = {
  message: string;
  type: "success" | "error";
} | null;

function formatMovieTitle(movie: MovieResult): string {
  return movie.year ? `${movie.title} (${movie.year})` : movie.title;
}

export function PosterSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MovieResult[]>([]);
  const [selectedMovie, setSelectedMovie] = useState<MovieResult | null>(null);
  const [posters, setPosters] = useState<PosterOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingPosters, setLoadingPosters] = useState(false);
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [posterError, setPosterError] = useState<string | null>(null);
  const [applyMovieTitle, setApplyMovieTitle] = useState(true);
  const [toast, setToast] = useState<ToastState>(null);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 5000);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearchError(null);
      return;
    }

    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchError(null);

      try {
        const response = await fetch(
          `/api/tmdb/search?q=${encodeURIComponent(trimmed)}`,
        );
        const data = (await response.json()) as {
          results?: MovieResult[];
          error?: string;
        };

        if (response.status === 503) {
          setConfigError(data.error ?? "TMDB_API_KEY is not configured");
          setResults([]);
          return;
        }

        if (!response.ok) {
          throw new Error(data.error ?? "Search failed");
        }

        setConfigError(null);
        setResults(data.results ?? []);
      } catch (error) {
        setSearchError(
          error instanceof Error ? error.message : "Search failed",
        );
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [query]);

  const selectMovie = async (movie: MovieResult) => {
    setSelectedMovie(movie);
    setPosters([]);
    setPosterError(null);
    setLoadingPosters(true);

    try {
      const response = await fetch(`/api/tmdb/movie/${movie.id}/posters`);
      const data = (await response.json()) as {
        posters?: PosterOption[];
        error?: string;
      };

      if (response.status === 503) {
        setConfigError(data.error ?? "TMDB_API_KEY is not configured");
        return;
      }

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load posters");
      }

      setPosters(data.posters ?? []);
      if ((data.posters ?? []).length === 0) {
        setPosterError("No posters found for this movie.");
      }
    } catch (error) {
      setPosterError(
        error instanceof Error ? error.message : "Failed to load posters",
      );
    } finally {
      setLoadingPosters(false);
    }
  };

  const applyPoster = async (event: Event, filePath: string) => {
    const key = `${event}:${filePath}`;
    setApplyingKey(key);

    try {
      const response = await fetch(`/api/posters/${event}/from-tmdb`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath,
          applyMovieTitle,
          movieTitle: selectedMovie
            ? formatMovieTitle(selectedMovie)
            : undefined,
        }),
      });

      const data = (await response.json()) as { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to apply poster");
      }

      showToast(
        `${data.message ?? "Poster saved"} for ${EVENT_LABELS[event]}`,
        "success",
      );
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to apply poster",
        "error",
      );
    } finally {
      setApplyingKey(null);
    }
  };

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <h1>Search official posters</h1>
        <p>
          Find a movie on TMDB, pick an official poster, and apply it directly to
          Main or HSPC.
        </p>
      </header>

      {configError && (
        <div className={styles.alert}>
          <strong>TMDB not configured.</strong> Add your API key to{" "}
          <code>web/.env</code> as <code>TMDB_API_KEY=...</code>, then restart
          Docker with <code>docker compose up --build</code>.
        </div>
      )}

      <div className={styles.searchBox}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search movies…"
          aria-label="Search movies"
          disabled={Boolean(configError)}
        />
        {searching && <span className={styles.hint}>Searching…</span>}
      </div>

      {searchError && <p className={styles.error}>{searchError}</p>}

      {results.length > 0 && (
        <section className={styles.section}>
          <h2>Results</h2>
          <div className={styles.movieGrid}>
            {results.map((movie) => (
              <button
                key={movie.id}
                type="button"
                className={`${styles.movieCard} ${
                  selectedMovie?.id === movie.id ? styles.selected : ""
                }`}
                onClick={() => void selectMovie(movie)}
              >
                <div className={styles.thumb}>
                  {movie.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={movie.posterUrl} alt="" />
                  ) : (
                    <span>No image</span>
                  )}
                </div>
                <div className={styles.movieMeta}>
                  <strong>{movie.title}</strong>
                  {movie.year && <span>{movie.year}</span>}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {selectedMovie && (
        <section className={styles.section}>
          <h2>
            Posters for {selectedMovie.title}
            {selectedMovie.year ? ` (${selectedMovie.year})` : ""}
          </h2>
          <label className={styles.applyTitleOption}>
            <input
              type="checkbox"
              checked={applyMovieTitle}
              onChange={(event) => setApplyMovieTitle(event.target.checked)}
            />
            <span>
              Also set the event movie title to{" "}
              <strong>{formatMovieTitle(selectedMovie)}</strong>
            </span>
          </label>

          {loadingPosters && <p className={styles.hint}>Loading posters…</p>}
          {posterError && <p className={styles.error}>{posterError}</p>}

          {!loadingPosters && posters.length > 0 && (
            <div className={styles.posterGrid}>
              {posters.map((poster) => (
                  <article key={poster.filePath} className={styles.posterCard}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={poster.previewUrl}
                      alt={`Poster ${poster.language ?? "original"}`}
                    />
                    <div className={styles.posterMeta}>
                      <span>
                        {poster.language?.toUpperCase() ?? "Original"} ·{" "}
                        {poster.width}×{poster.height}
                      </span>
                    </div>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        disabled={applyingKey !== null}
                        onClick={() => void applyPoster("main", poster.filePath)}
                      >
                        {applyingKey === `main:${poster.filePath}`
                          ? "Applying…"
                          : "Apply to Main"}
                      </button>
                      <button
                        type="button"
                        className={styles.secondary}
                        disabled={applyingKey !== null}
                        onClick={() => void applyPoster("hspc", poster.filePath)}
                      >
                        {applyingKey === `hspc:${poster.filePath}`
                          ? "Applying…"
                          : "Apply to HSPC"}
                      </button>
                    </div>
                  </article>
              ))}
            </div>
          )}
        </section>
      )}

      <footer className={styles.footer}>
        <p>
          This product uses the TMDB API but is not endorsed or certified by
          TMDB.
        </p>
        <Link href="/">Back to dashboard</Link>
      </footer>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}
    </main>
  );
}
