"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDate } from "@/lib/format";
import type { Event } from "@/lib/paths";
import { EVENT_LABELS } from "@/lib/paths";
import { Toast } from "./Toast";
import styles from "./MoviePicturePage.module.css";

type VrchatPhoto = {
  id: string;
  filename: string;
  relativePath: string;
  modifiedAt: string;
  imageUrl: string;
};

type RecentResponse = {
  photos: VrchatPhoto[];
  dirConfigured: boolean;
  webhooks: Record<Event, boolean>;
  error?: string;
};

type ToastState = { message: string; type: "success" | "error" } | null;

const DEFAULT_CAPTION = "Thank you for coming to the movie!";

export function MoviePicturePage() {
  const [photos, setPhotos] = useState<VrchatPhoto[]>([]);
  const [dirConfigured, setDirConfigured] = useState(true);
  const [webhooks, setWebhooks] = useState<Record<Event, boolean>>({
    main: false,
    hspc: false,
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState<VrchatPhoto | null>(null);
  const [caption, setCaption] = useState(DEFAULT_CAPTION);
  const [postingEvent, setPostingEvent] = useState<Event | null>(null);
  const [pendingPostEvent, setPendingPostEvent] = useState<Event | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const loadPhotos = useCallback(async () => {
    const response = await fetch("/api/movie-picture/recent");
    if (!response.ok) {
      throw new Error("Failed to load photos");
    }

    const data = (await response.json()) as RecentResponse;
    setPhotos(data.photos);
    setDirConfigured(data.dirConfigured);
    setWebhooks(data.webhooks);
    setLoadError(data.error ?? null);
  }, []);

  useEffect(() => {
    loadPhotos()
      .catch(() => showToast("Failed to load VRChat photos", "error"))
      .finally(() => setLoading(false));
  }, [loadPhotos, showToast]);

  useEffect(() => {
    if (!selectedPhoto) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedPhoto(null);
        setCaption(DEFAULT_CAPTION);
        setPendingPostEvent(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedPhoto]);

  const openPhoto = (photo: VrchatPhoto) => {
    setSelectedPhoto(photo);
    setCaption(DEFAULT_CAPTION);
    setPendingPostEvent(null);
  };

  const closeLightbox = () => {
    setSelectedPhoto(null);
    setCaption(DEFAULT_CAPTION);
    setPendingPostEvent(null);
  };

  const handlePostClick = (event: Event) => {
    if (!selectedPhoto || postingEvent) return;

    if (!webhooks[event]) {
      showToast(
        `Discord webhook is not configured for ${EVENT_LABELS[event]}`,
        "error",
      );
      return;
    }

    if (pendingPostEvent !== event) {
      setPendingPostEvent(event);
      return;
    }

    void executePost(event);
  };

  const executePost = async (event: Event) => {
    if (!selectedPhoto || postingEvent) return;

    setPostingEvent(event);
    setPendingPostEvent(null);
    try {
      const response = await fetch(
        `/api/movie-picture/${selectedPhoto.id}/post`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event, caption }),
        },
      );

      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to post photo");
      }

      showToast(data.message ?? "Photo posted to Discord", "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to post photo",
        "error",
      );
    } finally {
      setPostingEvent(null);
    }
  };

  if (loading) {
    return (
      <main className={styles.page}>
        <p className={styles.loading}>Loading…</p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <h1>Movie Picture</h1>
        <p>
          Latest VRChat screenshots from your photos folder. Click a photo to
          preview and post to Main or HSPC Discord with an optional caption.
        </p>
      </header>

      <div className={styles.statusRow}>
        <span
          className={`${styles.statusPill} ${dirConfigured ? styles.online : styles.offline}`}
        >
          <span className={styles.statusDot} />
          Photos folder {dirConfigured ? "available" : "missing"}
        </span>
        <span
          className={`${styles.statusPill} ${webhooks.main ? styles.online : styles.offline}`}
        >
          <span className={styles.statusDot} />
          Main webhook {webhooks.main ? "configured" : "missing"}
        </span>
        <span
          className={`${styles.statusPill} ${webhooks.hspc ? styles.online : styles.offline}`}
        >
          <span className={styles.statusDot} />
          HSPC webhook {webhooks.hspc ? "configured" : "missing"}
        </span>
      </div>

      {!dirConfigured && (
        <div className={styles.alert}>
          Set <code>VRCHAT_PHOTOS_DIR</code> in your <code>.env</code>, ensure
          the VRChat folder is bind-mounted in Docker, and restart the stack.
          {loadError && <> {loadError}</>}
        </div>
      )}

      {dirConfigured && photos.length === 0 && (
        <p className={styles.empty}>No images found in the VRChat photos folder.</p>
      )}

      {photos.length > 0 && (
        <div className={styles.grid}>
          {photos.map((photo) => (
            <button
              key={photo.id}
              type="button"
              className={styles.card}
              onClick={() => openPhoto(photo)}
            >
              <div className={styles.thumb}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.imageUrl} alt={photo.filename} loading="lazy" />
              </div>
              <div className={styles.meta}>
                <strong title={photo.filename}>{photo.filename}</strong>
                <span>{formatDate(photo.modifiedAt)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {selectedPhoto && (
        <div
          className={styles.lightboxBackdrop}
          onClick={closeLightbox}
          role="presentation"
        >
          <div
            className={styles.lightbox}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="lightbox-title"
          >
            <div className={styles.lightboxHeader}>
              <h2 id="lightbox-title" title={selectedPhoto.filename}>
                {selectedPhoto.filename}
              </h2>
              <button
                type="button"
                className={styles.closeButton}
                onClick={closeLightbox}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className={styles.lightboxImageWrap}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={selectedPhoto.imageUrl} alt={selectedPhoto.filename} />
            </div>

            <div className={styles.lightboxBody}>
              <div className={styles.field}>
                <label htmlFor="photo-caption">Caption (optional)</label>
                <textarea
                  id="photo-caption"
                  value={caption}
                  onChange={(event) => {
                    setCaption(event.target.value);
                    setPendingPostEvent(null);
                  }}
                  placeholder="Add a message to post with this photo…"
                  maxLength={2000}
                />
                <span className={styles.hint}>
                  {caption.length}/2000 characters
                </span>
              </div>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={`${styles.postButton} ${styles.main} ${
                    pendingPostEvent === "main" ? styles.confirm : ""
                  }`}
                  onClick={() => handlePostClick("main")}
                  disabled={postingEvent !== null || !webhooks.main}
                >
                  {postingEvent === "main"
                    ? "Posting…"
                    : pendingPostEvent === "main"
                      ? "Click again to post to Main Discord"
                      : "Post to Main Discord"}
                </button>
                <button
                  type="button"
                  className={`${styles.postButton} ${styles.hspc} ${
                    pendingPostEvent === "hspc" ? styles.confirm : ""
                  }`}
                  onClick={() => handlePostClick("hspc")}
                  disabled={postingEvent !== null || !webhooks.hspc}
                >
                  {postingEvent === "hspc"
                    ? "Posting…"
                    : pendingPostEvent === "hspc"
                      ? "Click again to post to HSPC Discord"
                      : "Post to HSPC Discord"}
                </button>
              </div>
            </div>
          </div>
        </div>
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
