"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ConversionJob,
  ConversionPreset,
  EncodingTuning,
} from "@/lib/converter-agent";
import type { TvSeriesEntry } from "@/lib/tv-types";
import { ConversionHistory } from "./ConversionHistory";
import { ConversionProgress } from "./ConversionProgress";
import { ConversionSummary } from "./ConversionSummary";
import {
  EpisodeList,
  SeasonList,
  tvEpisodeAnchorId,
  type TvEpisodeListItem,
  type TvSeasonListItem,
} from "./EpisodeList";
import { SeriesPicker, type RecentEpisode } from "./SeriesPicker";
import { Toast } from "./Toast";
import { TvConvertPanel } from "./TvConvertPanel";
import styles from "./Movies.module.css";

type AgentHealth = {
  ok: boolean;
  enabled?: boolean;
  tvReady?: boolean;
  tvOutputWritable: boolean;
  activeJobId?: string | null;
  error?: string;
  disabledReason?: string | null;
};

function tvAgentLabel(health: AgentHealth): string {
  if (health.error && health.enabled === undefined) return "offline";
  if (health.enabled === false) return "disabled";
  if (health.tvReady === true) return "online";
  if (health.enabled === true && health.tvOutputWritable === false) {
    return "H drive issue";
  }
  return "offline";
}

type ToastState = {
  message: string;
  type: "success" | "error";
} | null;

type QueuedEpisode = TvEpisodeListItem & {
  preset: string;
  overwrite: boolean;
};

const DEFAULT_PRESET = "jellyfin-library";

// Scroll drag for the floating home button: the offset eases back toward zero
// without ever crossing it, so the icon trails the scroll but never bounces.
const HOME_DRAG_PULL = 0.22;
const HOME_DRAG_MAX = 16;
const HOME_DRAG_EASE = 0.86;

export function TvPage() {
  const [selectedSeries, setSelectedSeries] = useState<TvSeriesEntry | null>(
    null,
  );
  const [seasons, setSeasons] = useState<TvSeasonListItem[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [episodes, setEpisodes] = useState<TvEpisodeListItem[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [seasonConvertedLoading, setSeasonConvertedLoading] = useState(false);
  const [selectedEpisode, setSelectedEpisode] =
    useState<TvEpisodeListItem | null>(null);
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [presets, setPresets] = useState<ConversionPreset[]>([]);
  const [batchPreset, setBatchPreset] = useState(DEFAULT_PRESET);
  const [batchOverwrite, setBatchOverwrite] = useState(false);
  const [pendingQueue, setPendingQueue] = useState<QueuedEpisode[]>([]);
  const [activeJob, setActiveJob] = useState<ConversionJob | null>(null);
  const [history, setHistory] = useState<ConversionJob[]>([]);
  const [agentHealth, setAgentHealth] = useState<AgentHealth>({
    ok: false,
    tvOutputWritable: false,
  });
  const [toast, setToast] = useState<ToastState>(null);
  const pendingQueueRef = useRef<QueuedEpisode[]>([]);
  const startingNextRef = useRef(false);
  const libraryPanelRef = useRef<HTMLElement>(null);
  const homeButtonRef = useRef<HTMLButtonElement>(null);
  const [pendingScrollEpisodeId, setPendingScrollEpisodeId] = useState<
    string | null
  >(null);

  useEffect(() => {
    pendingQueueRef.current = pendingQueue;
  }, [pendingQueue]);

  useEffect(() => {
    const button = homeButtonRef.current;
    if (!button) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let offset = 0;
    let lastScrollY = window.scrollY;
    let frame = 0;
    let running = false;

    const step = () => {
      offset *= HOME_DRAG_EASE;

      if (Math.abs(offset) < 0.1) {
        offset = 0;
        running = false;
        button.style.setProperty("--tv-home-offset", "0px");
        return;
      }

      button.style.setProperty("--tv-home-offset", `${offset.toFixed(2)}px`);
      frame = window.requestAnimationFrame(step);
    };

    const handleScroll = () => {
      const current = window.scrollY;
      const delta = current - lastScrollY;
      lastScrollY = current;

      offset = Math.max(
        -HOME_DRAG_MAX,
        Math.min(HOME_DRAG_MAX, offset + delta * HOME_DRAG_PULL),
      );

      if (!running) {
        running = true;
        frame = window.requestAnimationFrame(step);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.cancelAnimationFrame(frame);
      button.style.setProperty("--tv-home-offset", "0px");
    };
  }, [selectedSeries]);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const loadHealth = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch("/api/tv/convert/health");
      const data = (await response.json()) as AgentHealth & {
        tvOutputWritable?: boolean;
        tvReady?: boolean;
        enabled?: boolean;
        activeJobId?: string | null;
        disabledReason?: string | null;
      };
      setAgentHealth({
        ok: data.ok === true,
        enabled: data.enabled === true,
        tvReady: data.tvReady === true,
        tvOutputWritable: data.tvOutputWritable === true,
        disabledReason: data.disabledReason,
        error: response.ok
          ? data.disabledReason ?? undefined
          : data.error,
      });
      return data.activeJobId ?? null;
    } catch {
      setAgentHealth({
        ok: false,
        tvOutputWritable: false,
        error: "Converter agent unreachable",
      });
      return null;
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const response = await fetch("/api/movies/convert/history");
      if (!response.ok) return;
      const data = (await response.json()) as { jobs: ConversionJob[] };
      setHistory((data.jobs ?? []).filter((job) => job.mode === "tv"));
    } catch {
      // ignore
    }
  }, []);

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
    const tvJobs = history.filter((job) => job.mode === "tv");
    for (const job of tvJobs) {
      await fetch(
        `/api/movies/convert/history?jobId=${encodeURIComponent(job.id)}`,
        { method: "DELETE" },
      );
    }
    await loadHistory();
  }, [history, loadHistory]);

  const pollJob = useCallback(async (jobId: string) => {
    const response = await fetch(
      `/api/movies/convert/${encodeURIComponent(jobId)}`,
    );
    if (!response.ok) return null;
    return (await response.json()) as ConversionJob;
  }, []);

  const startEpisodeJob = useCallback(
    async (
      episode: QueuedEpisode | TvEpisodeListItem,
      overwrite: boolean,
      preset: string,
      tuning?: EncodingTuning,
    ) => {
      const response = await fetch("/api/tv/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodeId: episode.id,
          overwrite,
          preset,
          tuning,
        }),
      });

      const data = (await response.json()) as {
        jobId?: string;
        job?: ConversionJob;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to start conversion");
      }

      if (data.job) {
        setActiveJob(data.job);
        return data.job;
      }
      if (data.jobId) {
        const job = await pollJob(data.jobId);
        if (job) {
          setActiveJob(job);
          return job;
        }
      }
      throw new Error("Conversion started but job was not returned");
    },
    [pollJob],
  );

  const restoreActiveJob = useCallback(
    async (activeJobId: string | null) => {
      if (!activeJobId) return;
      const job = await pollJob(activeJobId);
      if (!job || job.mode !== "tv") return;
      setActiveJob((current) => current ?? job);
    },
    [pollJob],
  );

  const checkSeasonConverted = useCallback(
    async (seriesId: string, season: number) => {
      setSeasonConvertedLoading(true);
      try {
        const response = await fetch(
          `/api/tv/series/${encodeURIComponent(seriesId)}/episodes?season=${season}&checkConverted=true`,
        );
        if (!response.ok) return;
        const data = (await response.json()) as {
          convertedIds?: string[];
          episodes?: TvEpisodeListItem[];
        };
        const convertedIds = new Set(
          data.convertedIds ??
            (data.episodes ?? [])
              .filter((episode) => episode.converted)
              .map((episode) => episode.id),
        );
        setEpisodes((prev) =>
          prev.map((episode) =>
            episode.season === season
              ? { ...episode, converted: convertedIds.has(episode.id) }
              : { ...episode, converted: false },
          ),
        );
      } catch {
        // Leave converted flags cleared if the Jellyfin folder check fails.
      } finally {
        setSeasonConvertedLoading(false);
      }
    },
    [],
  );

  const refreshConvertedFlags = useCallback(
    async (seriesId: string, season: number | null) => {
      if (season === null) return;
      await checkSeasonConverted(seriesId, season);
    },
    [checkSeasonConverted],
  );

  useEffect(() => {
    if (activeJob?.status !== "done") return;
    const seriesId = selectedSeries?.id;
    if (!seriesId || selectedSeason === null) return;
    void refreshConvertedFlags(seriesId, selectedSeason);
  }, [
    activeJob?.id,
    activeJob?.status,
    refreshConvertedFlags,
    selectedSeason,
    selectedSeries?.id,
  ]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/movies/convert/presets?mode=tv");
        const data = (await response.json()) as { presets?: ConversionPreset[] };
        const list = data.presets ?? [];
        setPresets(list);
        if (list.some((p) => p.id === DEFAULT_PRESET)) {
          setBatchPreset(DEFAULT_PRESET);
        } else if (list[0]) {
          setBatchPreset(list[0].id);
        }
      } catch {
        setPresets([]);
      }
    })();
  }, []);

  useEffect(() => {
    const init = async () => {
      const activeJobId = await loadHealth();
      await loadHistory();
      await restoreActiveJob(activeJobId);
    };
    void init();
    const interval = window.setInterval(() => void loadHealth(), 30_000);
    return () => window.clearInterval(interval);
  }, [loadHealth, loadHistory, restoreActiveJob]);

  useEffect(() => {
    if (!activeJob) return;
    if (activeJob.status !== "queued" && activeJob.status !== "running") {
      return;
    }

    const interval = window.setInterval(async () => {
      const updated = await pollJob(activeJob.id);
      if (!updated) return;
      setActiveJob(updated);
      if (
        updated.status !== "done" &&
        updated.status !== "failed" &&
        updated.status !== "cancelled"
      ) {
        return;
      }

      setHistory((prev) => {
        const filtered = prev.filter((j) => j.id !== updated.id);
        return [updated, ...filtered];
      });

      if (startingNextRef.current) return;
      const queue = pendingQueueRef.current;
      if (queue.length === 0) {
        if (updated.status === "done") {
          showToast("Conversion complete", "success");
        } else if (updated.status === "failed") {
          showToast(updated.error ?? "Conversion failed", "error");
        }
        return;
      }

      const [next, ...rest] = queue;
      startingNextRef.current = true;
      setPendingQueue(rest);
      try {
        await startEpisodeJob(next, next.overwrite, next.preset);
        showToast(
          `Started ${next.code}${rest.length > 0 ? ` (${rest.length} remaining)` : ""}`,
          "success",
        );
      } catch (error) {
        showToast(
          error instanceof Error
            ? error.message
            : "Failed to start next queued episode",
          "error",
        );
        setPendingQueue((current) => [next, ...current]);
      } finally {
        startingNextRef.current = false;
      }
    }, 1500);

    return () => window.clearInterval(interval);
  }, [activeJob, pollJob, showToast, startEpisodeJob]);

  const handleSelectSeries = async (
    series: TvSeriesEntry,
    targetEpisodeId?: string,
  ) => {
    setSelectedSeries(series);
    setSelectedSeason(null);
    setSelectedEpisode(null);
    setMultiSelect(false);
    setSelectedIds(new Set());
    setEpisodesLoading(true);
    setSeasons([]);
    setEpisodes([]);
    try {
      const response = await fetch(
        `/api/tv/series/${encodeURIComponent(series.id)}/episodes`,
      );
      const data = (await response.json()) as {
        seasons?: TvSeasonListItem[];
        episodes?: TvEpisodeListItem[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load episodes");
      }
      const loadedEpisodes = data.episodes ?? [];
      setSeasons(data.seasons ?? []);
      setEpisodes(loadedEpisodes);
      if (targetEpisodeId) {
        const target = loadedEpisodes.find(
          (episode) => episode.id === targetEpisodeId,
        );
        if (target) {
          setSelectedSeason(target.season);
          setSelectedEpisode(target);
          setPendingScrollEpisodeId(target.id);
          void checkSeasonConverted(series.id, target.season);
        }
      }
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to load episodes",
        "error",
      );
    } finally {
      setEpisodesLoading(false);
    }
  };

  const seriesTitle = selectedSeries
    ? `${selectedSeries.title}${selectedSeries.year ? ` (${selectedSeries.year})` : ""}`
    : "";

  const returnToTvHome = () => {
    setSelectedSeries(null);
    setSelectedSeason(null);
    setSelectedEpisode(null);
    setMultiSelect(false);
    setSelectedIds(new Set());
    setSeasons([]);
    setEpisodes([]);
    window.setTimeout(() => {
      libraryPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
  };

  const selectedSeasonMeta =
    selectedSeason === null
      ? null
      : (seasons.find((season) => season.season === selectedSeason) ?? {
          season: selectedSeason,
          label: selectedSeason === 0 ? "Specials" : `Season ${selectedSeason}`,
          episodeCount: 0,
        });

  const seasonEpisodes = useMemo(
    () =>
      selectedSeason === null
        ? []
        : episodes.filter((episode) => episode.season === selectedSeason),
    [episodes, selectedSeason],
  );

  useEffect(() => {
    if (!pendingScrollEpisodeId) return;
    if (!seasonEpisodes.some((e) => e.id === pendingScrollEpisodeId)) return;

    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(tvEpisodeAnchorId(pendingScrollEpisodeId))
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      setPendingScrollEpisodeId(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingScrollEpisodeId, seasonEpisodes]);

  const handleConvert = async (
    overwrite: boolean,
    preset: string,
    tuning?: EncodingTuning,
  ) => {
    if (!selectedEpisode) return;
    try {
      await startEpisodeJob(selectedEpisode, overwrite, preset, tuning);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to start conversion",
        "error",
      );
    }
  };

  const handleQueueSelected = async () => {
    const selected = seasonEpisodes.filter((episode) =>
      selectedIds.has(episode.id),
    );
    if (selected.length === 0) return;

    const stamped: QueuedEpisode[] = selected.map((episode) => ({
      ...episode,
      preset: batchPreset,
      overwrite: batchOverwrite,
    }));

    const converting =
      activeJob?.status === "queued" || activeJob?.status === "running";

    if (!converting && !startingNextRef.current) {
      const [first, ...rest] = stamped;
      setSelectedIds(new Set());
      setSelectedEpisode(null);
      try {
        startingNextRef.current = true;
        await startEpisodeJob(first, first.overwrite, first.preset);
        setPendingQueue((prev) => [...prev, ...rest]);
        showToast(
          rest.length > 0
            ? `Started ${first.code}; ${rest.length} more in queue`
            : `Started ${first.code}`,
          "success",
        );
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : "Failed to start conversion",
          "error",
        );
      } finally {
        startingNextRef.current = false;
      }
      return;
    }

    setPendingQueue((prev) => {
      const existing = new Set(prev.map((item) => item.id));
      const added = stamped.filter((item) => !existing.has(item.id));
      return [...prev, ...added];
    });
    setSelectedIds(new Set());
    showToast(
      `Added ${stamped.length} episode${stamped.length === 1 ? "" : "s"} to queue`,
      "success",
    );
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
      // Leave pending queue intact so user can continue after cancel if desired.
    }
  };

  const handleConvertAnother = () => {
    setActiveJob(null);
    setSelectedEpisode(null);
  };

  const converting =
    activeJob?.status === "queued" || activeJob?.status === "running";

  const showSummary =
    activeJob &&
    (activeJob.status === "done" ||
      activeJob.status === "failed" ||
      activeJob.status === "cancelled") &&
    pendingQueue.length === 0;

  const agentLabel = tvAgentLabel(agentHealth);
  const agentOnline = agentLabel === "online";
  const queueBusy = converting || pendingQueue.length > 0;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>TV Shows</h1>
          <p>
            Browse Jellyfin series from your E/H/J TV libraries and convert
            episodes to <code>H:\TV Shows H Drive - Jellyfin</code> with the same
            Show (Year)/Season N layout as the desktop converter.
          </p>
        </div>
        <span
          className={`${styles.statusPill} ${agentOnline ? styles.statusOnline : styles.statusOffline}`}
          title={
            agentHealth.disabledReason || agentHealth.error || undefined
          }
        >
          <span className={styles.statusDot} />
          Agent {agentLabel}
        </span>
      </header>

      {!agentOnline && (
        <div className={styles.banner}>
          {agentHealth.error === "Converter agent unreachable"
            ? "Converter agent is unreachable — check Docker for converter-agent."
            : agentHealth.enabled === false
              ? "Converter is turned off — use the lightning icon in the nav bar to turn it on."
              : agentLabel === "H drive issue"
                ? "Converter is on, but the H drive Jellyfin output is not writable right now."
                : "Converter is not ready for TV conversion — use the lightning icon in the nav bar."}
          {agentHealth.disabledReason &&
          agentHealth.error !== agentHealth.disabledReason
            ? ` (${agentHealth.disabledReason})`
            : agentHealth.error &&
                agentHealth.error !== "Converter agent unreachable"
              ? ` (${agentHealth.error})`
              : ""}
        </div>
      )}

      {pendingQueue.length > 0 && (
        <div className={styles.banner}>
          Queue: {pendingQueue.length} episode
          {pendingQueue.length === 1 ? "" : "s"} waiting
          {pendingQueue[0]
            ? ` (next ${pendingQueue[0].code} · ${pendingQueue[0].preset})`
            : ""}
        </div>
      )}

      {selectedSeries && (
        <button
          type="button"
          ref={homeButtonRef}
          className={styles.floatingTvHome}
          aria-label="Back to TV Shows home"
          title="Back to TV Shows home"
          onClick={returnToTvHome}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m3 11 9-8 9 8" />
            <path d="M5 10v10h14V10" />
            <path d="M9 20v-6h6v6" />
          </svg>
        </button>
      )}

      <section
        ref={libraryPanelRef}
        className={`${styles.panel} ${converting ? styles.panelDimmed : ""}`}
      >
        {!selectedSeries ? (
          <SeriesPicker
            onSelect={(series) => void handleSelectSeries(series)}
            onSelectEpisode={(episode: RecentEpisode) =>
              void handleSelectSeries(
                {
                  id: episode.seriesId,
                  title: episode.seriesName,
                  year: episode.year,
                  hasPoster: episode.hasPoster,
                },
                episode.id,
              )
            }
            selectedId={null}
          />
        ) : selectedSeason === null ? (
          <SeasonList
            seriesTitle={seriesTitle}
            seasons={seasons}
            loading={episodesLoading}
            onSelectSeason={(season) => {
              setSelectedSeason(season);
              setSelectedEpisode(null);
              setMultiSelect(false);
              setSelectedIds(new Set());
              setEpisodes((prev) =>
                prev.map((episode) => ({ ...episode, converted: false })),
              );
              if (selectedSeries) {
                void checkSeasonConverted(selectedSeries.id, season);
              }
            }}
            onBack={() => {
              setSelectedSeries(null);
              setSelectedSeason(null);
              setSelectedEpisode(null);
              setMultiSelect(false);
              setSelectedIds(new Set());
              setSeasons([]);
              setEpisodes([]);
            }}
          />
        ) : (
          <EpisodeList
            seriesTitle={seriesTitle}
            seasonLabel={selectedSeasonMeta?.label ?? `Season ${selectedSeason}`}
            episodes={seasonEpisodes}
            selectedId={selectedEpisode?.id}
            loading={episodesLoading}
            checkingConverted={seasonConvertedLoading}
            multiSelect={multiSelect}
            selectedIds={selectedIds}
            presets={presets}
            selectedPreset={batchPreset}
            overwrite={batchOverwrite}
            queueBusy={queueBusy}
            agentOnline={agentOnline}
            onSelect={(episode) => {
              setSelectedEpisode(episode);
            }}
            onToggleMultiSelect={() => {
              setMultiSelect((value) => !value);
              setSelectedEpisode(null);
              setSelectedIds(new Set());
            }}
            onToggleEpisode={(episodeId) => {
              setSelectedIds((prev) => {
                const next = new Set(prev);
                if (next.has(episodeId)) next.delete(episodeId);
                else next.add(episodeId);
                return next;
              });
            }}
            onSelectAll={() => {
              setSelectedIds(new Set(seasonEpisodes.map((episode) => episode.id)));
            }}
            onClearSelection={() => setSelectedIds(new Set())}
            onPresetChange={setBatchPreset}
            onOverwriteChange={setBatchOverwrite}
            onQueueSelected={() => void handleQueueSelected()}
            onBack={() => {
              setSelectedSeason(null);
              setSelectedEpisode(null);
              setMultiSelect(false);
              setSelectedIds(new Set());
            }}
          />
        )}
      </section>

      {selectedEpisode && !multiSelect && !converting && !showSummary && (
        <TvConvertPanel
          episode={selectedEpisode}
          agentOnline={agentOnline}
          outputWritable={agentHealth.tvOutputWritable}
          converting={converting}
          onConvert={(overwrite, preset, tuning) =>
            void handleConvert(overwrite, preset, tuning)
          }
          onClear={() => setSelectedEpisode(null)}
        />
      )}

      {activeJob && converting && (
        <ConversionProgress job={activeJob} onCancel={() => void handleCancel()} />
      )}

      {activeJob && showSummary && (
        <ConversionSummary
          job={activeJob}
          onConvertAnother={handleConvertAnother}
        />
      )}

      <ConversionHistory
        jobs={history}
        onRemove={removeHistoryEntry}
        onClearAll={clearHistory}
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
