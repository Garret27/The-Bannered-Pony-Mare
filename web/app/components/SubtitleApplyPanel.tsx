"use client";

import { useCallback, useEffect, useState } from "react";
import type { SidecarSubtitle, SubtitleTrack } from "@/lib/ffmpeg";
import type { Event } from "@/lib/paths";
import { EVENT_LABELS } from "@/lib/paths";
import { OcrProgress, pollOcrJob, type OcrJobView } from "./OcrProgress";
import styles from "./SubtitleApplyPanel.module.css";

export type SubtitleProbeResult = {
  tempId: string;
  originalName: string;
  tracks: SubtitleTrack[];
  sidecars: SidecarSubtitle[];
};

type SubtitleApplyPanelProps = {
  /** Probe a Jellyfin library movie by id. */
  movieId?: string | null;
  /** Probe a video path already visible to the web container. */
  videoPath?: string | null;
  /** Compact layout for history rows / convert panel. */
  compact?: boolean;
  onApplied?: (message: string) => void;
  onError?: (message: string) => void;
};

async function probeSubtitles(input: {
  movieId?: string;
  videoPath?: string;
}): Promise<SubtitleProbeResult> {
  const body = input.movieId
    ? { action: "probe_library", movieId: input.movieId }
    : { action: "probe_path", videoPath: input.videoPath };

  const response = await fetch("/api/subtitles/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as SubtitleProbeResult & {
    error?: string;
    sidecars?: SidecarSubtitle[];
  };

  if (!response.ok) {
    throw new Error(data.error ?? "Failed to probe subtitles");
  }

  return {
    tempId: data.tempId,
    originalName: data.originalName,
    tracks: data.tracks ?? [],
    sidecars: data.sidecars ?? [],
  };
}

export function SubtitleApplyPanel({
  movieId,
  videoPath,
  compact = false,
  onApplied,
  onError,
}: SubtitleApplyPanelProps) {
  const [probe, setProbe] = useState<SubtitleProbeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const [tracksExpanded, setTracksExpanded] = useState(false);
  const [ocrJob, setOcrJob] = useState<OcrJobView | null>(null);

  const applyLabel = (
    kind: "text" | "bitmap" | undefined,
    event: Event,
    busy: boolean,
  ) => {
    if (busy) return kind === "bitmap" ? "Reading…" : "Applying…";
    if (kind === "bitmap") return `Read images for ${EVENT_LABELS[event]}`;
    return `Apply to ${EVENT_LABELS[event]}`;
  };

  const reload = useCallback(async () => {
    if (!movieId && !videoPath) return;
    setLoading(true);
    setError(null);
    try {
      const result = await probeSubtitles({
        movieId: movieId ?? undefined,
        videoPath: videoPath ?? undefined,
      });
      setProbe(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to probe subtitles";
      setError(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  }, [movieId, videoPath, onError]);

  useEffect(() => {
    setTracksExpanded(false);
  }, [movieId, videoPath]);

  useEffect(() => {
    if (!movieId && !videoPath) {
      setProbe(null);
      setError(null);
      return;
    }

    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      setProbe(null);

      try {
        const result = await probeSubtitles({
          movieId: movieId ?? undefined,
          videoPath: videoPath ?? undefined,
        });
        if (cancelled) return;
        setProbe(result);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Failed to probe subtitles";
        setError(message);
        onError?.(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
    // Only re-probe when the source changes; parent callbacks are intentionally ignored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movieId, videoPath]);

  const apply = async (payload: {
    streamIndex?: number;
    sidecarId?: string;
    event: Event;
  }) => {
    if (!probe) return;

    const key = payload.sidecarId
      ? `sidecar-${payload.sidecarId}-${payload.event}`
      : `${payload.streamIndex}-${payload.event}`;
    setApplyingKey(key);

    try {
      const response = await fetch("/api/subtitles/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tempId: probe.tempId,
          streamIndex: payload.streamIndex,
          sidecarId: payload.sidecarId,
          event: payload.event,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        message?: string;
        jobId?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to apply subtitle");
      }

      if (data.jobId) {
        const job = await pollOcrJob(data.jobId, setOcrJob);
        if (job.status === "error") {
          throw new Error(job.error || job.message || "OCR failed");
        }
        onApplied?.(job.appliedMessage ?? job.message);
        setOcrJob(null);
        await reload();
        return;
      }

      const message =
        data.message ?? `Applied to ${EVENT_LABELS[payload.event]}`;
      onApplied?.(message);
      await reload();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to apply subtitle";
      setError(message);
      onError?.(message);
    } finally {
      setApplyingKey(null);
    }
  };

  if (!movieId && !videoPath) return null;

  if (loading) {
    return (
      <div className={compact ? styles.compact : styles.panel}>
        <p className={styles.hint}>Checking subtitles…</p>
      </div>
    );
  }

  if (error && !probe) {
    return (
      <div className={compact ? styles.compact : styles.panel}>
        <p className={styles.error}>{error}</p>
      </div>
    );
  }

  if (!probe) return null;

  const hasTracks = probe.tracks.length > 0;
  const hasSidecars = probe.sidecars.length > 0;
  const tracksCollapsible = compact && probe.tracks.length > 4;
  const visibleTracks =
    tracksCollapsible && !tracksExpanded
      ? probe.tracks.slice(0, 4)
      : probe.tracks;

  if (!hasTracks && !hasSidecars) {
    return (
      <div className={compact ? styles.compact : styles.panel}>
        <p className={styles.hint}>No embedded or sidecar subtitles found.</p>
      </div>
    );
  }

  return (
    <div className={compact ? styles.compact : styles.panel}>
      {!compact && <p className={styles.fileName}>{probe.originalName}</p>}

      <div className={styles.summary}>
        <span>
          Embedded: {probe.tracks.length}
          {hasSidecars ? ` · Sidecar: ${probe.sidecars.length}` : ""}
        </span>
      </div>

      {error && <p className={styles.error}>{error}</p>}
      {ocrJob && <OcrProgress job={ocrJob} />}

      {hasTracks && (
        <div className={styles.group}>
          <h4 className={styles.groupTitle}>Embedded tracks</h4>
          {visibleTracks.map((track) => (
            <div key={track.streamIndex} className={styles.trackRow}>
              <span className={styles.trackLabel}>
                {track.label}
                {track.kind === "bitmap" ? " · image, a few minutes" : ""}
              </span>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.button}
                  disabled={applyingKey !== null}
                  onClick={() =>
                    void apply({ streamIndex: track.streamIndex, event: "main" })
                  }
                >
                  {applyLabel(
                    track.kind,
                    "main",
                    applyingKey === `${track.streamIndex}-main`,
                  )}
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  disabled={applyingKey !== null}
                  onClick={() =>
                    void apply({ streamIndex: track.streamIndex, event: "hspc" })
                  }
                >
                  {applyLabel(
                    track.kind,
                    "hspc",
                    applyingKey === `${track.streamIndex}-hspc`,
                  )}
                </button>
              </div>
            </div>
          ))}
          {tracksCollapsible && (
            <button
              type="button"
              className={styles.trackToggle}
              aria-expanded={tracksExpanded}
              onClick={() => setTracksExpanded((expanded) => !expanded)}
            >
              <span>
                {tracksExpanded
                  ? "Collapse embedded tracks"
                  : `Expand ${probe.tracks.length - 4} more embedded track${
                      probe.tracks.length - 4 === 1 ? "" : "s"
                    }`}
              </span>
              <span aria-hidden="true">{tracksExpanded ? "▴" : "▾"}</span>
            </button>
          )}
        </div>
      )}

      {hasSidecars && (
        <div className={styles.group}>
          <h4 className={styles.groupTitle}>Sidecar files</h4>
          {probe.sidecars.map((sidecar) => (
            <div key={sidecar.id} className={styles.trackRow}>
              <span className={styles.trackLabel}>
                {sidecar.label}
                {sidecar.kind === "bitmap" ? " · image, a few minutes" : ""}
              </span>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.button}
                  disabled={applyingKey !== null}
                  onClick={() =>
                    void apply({ sidecarId: sidecar.id, event: "main" })
                  }
                >
                  {applyLabel(
                    sidecar.kind,
                    "main",
                    applyingKey === `sidecar-${sidecar.id}-main`,
                  )}
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  disabled={applyingKey !== null}
                  onClick={() =>
                    void apply({ sidecarId: sidecar.id, event: "hspc" })
                  }
                >
                  {applyLabel(
                    sidecar.kind,
                    "hspc",
                    applyingKey === `sidecar-${sidecar.id}-hspc`,
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
