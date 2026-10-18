"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BunnyLibrary, type BunnyFile } from "./BunnyLibrary";
import { BunnyUploadPanel } from "./BunnyUploadPanel";
import styles from "./Cdn.module.css";

export function CdnPage() {
  const [movies, setMovies] = useState<BunnyFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [bunnyOk, setBunnyOk] = useState(false);
  const [bunnyConfigured, setBunnyConfigured] = useState(false);
  const [jellyfinOutputAvailable, setJellyfinOutputAvailable] = useState(false);
  const [bunnyError, setBunnyError] = useState<string | null>(null);

  const loadHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/cdn/health");
      const data = (await response.json()) as {
        bunny?: { ok: boolean; configured: boolean; error?: string };
        jellyfinOutput?: { ok: boolean; error?: string };
      };
      setBunnyOk(data.bunny?.ok === true);
      setBunnyConfigured(data.bunny?.configured === true);
      setBunnyError(data.bunny?.error ?? null);
      setJellyfinOutputAvailable(data.jellyfinOutput?.ok === true);
    } catch {
      setBunnyOk(false);
      setBunnyConfigured(false);
      setJellyfinOutputAvailable(false);
    }
  }, []);

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/cdn/library");
      const data = (await response.json()) as {
        movies: BunnyFile[];
        error?: string;
      };
      if (response.ok) {
        setMovies(data.movies ?? []);
      } else {
        setMovies([]);
        setBunnyError(data.error ?? "Failed to load CDN library");
      }
    } catch {
      setMovies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHealth();
    void loadLibrary();
  }, [loadHealth, loadLibrary]);

  const bunnyFilenames = useMemo(
    () => new Set(movies.map((m) => m.filename)),
    [movies],
  );

  const handleRefresh = useCallback(() => {
    void loadHealth();
    void loadLibrary();
  }, [loadHealth, loadLibrary]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>CDN</h1>
          <p>
            Browse movies on Bunny storage, upload converted files, copy public
            URLs, and set Movie Night redirects. MP4 uploads are automatically
            optimized for browser playback (faststart). CDN uploads do not
            require the converter agent.
          </p>
        </div>
      </header>

      <div className={styles.statusRow}>
        <span
          className={`${styles.statusPill} ${bunnyOk ? styles.online : styles.offline}`}
        >
          <span className={styles.statusDot} />
          Bunny {bunnyOk ? "connected" : bunnyConfigured ? "error" : "not configured"}
        </span>
        <span
          className={`${styles.statusPill} ${jellyfinOutputAvailable ? styles.online : styles.offline}`}
        >
          <span className={styles.statusDot} />
          Jellyfin output {jellyfinOutputAvailable ? "available" : "unavailable"}
        </span>
      </div>

      {(!bunnyConfigured || !bunnyOk) && (
        <div className={styles.banner}>
          {!bunnyConfigured
            ? "Configure Bunny CDN credentials in Settings, then restart Docker if needed."
            : bunnyError ?? "Cannot reach Bunny storage API."}
        </div>
      )}

      <BunnyLibrary
        movies={movies}
        loading={loading}
        previewUrl={previewUrl}
        onPreview={setPreviewUrl}
        onRefresh={handleRefresh}
        onDeleted={(filename) => {
          setMovies((prev) => prev.filter((m) => m.filename !== filename));
          if (previewUrl?.includes(encodeURIComponent(filename))) {
            setPreviewUrl(null);
          }
        }}
      />

      <BunnyUploadPanel
        bunnyConfigured={bunnyConfigured && bunnyOk}
        jellyfinOutputAvailable={jellyfinOutputAvailable}
        bunnyFilenames={bunnyFilenames}
        onUploadComplete={handleRefresh}
      />
    </main>
  );
}
