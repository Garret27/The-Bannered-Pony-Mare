"use client";

import { useEffect, useRef, useState } from "react";
import { formatBytes } from "@/lib/format";
import type { MovieEntry } from "@/lib/movies-library";
import styles from "./MoviePicker.module.css";

type MoviePickerProps = {
  onSelect: (movie: MovieEntry) => void;
  selectedId?: string | null;
  initialQuery?: string;
  pageSize?: number;
};

type LibraryResponse = {
  movies: MovieEntry[];
  total: number;
  page: number;
  limit: number;
  error?: string;
};

function MoviePoster({ movie }: { movie: MovieEntry }) {
  const [failed, setFailed] = useState(false);

  if (!movie.hasPoster || failed) {
    return (
      <div className={styles.posterPlaceholder} aria-hidden="true">
        {movie.title.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      className={styles.poster}
      src={`/api/movies/${encodeURIComponent(movie.id)}/poster`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function MoviePicker({
  onSelect,
  selectedId,
  initialQuery = "",
  pageSize = 48,
}: MoviePickerProps) {
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [page, setPage] = useState(1);
  const [movies, setMovies] = useState<MovieEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();

    const loadMovies = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(pageSize),
        });
        if (debouncedQuery.trim()) {
          params.set("q", debouncedQuery.trim());
        }

        const response = await fetch(`/api/movies/library?${params.toString()}`, {
          signal: controller.signal,
        });
        const data = (await response.json()) as LibraryResponse;

        // Ignore stale responses from an earlier search/page request.
        if (requestId !== requestIdRef.current) return;

        if (response.status === 503) {
          setConfigError(data.error ?? "Movie library is not configured");
          setMovies([]);
          setTotal(0);
          return;
        }

        if (!response.ok) {
          throw new Error(data.error ?? "Failed to load movies");
        }

        setConfigError(null);
        setMovies(data.movies);
        setTotal(data.total);
      } catch (err) {
        if (controller.signal.aborted || requestId !== requestIdRef.current) {
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load movies");
        setMovies([]);
        setTotal(0);
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    };

    void loadMovies();

    return () => {
      controller.abort();
    };
  }, [debouncedQuery, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className={styles.picker}>
      <div className={styles.searchRow}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search movies…"
          aria-label="Search movies"
        />
      </div>

      {configError && <div className={styles.alert}>{configError}</div>}
      {error && <div className={styles.alert}>{error}</div>}

      {!configError && (
        <p className={styles.meta}>
          {loading
            ? "Loading Jellyfin library…"
            : `${total.toLocaleString()} movie${total === 1 ? "" : "s"}${debouncedQuery ? ` matching “${debouncedQuery}”` : ""}`}
        </p>
      )}

      <div className={styles.grid}>
        {loading && movies.length === 0 ? (
          <p className={styles.loading}>Loading…</p>
        ) : movies.length === 0 ? (
          <p className={styles.empty}>No movies found.</p>
        ) : (
          movies.map((movie) => (
            <button
              key={movie.id}
              type="button"
              className={`${styles.card} ${selectedId === movie.id ? styles.cardSelected : ""}`}
              onClick={() => onSelect(movie)}
            >
              <MoviePoster movie={movie} />
              <div className={styles.cardBody}>
                <span className={styles.title}>
                  {movie.title}
                  {movie.year ? ` (${movie.year})` : ""}
                </span>
                <span className={styles.cardMeta}>
                  <span className={styles.format}>{movie.format}</span>
                  <span className={styles.size}>{formatBytes(movie.sizeBytes)}</span>
                </span>
              </div>
            </button>
          ))
        )}
      </div>

      {!configError && total > pageSize && (
        <div className={styles.pagination}>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonSecondary}`}
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span className={styles.meta}>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonSecondary}`}
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
