"use client";

import { useEffect, useRef, useState } from "react";
import type { TvEpisodeEntry, TvSeriesEntry } from "@/lib/tv-types";
import styles from "./MoviePicker.module.css";

type SeriesPickerProps = {
  onSelect: (series: TvSeriesEntry) => void;
  onSelectEpisode: (episode: RecentEpisode) => void;
  selectedId?: string | null;
  pageSize?: number;
};

export type RecentEpisode = TvEpisodeEntry & { code: string };

type SeriesResponse = {
  series: TvSeriesEntry[];
  total: number;
  page: number;
  limit: number;
  error?: string;
};

function SeriesPoster({ series }: { series: TvSeriesEntry }) {
  const [failed, setFailed] = useState(false);

  if (!series.hasPoster || failed) {
    return (
      <div className={styles.posterPlaceholder} aria-hidden="true">
        {series.title.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={styles.poster}
      src={`/api/tv/series/${encodeURIComponent(series.id)}/poster`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function EpisodePoster({ episode }: { episode: RecentEpisode }) {
  const [failed, setFailed] = useState(false);

  if (!episode.seriesId || failed) {
    return (
      <div className={styles.posterPlaceholder} aria-hidden="true">
        {episode.seriesName.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={styles.poster}
      src={`/api/tv/series/${encodeURIComponent(episode.seriesId)}/poster`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function formatAddedDate(value?: string): string {
  if (!value) return "Recently added";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently added";
  return `Added ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date)}`;
}

export function SeriesPicker({
  onSelect,
  onSelectEpisode,
  selectedId,
  pageSize = 48,
}: SeriesPickerProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [series, setSeries] = useState<TvSeriesEntry[]>([]);
  const [recentEpisodes, setRecentEpisodes] = useState<RecentEpisode[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();

    const loadRecent = async () => {
      try {
        const response = await fetch(
          "/api/tv/series?recentEpisodes=true&limit=20",
          { signal: controller.signal },
        );
        const data = (await response.json()) as {
          episodes?: RecentEpisode[];
        };
        if (response.ok) setRecentEpisodes(data.episodes ?? []);
      } catch {
        // The main library request presents configuration and connection errors.
      } finally {
        if (!controller.signal.aborted) setRecentLoading(false);
      }
    };

    void loadRecent();
    return () => controller.abort();
  }, []);

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

    const load = async () => {
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

        const response = await fetch(`/api/tv/series?${params.toString()}`, {
          signal: controller.signal,
        });
        const data = (await response.json()) as SeriesResponse;

        if (requestId !== requestIdRef.current) return;

        if (response.status === 503) {
          setConfigError(data.error ?? "TV library is not configured");
          setSeries([]);
          setTotal(0);
          return;
        }

        if (!response.ok) {
          throw new Error(data.error ?? "Failed to load series");
        }

        setConfigError(null);
        setSeries(data.series);
        setTotal(data.total);
      } catch (err) {
        if (controller.signal.aborted || requestId !== requestIdRef.current) {
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load series");
        setSeries([]);
        setTotal(0);
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => controller.abort();
  }, [debouncedQuery, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className={styles.picker}>
      <section className={styles.recentSection}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Recently added</h2>
            <p>Latest 20 episodes in the E, H, and J TV libraries</p>
          </div>
        </div>
        <div className={styles.recentGrid}>
          {recentLoading ? (
            <p className={styles.recentEmpty}>Loading recent shows…</p>
          ) : recentEpisodes.length === 0 ? (
            <p className={styles.recentEmpty}>No recently added episodes found.</p>
          ) : (
            recentEpisodes.map((episode) => (
              <button
                key={episode.id}
                type="button"
                className={`${styles.card} ${styles.recentCard}`}
                onClick={() => onSelectEpisode(episode)}
              >
                <EpisodePoster episode={episode} />
                <div className={styles.cardBody}>
                  <span className={styles.title}>
                    {episode.seriesName}
                  </span>
                  <span className={styles.episodeTitle}>
                    {episode.code} · {episode.title}
                  </span>
                  <span className={styles.addedDate}>
                    {formatAddedDate(episode.addedAt)}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      <div className={styles.libraryHeader}>
        <h2>All TV shows</h2>
      </div>
      <div className={styles.searchRow}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search TV shows…"
          aria-label="Search TV shows"
        />
      </div>

      {configError && <div className={styles.alert}>{configError}</div>}
      {error && <div className={styles.alert}>{error}</div>}

      {!configError && (
        <p className={styles.meta}>
          {loading
            ? "Loading Jellyfin series…"
            : `${total.toLocaleString()} show${total === 1 ? "" : "s"}${debouncedQuery ? ` matching “${debouncedQuery}”` : ""}`}
        </p>
      )}

      <div className={styles.grid}>
        {loading && series.length === 0 ? (
          <p className={styles.loading}>Loading…</p>
        ) : series.length === 0 ? (
          <p className={styles.empty}>No series found.</p>
        ) : (
          series.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.card} ${selectedId === item.id ? styles.cardSelected : ""}`}
              onClick={() => onSelect(item)}
            >
              <SeriesPoster series={item} />
              <div className={styles.cardBody}>
                <span className={styles.title}>
                  {item.title}
                  {item.year ? ` (${item.year})` : ""}
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
