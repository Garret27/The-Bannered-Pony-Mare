"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FileInfo } from "@/lib/format";
import type { RedirectsConfig } from "@/lib/redirects";
import type { Event } from "@/lib/paths";
import { EVENTS } from "@/lib/paths";
import {
  CombinedSchedules,
  EventAnnouncementPanel,
  type AnnouncementDraft,
  type ScheduledAnnouncement,
} from "./AnnouncementsPage";
import { EventPanel } from "./EventPanel";
import { RedirectsEditor } from "./RedirectsEditor";
import { Toast } from "./Toast";
import styles from "./Dashboard.module.css";

type StatusResponse = {
  events: Record<Event, { poster: FileInfo; subtitle: FileInfo }>;
  redirects: RedirectsConfig;
  movieTitles: Record<Event, string>;
};

type GitHubPublishResult =
  | { published: true; commitSha: string; htmlUrl: string }
  | { published: false; error: string }
  | { published: false; skipped: true };

type UploadResponse = {
  error?: string;
  message?: string;
  github?: GitHubPublishResult;
};

type ToastState = {
  message: string;
  type: "success" | "error";
} | null;

function uploadToastType(github?: GitHubPublishResult): "success" | "error" {
  if (github && "error" in github && github.published === false) {
    return "error";
  }
  return "success";
}

export function Dashboard() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [drafts, setDrafts] = useState<Record<Event, AnnouncementDraft | null>>({
    main: null,
    hspc: null,
  });
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastState>(null);
  const [uploadingPoster, setUploadingPoster] = useState<Event | null>(null);
  const [uploadingSubtitle, setUploadingSubtitle] = useState<Event | null>(null);
  const [savingMovieTitle, setSavingMovieTitle] = useState<Event | null>(null);
  const [savingRedirects, setSavingRedirects] = useState(false);
  const [posterCacheKey, setPosterCacheKey] = useState(String(Date.now()));
  const [announcementPosterCacheKey, setAnnouncementPosterCacheKey] = useState(
    String(Date.now()),
  );
  const [schedules, setSchedules] = useState<ScheduledAnnouncement[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(true);

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
    setPosterCacheKey(String(Date.now()));
  }, []);

  const loadDrafts = useCallback(async () => {
    const results = await Promise.all(
      EVENTS.map(async (event) => {
        const response = await fetch(`/api/announcements/${event}/draft`);
        if (!response.ok) {
          throw new Error(`Failed to load ${event} draft`);
        }
        const data = (await response.json()) as AnnouncementDraft;
        return [event, data] as const;
      }),
    );

    setDrafts(Object.fromEntries(results) as Record<Event, AnnouncementDraft>);
    setAnnouncementPosterCacheKey(String(Date.now()));
  }, []);

  const loadSchedules = useCallback(async () => {
    const results = await Promise.all(
      EVENTS.map(async (event) => {
        const response = await fetch(`/api/announcements/${event}/schedules`);
        if (!response.ok) {
          throw new Error(`Failed to load ${event} schedules`);
        }
        const data = (await response.json()) as {
          schedules?: ScheduledAnnouncement[];
        };
        return data.schedules ?? [];
      }),
    );
    setSchedules(results.flat());
  }, []);

  useEffect(() => {
    Promise.all([loadStatus(), loadDrafts()])
      .catch(() => showToast("Failed to load dashboard", "error"))
      .finally(() => setLoading(false));
  }, [loadDrafts, loadStatus, showToast]);

  useEffect(() => {
    loadSchedules()
      .catch(() => showToast("Failed to load scheduled announcements", "error"))
      .finally(() => setSchedulesLoading(false));
  }, [loadSchedules, showToast]);

  const uploadFile = async (url: string, file: File): Promise<UploadResponse> => {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(url, {
      method: "POST",
      body: formData,
    });

    const data = (await response.json()) as UploadResponse;
    if (!response.ok) {
      throw new Error(data.error ?? "Upload failed");
    }
    return data;
  };

  const handlePosterUpload = async (event: Event, file: File) => {
    setUploadingPoster(event);
    try {
      const data = await uploadFile(`/api/posters/${event}`, file);
      await Promise.all([loadStatus(), loadDrafts()]);
      showToast(
        data.message ?? "Poster saved",
        uploadToastType(data.github),
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Poster upload failed", "error");
    } finally {
      setUploadingPoster(null);
    }
  };

  const handleSubtitleUpload = async (event: Event, file: File) => {
    setUploadingSubtitle(event);
    try {
      const data = await uploadFile(`/api/subtitles/${event}`, file);
      await loadStatus();
      showToast(
        data.message ?? "Subtitle saved",
        uploadToastType(data.github),
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Subtitle upload failed", "error");
    } finally {
      setUploadingSubtitle(null);
    }
  };

  const handleMovieTitleSave = async (event: Event, movieTitle: string) => {
    setSavingMovieTitle(event);
    try {
      const response = await fetch(`/api/event-titles/${event}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movieTitle }),
      });
      const data = (await response.json()) as {
        error?: string;
        message?: string;
        movieTitle?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to save movie title");
      }

      setStatus((current) =>
        current
          ? {
              ...current,
              movieTitles: {
                ...current.movieTitles,
                [event]: data.movieTitle ?? movieTitle.trim(),
              },
            }
          : current,
      );
      await loadDrafts().catch(() => {});
      showToast(data.message ?? "Movie title saved", "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to save movie title",
        "error",
      );
    } finally {
      setSavingMovieTitle(null);
    }
  };

  const handleSaveRedirects = async (config: RedirectsConfig) => {
    setSavingRedirects(true);
    try {
      const response = await fetch("/api/redirects", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      const data = (await response.json()) as {
        error?: string;
        message?: string;
        redirects?: RedirectsConfig;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to save redirects");
      }

      if (data.redirects && status) {
        setStatus({ ...status, redirects: data.redirects });
      }
      showToast(data.message ?? "Redirects saved", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save redirects", "error");
    } finally {
      setSavingRedirects(false);
    }
  };

  if (loading) {
    return (
      <main className={styles.page}>
        <p className={styles.loading}>Loading…</p>
      </main>
    );
  }

  if (!status || !drafts.main || !drafts.hspc) {
    return (
      <main className={styles.page}>
        <p className={styles.loading}>Unable to load dashboard.</p>
      </main>
    );
  }

  const timezone = drafts.main.timezone;

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <h1>Movie Night Manager</h1>
        <p>
          Upload posters and subtitles for Main and HSPC, then compose, schedule,
          or post Discord announcements in the same columns. Saves update local
          files and, when <code>GITHUB_TOKEN</code> is configured, auto-publish to
          GitHub for the public raw URLs.{" "}
          <Link href="/posters">Search official posters →</Link>
        </p>
      </header>

      <div className={styles.grid}>
        {EVENTS.map((event) => {
          const draft = drafts[event];
          if (!draft) return null;

          return (
            <div key={event} className={styles.column}>
              <EventPanel
                event={event}
                poster={status.events[event].poster}
                subtitle={status.events[event].subtitle}
                posterCacheKey={posterCacheKey}
                movieTitle={status.movieTitles?.[event] ?? ""}
                onMovieTitleSave={handleMovieTitleSave}
                onPosterUpload={handlePosterUpload}
                onSubtitleUpload={handleSubtitleUpload}
                onUploadError={(message) => showToast(message, "error")}
                uploadingPoster={uploadingPoster === event}
                uploadingSubtitle={uploadingSubtitle === event}
                savingMovieTitle={savingMovieTitle === event}
              />
              <EventAnnouncementPanel
                draft={draft}
                posterCacheKey={announcementPosterCacheKey}
                embedded
                onToast={showToast}
                onSchedulesChanged={() => {
                  void loadSchedules().catch(() =>
                    showToast("Failed to refresh schedules", "error"),
                  );
                }}
              />
            </div>
          );
        })}
      </div>

      <CombinedSchedules
        schedules={schedules}
        loading={schedulesLoading}
        timezone={timezone}
        drafts={{ main: drafts.main, hspc: drafts.hspc }}
        onToast={showToast}
        onReload={loadSchedules}
      />

      <RedirectsEditor
        redirects={status.redirects}
        onSave={handleSaveRedirects}
        saving={savingRedirects}
      />

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
