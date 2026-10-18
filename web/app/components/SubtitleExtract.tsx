"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { SidecarSubtitle, SubtitleTrack } from "@/lib/ffmpeg";
import type { MovieEntry } from "@/lib/movies-library";
import type { Event } from "@/lib/paths";
import { EVENT_LABELS } from "@/lib/paths";
import { MoviePicker } from "./MoviePicker";
import { Toast } from "./Toast";
import styles from "./SubtitleExtract.module.css";

type ProbeResponse = {
  tempId: string;
  originalName: string;
  tracks: SubtitleTrack[];
  sidecars: SidecarSubtitle[];
  source: "upload" | "library";
};

type ToastState = {
  message: string;
  type: "success" | "error";
} | null;

export function SubtitleExtract() {
  const searchParams = useSearchParams();
  const [probe, setProbe] = useState<ProbeResponse | null>(null);
  const [selectedMovie, setSelectedMovie] = useState<MovieEntry | null>(null);
  const [probing, setProbing] = useState(false);
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const [dragDepth, setDragDepth] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const probeLibraryMovie = useCallback(async (movieId: string) => {
    setProbing(true);
    setError(null);
    setPreview(null);

    try {
      const response = await fetch("/api/subtitles/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "probe_library",
          movieId,
        }),
      });

      const data = (await response.json()) as ProbeResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to probe video");
      }

      setProbe({
        ...data,
        sidecars: data.sidecars ?? [],
      });
      if (data.tracks.length === 0 && (data.sidecars?.length ?? 0) === 0) {
        setError("No embedded or sidecar subtitle tracks found for this video.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to probe video");
      setProbe(null);
    } finally {
      setProbing(false);
    }
  }, []);

  useEffect(() => {
    const movieId = searchParams.get("movie");
    if (!movieId) return;

    fetch(`/api/movies/${encodeURIComponent(movieId)}`)
      .then((res) => res.json())
      .then((data: MovieEntry & { error?: string }) => {
        if (data.id) {
          setSelectedMovie(data);
          void probeLibraryMovie(data.id);
        }
      })
      .catch(() => {});
  }, [searchParams, probeLibraryMovie]);

  const probeVideo = async (file: File) => {
    setProbing(true);
    setError(null);
    setPreview(null);
    setSelectedMovie(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/subtitles/extract", {
        method: "POST",
        body: formData,
      });

      const data = (await response.json()) as ProbeResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to probe video");
      }

      setProbe({
        ...data,
        sidecars: data.sidecars ?? [],
      });
      if (data.tracks.length === 0 && (data.sidecars?.length ?? 0) === 0) {
        setError("No embedded or sidecar subtitle tracks found for this video.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to probe video");
      setProbe(null);
    } finally {
      setProbing(false);
    }
  };

  const handleSelectMovie = (movie: MovieEntry) => {
    setSelectedMovie(movie);
    void probeLibraryMovie(movie.id);
  };

  const applyTrack = async (streamIndex: number, event: Event) => {
    if (!probe) return;

    const key = `${streamIndex}-${event}`;
    setApplyingKey(key);

    try {
      const response = await fetch("/api/subtitles/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tempId: probe.tempId,
          streamIndex,
          event,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        message?: string;
        preview?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Extraction failed");
      }

      if (data.preview) setPreview(data.preview);
      showToast(
        data.message ?? `Applied to ${EVENT_LABELS[event]}`,
        "success",
      );
      setProbe(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Extraction failed", "error");
    } finally {
      setApplyingKey(null);
    }
  };

  const applySidecar = async (sidecarId: string, event: Event) => {
    if (!probe) return;

    const key = `sidecar-${sidecarId}-${event}`;
    setApplyingKey(key);

    try {
      const response = await fetch("/api/subtitles/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tempId: probe.tempId,
          sidecarId,
          event,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        message?: string;
        preview?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to apply sidecar subtitle");
      }

      if (data.preview) setPreview(data.preview);
      showToast(
        data.message ?? `Applied to ${EVENT_LABELS[event]}`,
        "success",
      );
      setProbe(null);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to apply sidecar subtitle",
        "error",
      );
    } finally {
      setApplyingKey(null);
    }
  };

  const isDragOver = dragDepth > 0;

  return (
    <main className={styles.page}>
      <Link href="/subtitles" className={styles.backLink}>
        ← Back to Subtitles
      </Link>

      <header className={styles.header}>
        <h1>Extract Subtitles</h1>
        <p>
          Pick from your movie library, or upload a video file. Embedded tracks
          and sidecar files (like <code>.eng.srt</code> next to the movie) can be
          applied to Main or HSPC.
        </p>
      </header>

      <section className={styles.panel}>
        <h3 className={styles.sectionTitle}>Movie library</h3>
        <MoviePicker
          onSelect={handleSelectMovie}
          selectedId={selectedMovie?.id}
        />
        {probing && selectedMovie && (
          <p className={styles.probing}>Probing {selectedMovie.title}…</p>
        )}
        {error && <p className={styles.error}>{error}</p>}
      </section>

      {probe &&
        (probe.tracks.length > 0 || (probe.sidecars?.length ?? 0) > 0) && (
        <section className={styles.panel}>
          <p className={styles.fileName}>{probe.originalName}</p>

          {probe.tracks.length > 0 && (
            <>
              <h3 className={styles.sectionTitle}>Embedded tracks</h3>
              <div className={styles.trackList}>
                {probe.tracks.map((track) => (
                  <div key={track.streamIndex} className={styles.trackCard}>
                    <h4>{track.label}</h4>
                    <div className={styles.trackActions}>
                      <button
                        type="button"
                        className={styles.button}
                        disabled={applyingKey !== null}
                        onClick={() => void applyTrack(track.streamIndex, "main")}
                      >
                        {applyingKey === `${track.streamIndex}-main`
                          ? "Applying…"
                          : `Apply to ${EVENT_LABELS.main}`}
                      </button>
                      <button
                        type="button"
                        className={`${styles.button} ${styles.buttonSecondary}`}
                        disabled={applyingKey !== null}
                        onClick={() => void applyTrack(track.streamIndex, "hspc")}
                      >
                        {applyingKey === `${track.streamIndex}-hspc`
                          ? "Applying…"
                          : `Apply to ${EVENT_LABELS.hspc}`}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {(probe.sidecars?.length ?? 0) > 0 && (
            <>
              <h3 className={styles.sectionTitle}>Sidecar files</h3>
              <div className={styles.trackList}>
                {probe.sidecars.map((sidecar) => (
                  <div key={sidecar.id} className={styles.trackCard}>
                    <h4>{sidecar.label}</h4>
                    <div className={styles.trackActions}>
                      <button
                        type="button"
                        className={styles.button}
                        disabled={applyingKey !== null}
                        onClick={() => void applySidecar(sidecar.id, "main")}
                      >
                        {applyingKey === `sidecar-${sidecar.id}-main`
                          ? "Applying…"
                          : `Apply to ${EVENT_LABELS.main}`}
                      </button>
                      <button
                        type="button"
                        className={`${styles.button} ${styles.buttonSecondary}`}
                        disabled={applyingKey !== null}
                        onClick={() => void applySidecar(sidecar.id, "hspc")}
                      >
                        {applyingKey === `sidecar-${sidecar.id}-hspc`
                          ? "Applying…"
                          : `Apply to ${EVENT_LABELS.hspc}`}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {preview && (
        <section className={styles.panel}>
          <h3>Preview (first cues)</h3>
          <pre className={styles.preview}>{preview}</pre>
        </section>
      )}

      <section className={styles.panel}>
        <h3 className={styles.sectionTitle}>Upload video</h3>
        <div
          className={`${styles.dropZone} ${isDragOver ? styles.dropZoneActive : ""}`}
          onDragEnter={(e) => {
            e.preventDefault();
            if (e.dataTransfer.types.includes("Files")) {
              setDragDepth((d) => d + 1);
            }
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragDepth((d) => Math.max(0, d - 1));
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragDepth(0);
            const file = e.dataTransfer.files[0];
            if (file) void probeVideo(file);
          }}
        >
          <p>Drag and drop a video file here</p>
          <label className={styles.uploadLabel}>
            <span>{probing ? "Probing…" : "Choose video file"}</span>
            <input
              type="file"
              accept="video/*,.mkv,.mp4,.avi,.mov,.webm,.m4v"
              disabled={probing}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void probeVideo(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </section>

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
