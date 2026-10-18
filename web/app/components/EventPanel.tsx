"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FileInfo } from "@/lib/format";
import { formatBytes, formatDate } from "@/lib/format";
import type { Event } from "@/lib/paths";
import { EVENT_LABELS } from "@/lib/paths";
import styles from "./EventPanel.module.css";

type EventPanelProps = {
  event: Event;
  poster: FileInfo;
  subtitle: FileInfo;
  posterCacheKey: string;
  movieTitle: string;
  onMovieTitleSave: (event: Event, movieTitle: string) => Promise<void>;
  onPosterUpload: (event: Event, file: File) => Promise<void>;
  onSubtitleUpload: (event: Event, file: File) => Promise<void>;
  onUploadError?: (message: string) => void;
  uploadingPoster: boolean;
  uploadingSubtitle: boolean;
  savingMovieTitle: boolean;
};

const POSTER_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

function isPosterFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext ? POSTER_EXTENSIONS.has(ext) : false;
}

function isSrtFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".srt");
}

function useDropZone(
  onDropFile: (file: File) => void,
  disabled: boolean,
) {
  const [dragDepth, setDragDepth] = useState(0);
  const isDragOver = dragDepth > 0;

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      if (!e.dataTransfer.types.includes("Files")) return;
      setDragDepth((depth) => depth + 1);
    },
    [disabled],
  );

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragDepth((depth) => Math.max(0, depth - 1));
  }, []);

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      e.dataTransfer.dropEffect = "copy";
    },
    [disabled],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragDepth(0);
      if (disabled) return;

      const file = e.dataTransfer.files[0];
      if (file) onDropFile(file);
    },
    [disabled, onDropFile],
  );

  return {
    isDragOver,
    dropZoneProps: {
      onDragEnter,
      onDragLeave,
      onDragOver,
      onDrop,
    },
  };
}

export function EventPanel({
  event,
  poster,
  subtitle,
  posterCacheKey,
  movieTitle,
  onMovieTitleSave,
  onPosterUpload,
  onSubtitleUpload,
  onUploadError,
  uploadingPoster,
  uploadingSubtitle,
  savingMovieTitle,
}: EventPanelProps) {
  const accentClass = event === "main" ? styles.main : styles.hspc;
  const [titleDraft, setTitleDraft] = useState(movieTitle);

  useEffect(() => {
    setTitleDraft(movieTitle);
  }, [movieTitle]);

  const handlePosterDrop = useCallback(
    (file: File) => {
      if (!isPosterFile(file)) {
        onUploadError?.("Drop an image file (JPG, PNG, WebP, or GIF).");
        return;
      }
      void onPosterUpload(event, file);
    },
    [event, onPosterUpload, onUploadError],
  );

  const handleSubtitleDrop = useCallback(
    (file: File) => {
      if (!isSrtFile(file)) {
        onUploadError?.("Drop a .srt subtitle file.");
        return;
      }
      void onSubtitleUpload(event, file);
    },
    [event, onSubtitleUpload, onUploadError],
  );

  const posterDrop = useDropZone(handlePosterDrop, uploadingPoster);
  const subtitleDrop = useDropZone(handleSubtitleDrop, uploadingSubtitle);

  return (
    <section className={`${styles.panel} ${accentClass}`}>
      <header className={styles.header}>
        <h2>{EVENT_LABELS[event]}</h2>
        <span className={styles.badge}>{event.toUpperCase()}</span>
      </header>

      <div className={styles.movieTitleEditor}>
        <label htmlFor={`${event}-movie-title`}>Movie title</label>
        <div className={styles.movieTitleRow}>
          <input
            id={`${event}-movie-title`}
            type="text"
            value={titleDraft}
            maxLength={200}
            placeholder="Enter the movie title"
            disabled={savingMovieTitle}
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && titleDraft.trim() !== movieTitle) {
                void onMovieTitleSave(event, titleDraft);
              }
            }}
          />
          <button
            type="button"
            disabled={
              savingMovieTitle || titleDraft.trim() === movieTitle
            }
            onClick={() => void onMovieTitleSave(event, titleDraft)}
          >
            {savingMovieTitle ? "Saving…" : "Save"}
          </button>
        </div>
        <p>Used as the bold movie title in announcements.</p>
      </div>

      <div className={styles.section}>
        <h3>Poster</h3>
        <p className={styles.filename}>{poster.filename}</p>
        <div
          className={`${styles.dropZone} ${styles.posterPreview} ${posterDrop.isDragOver ? styles.dropZoneActive : ""}`}
          {...posterDrop.dropZoneProps}
        >
          {poster.exists ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/posters/${event}?v=${posterCacheKey}`}
              alt={`${EVENT_LABELS[event]} poster`}
            />
          ) : (
            <div className={styles.placeholder}>No poster yet</div>
          )}
          {posterDrop.isDragOver && (
            <div className={styles.dropOverlay}>Drop poster to replace</div>
          )}
        </div>
        <label className={styles.uploadLabel}>
          <span>
            {uploadingPoster ? "Processing…" : "Upload or drop poster"}
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
            disabled={uploadingPoster}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onPosterUpload(event, file);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      <div className={styles.section}>
        <h3>Subtitles</h3>
        <p className={styles.filename}>{subtitle.filename}</p>
        <div
          className={`${styles.dropZone} ${styles.subtitleDropZone} ${subtitleDrop.isDragOver ? styles.dropZoneActive : ""}`}
          {...subtitleDrop.dropZoneProps}
        >
          <dl className={styles.meta}>
            <div>
              <dt>Status</dt>
              <dd>{subtitle.exists ? "Ready" : "Not set"}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{formatBytes(subtitle.size)}</dd>
            </div>
            <div>
              <dt>Cues</dt>
              <dd>{subtitle.cueCount ?? "—"}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatDate(subtitle.modifiedAt)}</dd>
            </div>
          </dl>
          {subtitleDrop.isDragOver && (
            <div className={styles.dropOverlay}>Drop .srt to replace</div>
          )}
        </div>
        <label className={styles.uploadLabel}>
          <span>
            {uploadingSubtitle ? "Saving…" : "Upload or drop .srt"}
          </span>
          <input
            type="file"
            accept=".srt,text/plain"
            disabled={uploadingSubtitle}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onSubtitleUpload(event, file);
              e.target.value = "";
            }}
          />
        </label>
        <p className={styles.manageLink}>
          <Link href={`/subtitles?event=${event}`}>Manage subtitles →</Link>
        </p>
      </div>
    </section>
  );
}
