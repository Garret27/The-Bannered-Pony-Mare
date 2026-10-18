"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ConversionJob,
  ConversionPreset,
  EncodingTuning,
} from "@/lib/converter-agent";
import type { MovieEntry } from "@/lib/movies-library";
import type { TvEpisodeEntry } from "@/lib/tv-types";
import { formatBytes } from "@/lib/format";
import { ConversionHistory } from "./ConversionHistory";
import { ConversionProgress } from "./ConversionProgress";
import { ConversionSummary } from "./ConversionSummary";
import { PresetTuningPanel } from "./PresetTuningPanel";
import { Toast } from "./Toast";
import styles from "./Movies.module.css";
import tableStyles from "./SpaceSaver.module.css";

const DEFAULT_MIN_GB = 8;
const PAGE_SIZE = 50;
const TV_ROOT_KEYS = new Set(["h", "te", "tj"]);

export type SpaceSaverMode = "movies" | "tv";

type TvLibraryEpisode = TvEpisodeEntry & { code: string };

type SpaceSaverItem = {
  id: string;
  label: string;
  rootKey: string;
  format: string;
  sizeBytes: number;
};

type MovieLibraryResponse = {
  movies: MovieEntry[];
  total: number;
  totalSizeBytes: number;
  scannedAt?: string;
  error?: string;
};

type TvLibraryResponse = {
  episodes: TvLibraryEpisode[];
  total: number;
  totalSizeBytes: number;
  scannedAt?: string;
  error?: string;
};

type AgentHealth = {
  ok: boolean;
  enabled?: boolean;
  replaceReady?: boolean;
  sourceRootsWritable?: Record<string, boolean>;
  error?: string;
  disabledReason?: string | null;
};

type ToastState = {
  message: string;
  type: "success" | "error";
} | null;

type SpaceSaverPageProps = {
  mode: SpaceSaverMode;
};

function spaceSaverAgentLabel(health: AgentHealth): string {
  if (health.error && health.enabled === undefined) return "offline";
  if (health.enabled === false) return "disabled";
  if (health.replaceReady === true) return "ready";
  if (health.enabled === true) return "drive issue";
  return "offline";
}

function estimateOutputSize(sizeBytes: number, ratio: number): number {
  return Math.round(sizeBytes * ratio);
}

function formatDrive(rootKey: string, mode: SpaceSaverMode): string {
  if (mode === "tv") {
    if (rootKey === "te") return "E";
    if (rootKey === "tj") return "J";
    if (rootKey === "h") return "H";
  }
  return rootKey.toUpperCase();
}

function movieToItem(movie: MovieEntry): SpaceSaverItem {
  return {
    id: movie.id,
    label: movie.title,
    rootKey: movie.rootKey,
    format: movie.format,
    sizeBytes: movie.sizeBytes,
  };
}

function episodeToItem(episode: TvLibraryEpisode): SpaceSaverItem {
  return {
    id: episode.id,
    label: `${episode.seriesName} · ${episode.code} · ${episode.title}`,
    rootKey: episode.rootKey,
    format: episode.format,
    sizeBytes: episode.sizeBytes,
  };
}

export function SpaceSaverPage({ mode }: SpaceSaverPageProps) {
  const isTv = mode === "tv";
  const [items, setItems] = useState<SpaceSaverItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalSizeBytes, setTotalSizeBytes] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [minSizeGb, setMinSizeGb] = useState(DEFAULT_MIN_GB);
  const [rootKey, setRootKey] = useState("");
  const [extension, setExtension] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [presets, setPresets] = useState<ConversionPreset[]>([]);
  const [preset, setPreset] = useState("jellyfin-balanced");
  const [tuning, setTuning] = useState<EncodingTuning>({});
  const [estimatedSizeRatio, setEstimatedSizeRatio] = useState(0.55);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingQueue, setPendingQueue] = useState<SpaceSaverItem[]>([]);
  const [queue, setQueue] = useState<SpaceSaverItem[]>([]);
  const [activeJob, setActiveJob] = useState<ConversionJob | null>(null);
  const [history, setHistory] = useState<ConversionJob[]>([]);
  const [agentHealth, setAgentHealth] = useState<AgentHealth>({ ok: false });
  const [toast, setToast] = useState<ToastState>(null);
  const [lastScannedAt, setLastScannedAt] = useState<string | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const processingQueue = useRef(false);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const handleTuningChange = useCallback(
    (nextTuning: EncodingTuning, ratio: number) => {
      setTuning(nextTuning);
      setEstimatedSizeRatio(ratio);
    },
    [],
  );

  useEffect(() => {
    setPage(1);
    setQuery("");
    setDebouncedQuery("");
    setRootKey("");
    setExtension("");
    setSelectedIds(new Set());
    setPendingQueue([]);
    setQueue([]);
    setShowConfirm(false);
    setActiveJob(null);
  }, [mode]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loadHealth = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch("/api/movies/convert/health");
      const data = (await response.json()) as AgentHealth & {
        activeJobId?: string | null;
        enabled?: boolean;
        replaceReady?: boolean;
        disabledReason?: string | null;
      };
      setAgentHealth({
        ok: data.ok === true,
        enabled: data.enabled === true,
        replaceReady: data.replaceReady === true,
        sourceRootsWritable: data.sourceRootsWritable,
        disabledReason: data.disabledReason,
        error: response.ok ? data.disabledReason ?? undefined : data.error,
      });
      return data.activeJobId ?? null;
    } catch {
      setAgentHealth({
        ok: false,
        error: "Converter agent unreachable",
      });
      return null;
    }
  }, []);

  const loadPresets = useCallback(async () => {
    try {
      const response = await fetch("/api/movies/convert/presets?mode=replace");
      if (!response.ok) return;
      const data = (await response.json()) as { presets: ConversionPreset[] };
      setPresets(data.presets ?? []);
    } catch {
      // ignore
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const response = await fetch("/api/movies/convert/history");
      if (!response.ok) return;
      const data = (await response.json()) as { jobs: ConversionJob[] };
      const replaceJobs = (data.jobs ?? []).filter(
        (job) => job.mode === "replace",
      );
      const filtered = isTv
        ? replaceJobs.filter((job) => TV_ROOT_KEYS.has(job.rootKey))
        : replaceJobs.filter((job) => !TV_ROOT_KEYS.has(job.rootKey));
      setHistory(filtered);
    } catch {
      // ignore
    }
  }, [isTv]);

  const removeHistoryEntry = useCallback(async (jobId: string) => {
    const response = await fetch(
      `/api/movies/convert/history?jobId=${encodeURIComponent(jobId)}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      throw new Error(data.error ?? "Failed to remove history entry");
    }
    setHistory((prev) => prev.filter((job) => job.id !== jobId));
  }, []);

  const clearHistory = useCallback(async () => {
    const response = await fetch("/api/movies/convert/history", {
      method: "DELETE",
    });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      throw new Error(data.error ?? "Failed to clear history");
    }
    await loadHistory();
  }, [loadHistory]);

  const pollJob = useCallback(async (jobId: string) => {
    const response = await fetch(
      `/api/movies/convert/${encodeURIComponent(jobId)}`,
    );
    if (!response.ok) return null;
    return (await response.json()) as ConversionJob;
  }, []);

  const loadLibrary = useCallback(
    async (options?: { refresh?: boolean; quiet?: boolean }) => {
      const refresh = options?.refresh ?? false;
      const quiet = options?.quiet ?? false;
      if (!quiet) setLoading(true);
      else setRechecking(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(PAGE_SIZE),
          sort: "size",
          order: "desc",
          minSizeBytes: String(minSizeGb * 1024 * 1024 * 1024),
          liveSizes: "true",
        });
        if (refresh) params.set("refresh", "true");
        if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim());
        if (rootKey) params.set("rootKey", rootKey);
        if (extension) params.set("extension", extension);

        if (isTv) {
          const response = await fetch(`/api/tv/library?${params.toString()}`);
          const data = (await response.json()) as TvLibraryResponse;
          if (!response.ok) {
            throw new Error(data.error ?? "Failed to load episodes");
          }
          setItems((data.episodes ?? []).map(episodeToItem));
          setTotal(data.total);
          setTotalSizeBytes(data.totalSizeBytes ?? 0);
          setLastScannedAt(data.scannedAt ?? new Date().toISOString());
        } else {
          const response = await fetch(
            `/api/movies/library?${params.toString()}`,
          );
          const data = (await response.json()) as MovieLibraryResponse;
          if (!response.ok) {
            throw new Error(data.error ?? "Failed to load movies");
          }
          setItems((data.movies ?? []).map(movieToItem));
          setTotal(data.total);
          setTotalSizeBytes(data.totalSizeBytes ?? 0);
          setLastScannedAt(data.scannedAt ?? new Date().toISOString());
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : isTv
              ? "Failed to load episodes"
              : "Failed to load movies",
        );
        setItems([]);
        setTotal(0);
        setTotalSizeBytes(0);
      } finally {
        if (!quiet) setLoading(false);
        else setRechecking(false);
      }
    },
    [page, debouncedQuery, minSizeGb, rootKey, extension, isTv],
  );

  const recheckLibrary = useCallback(async () => {
    await loadLibrary({ refresh: true, quiet: true });
    showToast("Library rechecked from disk", "success");
  }, [loadLibrary, showToast]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    const init = async () => {
      const activeJobId = await loadHealth();
      await loadPresets();
      await loadHistory();
      if (activeJobId) {
        const job = await pollJob(activeJobId);
        if (job && job.mode === "replace") {
          const isTvJob = TV_ROOT_KEYS.has(job.rootKey);
          if (isTvJob === isTv) setActiveJob(job);
        }
      }
    };
    void init();
    const interval = window.setInterval(() => void loadHealth(), 30_000);
    return () => window.clearInterval(interval);
  }, [loadHealth, loadPresets, loadHistory, pollJob, isTv]);

  const startReplaceJob = useCallback(
    async (item: SpaceSaverItem): Promise<ConversionJob | null> => {
      const endpoint = isTv
        ? "/api/tv/convert/replace"
        : "/api/movies/convert/replace";
      const body = isTv
        ? {
            episodeId: item.id,
            preset,
            confirm: true,
            tuning: Object.keys(tuning).length > 0 ? tuning : undefined,
          }
        : {
            movieId: item.id,
            preset,
            confirm: true,
            tuning: Object.keys(tuning).length > 0 ? tuning : undefined,
          };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await response.json()) as {
        job?: ConversionJob;
        jobId?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to start conversion");
      }

      if (data.job) return data.job;
      if (data.jobId) return pollJob(data.jobId);
      return null;
    },
    [isTv, preset, tuning, pollJob],
  );

  const processQueue = useCallback(async () => {
    if (processingQueue.current) return;
    processingQueue.current = true;

    try {
      let currentQueue = queue;
      while (currentQueue.length > 0) {
        const [next, ...rest] = currentQueue;
        setQueue(rest);
        currentQueue = rest;

        try {
          const job = await startReplaceJob(next);
          if (!job) continue;
          setActiveJob(job);

          let finished = false;
          while (!finished) {
            await new Promise((resolve) => window.setTimeout(resolve, 1500));
            const updated = await pollJob(job.id);
            if (!updated) break;
            setActiveJob(updated);

            if (
              updated.status === "done" ||
              updated.status === "failed" ||
              updated.status === "cancelled"
            ) {
              finished = true;
              setHistory((prev) => {
                const filtered = prev.filter((j) => j.id !== updated.id);
                return [updated, ...filtered];
              });
              void loadHistory();
              if (updated.status === "done") {
                showToast(
                  `Replaced ${updated.title} — saved ${formatBytes(updated.bytesSaved ?? 0)}`,
                  "success",
                );
                setSelectedIds((prev) => {
                  const nextSet = new Set(prev);
                  nextSet.delete(next.id);
                  return nextSet;
                });
                void loadLibrary({ refresh: true, quiet: true });
              } else if (updated.status === "failed") {
                showToast(updated.error ?? "Conversion failed", "error");
              }
            }
          }
        } catch (err) {
          showToast(
            err instanceof Error ? err.message : "Failed to start conversion",
            "error",
          );
          break;
        }
      }
    } finally {
      processingQueue.current = false;
      setActiveJob(null);
      void loadLibrary({ refresh: true, quiet: true });
    }
  }, [queue, startReplaceJob, pollJob, showToast, loadLibrary, loadHistory]);

  useEffect(() => {
    if (queue.length > 0 && !processingQueue.current && !activeJob) {
      void processQueue();
    }
  }, [queue, activeJob, processQueue]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((item) => item.id)));
    }
  };

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds],
  );

  const selectedTotalBytes = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.sizeBytes, 0),
    [selectedItems],
  );

  const enqueueItems = (nextItems: SpaceSaverItem[]) => {
    if (nextItems.length === 0) return;
    setPendingQueue(nextItems);
    setShowConfirm(true);
  };

  const confirmQueue = () => {
    setShowConfirm(false);
    setQueue((prev) => [...prev, ...pendingQueue]);
    setPendingQueue([]);
  };

  const handleCancel = async () => {
    if (!activeJob) return;
    const response = await fetch(
      `/api/movies/convert/${encodeURIComponent(activeJob.id)}`,
      { method: "DELETE" },
    );
    if (response.ok) {
      const job = (await response.json()) as ConversionJob;
      setActiveJob(job);
      setHistory((prev) => [job, ...prev.filter((j) => j.id !== job.id)]);
    }
  };

  const converting =
    activeJob?.status === "queued" || activeJob?.status === "running";

  const showSummary =
    activeJob &&
    !converting &&
    (activeJob.status === "done" ||
      activeJob.status === "failed" ||
      activeJob.status === "cancelled");

  const agentLabel = spaceSaverAgentLabel(agentHealth);
  const agentOnline = agentLabel === "ready";
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const mediaLabel = isTv ? "episodes" : "movies";
  const driveLabel = isTv ? "E/H/J TV" : "E/J movie";

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Space Saver</h1>
          <p>
            {isTv
              ? "Find the largest TV episodes on E/H/J, encode locally with NVENC, then publish the replacement to Fedora over SSH. All audio and subtitle tracks are kept."
              : "Find the largest movies on E/J, encode locally with NVENC, then publish the replacement to Fedora over SSH. All audio and subtitle tracks are kept."}
          </p>
        </div>
        <span
          className={`${styles.statusPill} ${agentOnline ? styles.statusOnline : styles.statusOffline}`}
          title={agentHealth.disabledReason || agentHealth.error || undefined}
        >
          <span className={styles.statusDot} />
          Agent {agentLabel}
        </span>
      </header>

      <div className={tableStyles.modeToggle} role="tablist" aria-label="Space Saver media type">
        <Link
          href="/movies/space-saver"
          className={`${tableStyles.modeTab} ${!isTv ? tableStyles.modeTabActive : ""}`}
          aria-current={!isTv ? "page" : undefined}
        >
          Movies
        </Link>
        <Link
          href="/tv/space-saver"
          className={`${tableStyles.modeTab} ${isTv ? tableStyles.modeTabActive : ""}`}
          aria-current={isTv ? "page" : undefined}
        >
          TV
        </Link>
      </div>

      {!agentOnline && (
        <div className={styles.banner}>
          {agentHealth.error === "Converter agent unreachable"
            ? "Converter agent is unreachable — check Docker for converter-agent."
            : agentHealth.enabled === false
              ? "Converter is turned off — use the lightning icon in the nav bar to turn it on."
              : agentLabel === "drive issue"
                ? `Converter is on, but Fedora library roots (${driveLabel}) are not reachable/writable over SSH right now.`
                : "Converter is not ready for Space Saver replace — check Fedora SSH bridge or use the lightning icon in the nav bar."}
          {agentHealth.disabledReason &&
          agentHealth.error !== agentHealth.disabledReason
            ? ` (${agentHealth.disabledReason})`
            : agentHealth.error &&
                agentHealth.error !== "Converter agent unreachable"
              ? ` (${agentHealth.error})`
              : ""}
        </div>
      )}

      <div className={styles.warning} style={{ marginBottom: "1rem" }}>
        Conversions permanently replace the original file on Fedora (via SSH)
        after a verified upload — not through Samba. Run a Jellyfin library scan
        after jobs complete if paths or extensions changed.
      </div>

      <section className={styles.panel}>
        <div className={tableStyles.toolbar}>
          <div className={`${tableStyles.field} ${tableStyles.fieldGrow}`}>
            <label htmlFor="space-saver-search">Search</label>
            <input
              id="space-saver-search"
              type="search"
              placeholder={
                isTv ? "Filter by show or episode…" : "Filter by title…"
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className={tableStyles.field}>
            <label htmlFor="space-saver-min-gb">Min size (GB)</label>
            <input
              id="space-saver-min-gb"
              type="number"
              min={0}
              step={1}
              value={minSizeGb}
              onChange={(e) => {
                setMinSizeGb(Number(e.target.value) || 0);
                setPage(1);
              }}
            />
          </div>
          <div className={tableStyles.field}>
            <label htmlFor="space-saver-drive">Drive</label>
            <select
              id="space-saver-drive"
              value={rootKey}
              onChange={(e) => {
                setRootKey(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{isTv ? "All" : "Both"}</option>
              {isTv ? (
                <>
                  <option value="h">H Drive</option>
                  <option value="te">E Drive</option>
                  <option value="tj">J Drive</option>
                </>
              ) : (
                <>
                  <option value="e">E Drive</option>
                  <option value="j">J Drive</option>
                </>
              )}
            </select>
          </div>
          <div className={tableStyles.field}>
            <label htmlFor="space-saver-ext">Format</label>
            <select
              id="space-saver-ext"
              value={extension}
              onChange={(e) => {
                setExtension(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="mkv">MKV</option>
              <option value="mp4">MP4</option>
              <option value="avi">AVI</option>
            </select>
          </div>
        </div>

        <PresetTuningPanel
          presets={presets}
          presetId={preset}
          onPresetChange={setPreset}
          onTuningChange={handleTuningChange}
          selectedTotalBytes={selectedTotalBytes}
          disabled={converting}
        />

        <div className={tableStyles.statsBar}>
          <span>
            Showing <strong>{total}</strong> {mediaLabel}
          </span>
          <span>
            Combined size: <strong>{formatBytes(totalSizeBytes)}</strong>
          </span>
          {lastScannedAt && (
            <span>
              Last checked:{" "}
              <strong>{new Date(lastScannedAt).toLocaleString()}</strong>
            </span>
          )}
          {selectedIds.size > 0 && (
            <span>
              Selected: <strong>{selectedIds.size}</strong>
            </span>
          )}
          {queue.length > 0 && (
            <span>
              Queued: <strong>{queue.length}</strong>
            </span>
          )}
        </div>

        <div className={styles.actions} style={{ marginBottom: "1rem" }}>
          <button
            type="button"
            className={styles.button}
            disabled={!agentOnline || converting || selectedItems.length === 0}
            onClick={() => enqueueItems(selectedItems)}
          >
            Queue selected ({selectedItems.length})
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonSecondary}`}
            disabled={!agentOnline || converting || items.length === 0}
            onClick={() => enqueueItems([items[0]!])}
          >
            Convert largest
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonSecondary}`}
            disabled={loading || rechecking || converting}
            onClick={() => void recheckLibrary()}
          >
            {rechecking ? "Rechecking…" : "Recheck library"}
          </button>
        </div>

        {loading ? (
          <p className={styles.empty}>Loading library…</p>
        ) : error ? (
          <p className={styles.empty}>{error}</p>
        ) : items.length === 0 ? (
          <p className={styles.empty}>
            No {mediaLabel} match your filters. Try lowering the minimum size.
          </p>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table className={tableStyles.spaceSaverTable}>
                <thead>
                  <tr>
                    <th className={tableStyles.checkboxCell}>
                      <input
                        type="checkbox"
                        checked={
                          items.length > 0 && selectedIds.size === items.length
                        }
                        onChange={toggleSelectAll}
                        aria-label="Select all on page"
                      />
                    </th>
                    <th>{isTv ? "Episode" : "Title"}</th>
                    <th>Drive</th>
                    <th>Format</th>
                    <th>Size</th>
                    <th>Est. after</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className={
                        selectedIds.has(item.id) ? tableStyles.selected : ""
                      }
                    >
                      <td className={tableStyles.checkboxCell}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.id)}
                          onChange={() => toggleSelect(item.id)}
                          aria-label={`Select ${item.label}`}
                        />
                      </td>
                      <td>{item.label}</td>
                      <td>
                        <span className={tableStyles.driveBadge}>
                          {formatDrive(item.rootKey, mode)}
                        </span>
                      </td>
                      <td>{item.format.toUpperCase()}</td>
                      <td className={tableStyles.sizeCell}>
                        {formatBytes(item.sizeBytes)}
                      </td>
                      <td className={tableStyles.sizeCell}>
                        ~
                        {formatBytes(
                          estimateOutputSize(
                            item.sizeBytes,
                            estimatedSizeRatio,
                          ),
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={tableStyles.pagination}>
              <span>
                Page {page} of {totalPages}
              </span>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {activeJob && converting && (
        <ConversionProgress
          job={activeJob}
          onCancel={() => void handleCancel()}
        />
      )}

      {activeJob && showSummary && queue.length === 0 && (
        <>
          <ConversionSummary
            job={activeJob}
            onConvertAnother={() => setActiveJob(null)}
          />
          <div className={tableStyles.jellyfinNote}>
            If the file extension changed, run a Jellyfin library scan to
            refresh paths.
          </div>
        </>
      )}

      <ConversionHistory
        jobs={history}
        onRemove={removeHistoryEntry}
        onClearAll={clearHistory}
      />

      {showConfirm && (
        <div
          className={tableStyles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-replace-title"
        >
          <div className={tableStyles.modal}>
            <h3 id="confirm-replace-title">Replace original files?</h3>
            <p>
              This will permanently replace{" "}
              <strong>{pendingQueue.length}</strong> file
              {pendingQueue.length === 1 ? "" : "s"} using the{" "}
              <strong>
                {presets.find((p) => p.id === preset)?.label ?? preset}
              </strong>{" "}
              preset. Originals are only deleted if the new file is smaller.
            </p>
            <ul style={{ fontSize: "0.8125rem", marginBottom: "1rem" }}>
              {pendingQueue.slice(0, 5).map((item) => (
                <li key={item.id}>
                  {item.label} ({formatBytes(item.sizeBytes)})
                </li>
              ))}
              {pendingQueue.length > 5 && (
                <li>…and {pendingQueue.length - 5} more</li>
              )}
            </ul>
            <div className={tableStyles.modalActions}>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonSecondary}`}
                onClick={() => {
                  setShowConfirm(false);
                  setPendingQueue([]);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonDanger}`}
                onClick={confirmQueue}
              >
                Replace files
              </button>
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
