"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import type {
  OpenSubtitlesFeature,
  OpenSubtitlesSearchResult,
} from "@/lib/opensubtitles";
import type { Event } from "@/lib/paths";
import { EVENT_LABELS } from "@/lib/paths";
import { Toast } from "./Toast";
import styles from "./SubtitleSearch.module.css";

type ToastState = {
  message: string;
  type: "success" | "error";
} | null;

export function SubtitleSearch() {
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("");
  const [features, setFeatures] = useState<OpenSubtitlesFeature[]>([]);
  const [selectedFeature, setSelectedFeature] =
    useState<OpenSubtitlesFeature | null>(null);
  const [results, setResults] = useState<OpenSubtitlesSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingSubtitles, setLoadingSubtitles] = useState(false);
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    setSearching(true);
    setSearchError(null);
    setPreview(null);
    setResults([]);
    setSelectedFeature(null);
    setFeatures([]);

    try {
      const response = await fetch("/api/opensubtitles/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: trimmed,
          year: year ? parseInt(year, 10) : undefined,
        }),
      });

      const data = (await response.json()) as {
        features?: OpenSubtitlesFeature[];
        error?: string;
      };

      if (response.status === 503) {
        setConfigError(data.error ?? "OpenSubtitles is not configured");
        return;
      }

      if (!response.ok) {
        throw new Error(data.error ?? "Search failed");
      }

      setFeatures(data.features ?? []);
      if ((data.features ?? []).length === 0) {
        setSearchError("No movies found for this search.");
      }
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const handleSelectFeature = async (feature: OpenSubtitlesFeature) => {
    setSelectedFeature(feature);
    setResults([]);
    setPreview(null);
    setSearchError(null);
    setLoadingSubtitles(true);

    try {
      const response = await fetch("/api/opensubtitles/subtitles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          featureId: feature.id,
          languages: "en",
        }),
      });

      const data = (await response.json()) as {
        results?: OpenSubtitlesSearchResult[];
        error?: string;
      };

      if (response.status === 503) {
        setConfigError(data.error ?? "OpenSubtitles is not configured");
        return;
      }

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load subtitles");
      }

      setResults(data.results ?? []);
      if ((data.results ?? []).length === 0) {
        setSearchError("No English subtitles found for this movie.");
      }
    } catch (error) {
      setSearchError(
        error instanceof Error ? error.message : "Failed to load subtitles",
      );
    } finally {
      setLoadingSubtitles(false);
    }
  };

  const handleBackToMovies = () => {
    setSelectedFeature(null);
    setResults([]);
    setPreview(null);
    setSearchError(null);
  };

  const handlePreview = async (fileId: number) => {
    setApplyingKey(`preview-${fileId}`);
    setPreview(null);

    try {
      const response = await fetch("/api/opensubtitles/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, previewOnly: true }),
      });

      const data = (await response.json()) as {
        preview?: string;
        error?: string;
        cueCount?: number;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Preview failed");
      }

      setPreview(data.preview ?? null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Preview failed", "error");
    } finally {
      setApplyingKey(null);
    }
  };

  const handleApply = async (fileId: number, event: Event) => {
    const key = `${fileId}-${event}`;
    setApplyingKey(key);

    try {
      const response = await fetch("/api/opensubtitles/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, event }),
      });

      const data = (await response.json()) as {
        error?: string;
        message?: string;
        preview?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Download failed");
      }

      if (data.preview) setPreview(data.preview);
      showToast(data.message ?? `Applied to ${EVENT_LABELS[event]}`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Download failed", "error");
    } finally {
      setApplyingKey(null);
    }
  };

  const showingSubtitles = selectedFeature !== null;

  return (
    <main className={styles.page}>
      <Link href="/subtitles" className={styles.backLink}>
        ← Back to Subtitles
      </Link>

      <header className={styles.header}>
        <h1>Search OpenSubtitles</h1>
        <p>
          Search for a movie, pick the correct title, then choose an English
          subtitle release to apply to Main or HSPC.
        </p>
      </header>

      {configError && (
        <div className={styles.alert}>
          {configError}. Add OpenSubtitles credentials in Settings. Downloads
          also require username and password.
        </div>
      )}

      {!showingSubtitles && (
        <form onSubmit={(e) => void handleSearch(e)} className={styles.searchForm}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Movie title"
            required
            minLength={2}
          />
          <input
            type="number"
            className={styles.yearInput}
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="Year"
            min={1900}
            max={2100}
          />
          <button type="submit" className={styles.button} disabled={searching}>
            {searching ? "Searching…" : "Search"}
          </button>
        </form>
      )}

      {showingSubtitles && selectedFeature && (
        <div className={styles.selectedMovie}>
          <button
            type="button"
            className={styles.backToMovies}
            onClick={handleBackToMovies}
          >
            ← Back to movies
          </button>
          <h2>
            {selectedFeature.title}
            {selectedFeature.year ? ` (${selectedFeature.year})` : ""}
          </h2>
          <p className={styles.resultMeta}>
            English subtitle releases
            {selectedFeature.imdbId ? ` · IMDb tt${selectedFeature.imdbId}` : ""}
          </p>
        </div>
      )}

      {searchError && <p className={styles.error}>{searchError}</p>}

      {!showingSubtitles && features.length > 0 && (
        <div className={styles.results}>
          {features.map((feature) => (
            <button
              key={feature.id}
              type="button"
              className={styles.featureCard}
              onClick={() => void handleSelectFeature(feature)}
            >
              <h3>
                {feature.title}
                {feature.year ? ` (${feature.year})` : ""}
              </h3>
              <p className={styles.resultMeta}>
                {feature.type}
                {feature.imdbId ? ` · IMDb tt${feature.imdbId}` : ""}
              </p>
              <span className={styles.featureAction}>View subtitles →</span>
            </button>
          ))}
        </div>
      )}

      {showingSubtitles && loadingSubtitles && (
        <p className={styles.hint}>Loading subtitles…</p>
      )}

      {showingSubtitles && !loadingSubtitles && results.length > 0 && (
        <div className={styles.results}>
          {results.map((result) => (
            <article key={`${result.id}-${result.fileId}`} className={styles.resultCard}>
              <h3>{result.release}</h3>
              <p className={styles.resultMeta}>
                {result.language.toUpperCase()}
                <br />
                {result.downloadCount.toLocaleString()} downloads
                {result.hearingImpaired ? " · SDH" : ""}
                {result.fromTrusted ? " · Trusted" : ""}
                {result.uploader ? ` · ${result.uploader}` : ""}
              </p>
              <div className={styles.resultActions}>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  disabled={applyingKey !== null}
                  onClick={() => void handlePreview(result.fileId)}
                >
                  {applyingKey === `preview-${result.fileId}` ? "Loading…" : "Preview"}
                </button>
                <button
                  type="button"
                  className={styles.button}
                  disabled={applyingKey !== null}
                  onClick={() => void handleApply(result.fileId, "main")}
                >
                  {applyingKey === `${result.fileId}-main`
                    ? "Applying…"
                    : `Apply to ${EVENT_LABELS.main}`}
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  disabled={applyingKey !== null}
                  onClick={() => void handleApply(result.fileId, "hspc")}
                >
                  {applyingKey === `${result.fileId}-hspc`
                    ? "Applying…"
                    : `Apply to ${EVENT_LABELS.hspc}`}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {!searching &&
        !showingSubtitles &&
        features.length === 0 &&
        !searchError &&
        !configError && (
          <p className={styles.hint}>Search for a movie to find subtitles.</p>
        )}

      {preview && (
        <section className={styles.preview}>
          <pre>{preview}</pre>
        </section>
      )}

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
