"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { FileInfo } from "@/lib/format";
import { formatBytes, formatDate } from "@/lib/format";
import type { Event } from "@/lib/paths";
import { EVENT_LABELS, isEvent } from "@/lib/paths";
import { Toast } from "./Toast";
import styles from "./SubtitlesHub.module.css";

const STORAGE_KEY = "subtitle-event";

function resolveEvent(eventParam: string | null): Event {
  if (isEvent(eventParam ?? "")) return eventParam as Event;
  if (typeof window === "undefined") return "main";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (isEvent(stored ?? "")) return stored as Event;
  return "main";
}

type StatusResponse = {
  events: Record<Event, { poster: FileInfo; subtitle: FileInfo }>;
};

type ToastState = {
  message: string;
  type: "success" | "error";
} | null;

export function SubtitlesHub() {
  const searchParams = useSearchParams();
  const [activeEvent, setActiveEvent] = useState<Event>(() =>
    resolveEvent(searchParams.get("event")),
  );
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    setActiveEvent(resolveEvent(searchParams.get("event")));
  }, [searchParams]);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const loadStatus = useCallback(async () => {
    const response = await fetch("/api/status");
    if (!response.ok) {
      throw new Error("Failed to load status");
    }
    const data = (await response.json()) as StatusResponse;
    setStatus(data);
  }, []);

  useEffect(() => {
    loadStatus()
      .catch(() => showToast("Failed to load subtitle status", "error"))
      .finally(() => setLoading(false));
  }, [loadStatus, showToast]);

  const handleUpload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".srt")) {
      showToast("Drop a .srt subtitle file.", "error");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`/api/subtitles/${activeEvent}`, {
        method: "POST",
        body: formData,
      });

      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Upload failed");
      }

      await loadStatus();
      showToast(data.message ?? "Subtitle saved", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Upload failed", "error");
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <main className={styles.page}>
        <p className={styles.loading}>Loading…</p>
      </main>
    );
  }

  if (!status) {
    return (
      <main className={styles.page}>
        <p className={styles.loading}>Unable to load subtitle status.</p>
      </main>
    );
  }

  const subtitle = status.events[activeEvent].subtitle;
  const panelClass =
    activeEvent === "main" ? styles.panelMain : styles.panelHspc;
  const hasSubtitle = subtitle.exists;

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <h1>Subtitles</h1>
        <p>
          Manage subtitle files for Main and HSPC events. Use the Main / HSPC
          switch in the subheader to choose which file you are working on.
        </p>
      </header>

      <section className={`${styles.panel} ${panelClass}`}>
        <div className={styles.panelHeader}>
          <h2>{EVENT_LABELS[activeEvent]} Subtitles</h2>
          <span className={styles.badge}>{activeEvent.toUpperCase()}</span>
        </div>

        <p className={styles.filename}>{subtitle.filename}</p>

        <dl className={styles.meta}>
          <div className={styles.metaItem}>
            <dt>Status</dt>
            <dd>{subtitle.exists ? "Ready" : "Not set"}</dd>
          </div>
          <div className={styles.metaItem}>
            <dt>Cues</dt>
            <dd>{subtitle.cueCount ?? "—"}</dd>
          </div>
          <div className={styles.metaItem}>
            <dt>Size</dt>
            <dd>{formatBytes(subtitle.size)}</dd>
          </div>
          <div className={styles.metaItem}>
            <dt>Updated</dt>
            <dd>{formatDate(subtitle.modifiedAt)}</dd>
          </div>
        </dl>

        <div className={styles.actions}>
          <label className={styles.uploadLabel}>
            <span>{uploading ? "Saving…" : "Upload .srt"}</span>
            <input
              type="file"
              accept=".srt,text/plain"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(file);
                e.target.value = "";
              }}
            />
          </label>

          {hasSubtitle && (
            <a
              href={`/api/subtitles/${activeEvent}/download`}
              className={`${styles.button} ${styles.buttonSecondary}`}
              download
            >
              Download
            </a>
          )}
        </div>

        <div className={styles.tools}>
          <h3>Tools</h3>
          <div className={styles.toolGrid}>
            <Link
              href={`/subtitles/${activeEvent}/edit`}
              className={`${styles.toolCard} ${!hasSubtitle ? styles.toolCardDisabled : ""}`}
              aria-disabled={!hasSubtitle}
              tabIndex={hasSubtitle ? 0 : -1}
            >
              <h4>Editor</h4>
              <p>View and edit cues, adjust timing, fix typos.</p>
              <span className={styles.toolCardAction}>Open editor →</span>
            </Link>

            <Link
              href={`/subtitles/${activeEvent}/preview`}
              className={`${styles.toolCard} ${!hasSubtitle ? styles.toolCardDisabled : ""}`}
              aria-disabled={!hasSubtitle}
              tabIndex={hasSubtitle ? 0 : -1}
            >
              <h4>Preview</h4>
              <p>Play the movie and check subtitle sync.</p>
              <span className={styles.toolCardAction}>Open preview →</span>
            </Link>

            <Link href="/subtitles/library" className={styles.toolCard}>
              <h4>Library</h4>
              <p>Browse movies from your Jellyfin library.</p>
              <span className={styles.toolCardAction}>Open library →</span>
            </Link>

            <Link href="/subtitles/extract" className={styles.toolCard}>
              <h4>Extract</h4>
              <p>Pull subtitle tracks from a video file.</p>
              <span className={styles.toolCardAction}>Open extract →</span>
            </Link>

            <Link href="/subtitles/search" className={styles.toolCard}>
              <h4>Search</h4>
              <p>Find and download subtitles from OpenSubtitles.</p>
              <span className={styles.toolCardAction}>Open search →</span>
            </Link>
          </div>
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
