"use client";

import { useCallback, useEffect, useState } from "react";
import { formatBytes, formatDate } from "@/lib/format";
import { Toast } from "./Toast";
import styles from "./Cdn.module.css";

export type BunnyFile = {
  filename: string;
  sizeBytes: number;
  lastChanged: string;
  cdnUrl: string;
};

type BunnyLibraryProps = {
  movies: BunnyFile[];
  loading: boolean;
  previewUrl: string | null;
  onPreview: (url: string | null) => void;
  onRefresh: () => void;
  onDeleted?: (filename: string) => void;
};

type ToastState = { message: string; type: "success" | "error" } | null;

export function BunnyLibrary({
  movies,
  loading,
  previewUrl,
  onPreview,
  onRefresh,
  onDeleted,
}: BunnyLibraryProps) {
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<ToastState>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmDelete) return;
    const timer = window.setTimeout(() => setConfirmDelete(null), 5000);
    return () => window.clearTimeout(timer);
  }, [confirmDelete]);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const filtered = query.trim()
    ? movies.filter((m) =>
        m.filename.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : movies;

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      showToast("URL copied", "success");
    } catch {
      showToast("Failed to copy URL", "error");
    }
  };

  const setRedirect = async (event: "main" | "hspc", cdnUrl: string) => {
    const response = await fetch("/api/cdn/set-redirect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, cdnUrl }),
    });
    const data = (await response.json()) as { error?: string; message?: string };
    if (!response.ok) {
      showToast(data.error ?? "Failed to set redirect", "error");
      return;
    }
    showToast(data.message ?? "Redirect updated", "success");
  };

  const performDelete = async (filename: string) => {
    setDeleting(filename);
    setConfirmDelete(null);
    try {
      const response = await fetch("/api/cdn/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
      });
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to delete file");
      }
      if (previewUrl?.includes(encodeURIComponent(filename)) || previewUrl?.endsWith(filename)) {
        onPreview(null);
      }
      onDeleted?.(filename);
      onRefresh();
      showToast(data.message ?? "File deleted", "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to delete file",
        "error",
      );
    } finally {
      setDeleting(null);
    }
  };

  const handleDeleteClick = (filename: string) => {
    if (deleting) return;
    if (confirmDelete !== filename) {
      setConfirmDelete(filename);
      return;
    }
    void performDelete(filename);
  };

  return (
    <section className={styles.panel}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h2 className={styles.sectionTitle} style={{ marginBottom: 0 }}>
          CDN library
        </h2>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonSecondary}`}
          onClick={onRefresh}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      <div className={styles.searchRow}>
        <input
          type="search"
          placeholder="Search CDN files…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <p className={styles.meta}>
        {loading
          ? "Loading…"
          : `${filtered.length} file${filtered.length === 1 ? "" : "s"} on Bunny`}
      </p>

      <div className={styles.list}>
        {loading && movies.length === 0 ? (
          <p className={styles.empty}>Loading CDN files…</p>
        ) : filtered.length === 0 ? (
          <p className={styles.empty}>No files found.</p>
        ) : (
          filtered.map((movie) => (
            <div key={movie.filename} className={styles.row}>
              <div>
                <p className={styles.rowTitle}>{movie.filename}</p>
                <p className={styles.rowMeta}>
                  {formatBytes(movie.sizeBytes)} · {formatDate(movie.lastChanged)}
                </p>
              </div>
              <div className={styles.rowActions}>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  onClick={() => onPreview(previewUrl === movie.cdnUrl ? null : movie.cdnUrl)}
                >
                  {previewUrl === movie.cdnUrl ? "Hide" : "Preview"}
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  onClick={() => void copyUrl(movie.cdnUrl)}
                >
                  Copy URL
                </button>
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => void setRedirect("main", movie.cdnUrl)}
                >
                  Set /main
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  onClick={() => void setRedirect("hspc", movie.cdnUrl)}
                >
                  Set /hspc
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonDanger} ${confirmDelete === movie.filename ? styles.buttonDangerConfirm : ""}`}
                  disabled={deleting === movie.filename}
                  onClick={() => handleDeleteClick(movie.filename)}
                >
                  {deleting === movie.filename
                    ? "Deleting…"
                    : confirmDelete === movie.filename
                      ? "Confirm delete"
                      : "Delete"}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {previewUrl && (
        <video className={styles.previewVideo} controls src={previewUrl} />
      )}

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}
    </section>
  );
}
