"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  findActiveCueIndex,
  formatMsToTimestamp,
  type SrtCue,
} from "@/lib/srt";
import type { RedirectsConfig } from "@/lib/redirects";
import type { MovieEntry } from "@/lib/movies-library";
import type { Event } from "@/lib/paths";
import { EVENT_LABELS } from "@/lib/paths";
import { formatBytes } from "@/lib/format";
import { MoviePicker } from "./MoviePicker";
import { Toast } from "./Toast";
import styles from "./SubtitlePreview.module.css";

type SubtitlePreviewProps = {
  event: Event;
};

type ToastState = {
  message: string;
  type: "success" | "error";
} | null;

type SourceType = "cdn" | "local";

const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mkv", ".m4v", ".mov"];

function looksLikeVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const lower = parsed.pathname.toLowerCase();
    return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
  } catch {
    return false;
  }
}

export function SubtitlePreview({ event }: SubtitlePreviewProps) {
  const searchParams = useSearchParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cues, setCues] = useState<SrtCue[]>([]);
  const [redirects, setRedirects] = useState<RedirectsConfig | null>(null);
  const [savedUrl, setSavedUrl] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [cdnVideoUrl, setCdnVideoUrl] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("cdn");
  const [localMovie, setLocalMovie] = useState<MovieEntry | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [previewOffsetMs, setPreviewOffsetMs] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const loadData = useCallback(async () => {
    const [statusRes, subtitleRes] = await Promise.all([
      fetch("/api/status"),
      fetch(`/api/subtitles/${event}`),
    ]);

    if (!statusRes.ok) {
      throw new Error("Failed to load redirect configuration");
    }
    if (!subtitleRes.ok) {
      throw new Error("Subtitle file not found");
    }

    const status = (await statusRes.json()) as { redirects: RedirectsConfig };
    const subtitle = (await subtitleRes.json()) as { cues: SrtCue[] };

    const redirect = status.redirects[event];
    setRedirects(status.redirects);
    setSavedUrl(redirect.url);
    setUrlInput(redirect.url);
    setCdnVideoUrl(redirect.url);
    setCues(subtitle.cues);
  }, [event]);

  useEffect(() => {
    loadData()
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load preview data"),
      )
      .finally(() => setLoading(false));
  }, [loadData]);

  useEffect(() => {
    const movieId = searchParams.get("movie");
    if (!movieId) return;

    fetch(`/api/movies/${encodeURIComponent(movieId)}`)
      .then((res) => res.json())
      .then((data: MovieEntry & { error?: string }) => {
        if (data.id) {
          setLocalMovie(data);
          setSourceType("local");
        }
      })
      .catch(() => {});
  }, [searchParams]);

  const activeVideoSrc =
    sourceType === "local" && localMovie
      ? `/api/movies/stream/${localMovie.id}`
      : cdnVideoUrl;

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.playbackRate = playbackRate;
    }
  }, [playbackRate, activeVideoSrc]);

  const effectiveTimeMs = currentTimeMs + previewOffsetMs;
  const activeIndex = findActiveCueIndex(cues, effectiveTimeMs);
  const activeCue = activeIndex >= 0 ? cues[activeIndex] : null;

  const jumpToCue = (index: number) => {
    const cue = cues[index];
    if (!cue || !videoRef.current) return;
    const targetSec = (cue.startMs - previewOffsetMs) / 1000;
    videoRef.current.currentTime = Math.max(0, targetSec);
  };

  const stepCue = (direction: -1 | 1) => {
    const nextIndex =
      activeIndex < 0
        ? direction === 1
          ? 0
          : cues.length - 1
        : activeIndex + direction;
    if (nextIndex >= 0 && nextIndex < cues.length) {
      jumpToCue(nextIndex);
    }
  };

  const handleLoadCdnUrl = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) {
      showToast("Enter a video URL", "error");
      return;
    }
    try {
      new URL(trimmed);
    } catch {
      showToast("Enter a valid URL", "error");
      return;
    }
    setSourceType("cdn");
    setLocalMovie(null);
    setCdnVideoUrl(trimmed);
  };

  const handleSelectLocalMovie = (movie: MovieEntry) => {
    setLocalMovie(movie);
    setSourceType("local");
  };

  const handleSaveUrl = async () => {
    if (!redirects) return;

    const trimmed = urlInput.trim();
    if (!trimmed) {
      showToast("Enter a video URL", "error");
      return;
    }

    try {
      new URL(trimmed);
    } catch {
      showToast("Enter a valid URL", "error");
      return;
    }

    setSaving(true);
    try {
      const updated: RedirectsConfig = {
        ...redirects,
        [event]: {
          ...redirects[event],
          url: trimmed,
          status: 200,
        },
      };

      const response = await fetch("/api/redirects", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });

      const data = (await response.json()) as {
        error?: string;
        message?: string;
        redirects?: RedirectsConfig;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to save video URL");
      }

      if (data.redirects) {
        setRedirects(data.redirects);
        setSavedUrl(data.redirects[event].url);
      } else {
        setSavedUrl(trimmed);
      }

      setCdnVideoUrl(trimmed);
      showToast(
        data.message ?? `Saved video URL for /${event}`,
        "success",
      );
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to save video URL",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className={styles.page}>
        <p className={styles.loading}>Loading preview…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className={styles.page}>
        <Link href="/subtitles" className={styles.backLink}>
          ← Back to Subtitles
        </Link>
        <div className={styles.alert}>{error}</div>
      </main>
    );
  }

  const videoOk =
    sourceType === "local"
      ? !!localMovie
      : !!(cdnVideoUrl && looksLikeVideoUrl(cdnVideoUrl));
  const hasUnsavedUrl = urlInput.trim() !== savedUrl.trim();

  return (
    <main className={styles.page}>
      <Link href="/subtitles" className={styles.backLink}>
        ← Back to Subtitles
      </Link>

      <header className={styles.header}>
        <h1>Preview — {EVENT_LABELS[event]}</h1>
        <p>
          Preview subtitles with a <strong>local SMB movie</strong> or a{" "}
          <strong>CDN redirect URL</strong> for deploy.
        </p>
      </header>

      <section className={styles.sourcePanel}>
        <h3>Local movie (SMB)</h3>
        <p className={styles.sourceHint}>
          Pick from your merged E + J movie library on the Fedora server.
        </p>
        <MoviePicker
          onSelect={handleSelectLocalMovie}
          selectedId={localMovie?.id}
        />
        {localMovie && sourceType === "local" && (
          <p className={styles.localActive}>
            Playing: {localMovie.title} ({localMovie.format.toUpperCase()} ·{" "}
            {formatBytes(localMovie.sizeBytes)})
          </p>
        )}
      </section>

      <section className={styles.sourcePanel}>
        <h3>CDN redirect URL</h3>
        <p className={styles.sourceHint}>
          Direct MP4/WebM link from <code>_redirects</code> (Bunny CDN). Saving
          updates <code>/{event}</code> for deploy.
        </p>
        <div className={styles.sourceForm}>
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://example.cdn.net/Movies/Movie.mp4"
          />
          <div className={styles.sourceActions}>
            <button
              type="button"
              className={styles.button}
              onClick={handleLoadCdnUrl}
            >
              Load CDN preview
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonSecondary}`}
              onClick={() => void handleSaveUrl()}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save video URL"}
            </button>
          </div>
          {hasUnsavedUrl && (
            <p className={styles.unsavedHint}>
              URL differs from saved <code>/{event}</code> redirect — click Save
              to persist for future previews and deploy.
            </p>
          )}
        </div>
      </section>

      {!videoOk && (
        <div className={styles.alert}>
          Select a local movie or enter a CDN URL and click{" "}
          <strong>Load CDN preview</strong>.
        </div>
      )}

      {videoOk && (
        <div className={styles.playerWrap}>
          <video
            key={activeVideoSrc}
            ref={videoRef}
            className={styles.video}
            src={activeVideoSrc}
            controls
            onTimeUpdate={(e) => {
              setCurrentTimeMs(e.currentTarget.currentTime * 1000);
            }}
          />
          {activeCue && (
            <div className={styles.overlay}>
              <span className={styles.overlayText}>{activeCue.text}</span>
            </div>
          )}
        </div>
      )}

      <div className={styles.controls}>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonSecondary}`}
          onClick={() => stepCue(-1)}
          disabled={cues.length === 0}
        >
          Prev cue
        </button>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonSecondary}`}
          onClick={() => stepCue(1)}
          disabled={cues.length === 0}
        >
          Next cue
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => activeIndex >= 0 && jumpToCue(activeIndex)}
          disabled={activeIndex < 0}
        >
          Jump to active
        </button>

        <label className={styles.sliderGroup}>
          Rate
          <select
            value={playbackRate}
            onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
          >
            <option value={0.5}>0.5×</option>
            <option value={0.75}>0.75×</option>
            <option value={1}>1×</option>
            <option value={1.25}>1.25×</option>
            <option value={1.5}>1.5×</option>
            <option value={2}>2×</option>
          </select>
        </label>

        <label className={styles.sliderGroup}>
          Offset {previewOffsetMs >= 0 ? "+" : ""}
          {(previewOffsetMs / 1000).toFixed(1)}s
          <input
            type="range"
            min={-10000}
            max={10000}
            step={100}
            value={previewOffsetMs}
            onChange={(e) => setPreviewOffsetMs(parseInt(e.target.value, 10))}
          />
        </label>
      </div>

      <div className={styles.cuePanel}>
        <h3>Active cue</h3>
        {activeCue ? (
          <>
            <p className={styles.activeCue}>
              #{activeCue.index} · {formatMsToTimestamp(activeCue.startMs)} →{" "}
              {formatMsToTimestamp(activeCue.endMs)} · video{" "}
              {formatMsToTimestamp(currentTimeMs)}
            </p>
            <p className={styles.cueText}>{activeCue.text}</p>
          </>
        ) : (
          <p className={styles.activeCue}>No cue at current position</p>
        )}
      </div>

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
