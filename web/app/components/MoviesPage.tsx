"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConversionJob, EncodingTuning } from "@/lib/converter-agent";
import type { MovieEntry } from "@/lib/movies-library";
import { ConversionHistory } from "./ConversionHistory";
import { ConversionProgress } from "./ConversionProgress";
import { ConversionSummary } from "./ConversionSummary";
import { MovieConvertPanel } from "./MovieConvertPanel";
import { MoviePicker } from "./MoviePicker";
import { Toast } from "./Toast";
import styles from "./Movies.module.css";

type AgentHealth = {
  ok: boolean;
  enabled?: boolean;
  moviesReady?: boolean;
  outputWritable: boolean;
  activeJobId?: string | null;
  error?: string;
  disabledReason?: string | null;
};

type ToastState = {
  message: string;
  type: "success" | "error";
} | null;

function moviesAgentLabel(health: AgentHealth): string {
  if (health.error && health.enabled === undefined) return "offline";
  if (health.enabled === false) return "disabled";
  if (health.moviesReady === true) return "online";
  if (health.enabled === true && health.outputWritable === false) {
    return "J drive issue";
  }
  return "offline";
}

export function MoviesPage() {
  const [selected, setSelected] = useState<MovieEntry | null>(null);
  const [activeJob, setActiveJob] = useState<ConversionJob | null>(null);
  const [history, setHistory] = useState<ConversionJob[]>([]);
  const [agentHealth, setAgentHealth] = useState<AgentHealth>({
    ok: false,
    outputWritable: false,
  });
  const [toast, setToast] = useState<ToastState>(null);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const loadHealth = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch("/api/movies/convert/health");
      const data = (await response.json()) as AgentHealth & {
        outputWritable?: boolean;
        moviesReady?: boolean;
        enabled?: boolean;
        activeJobId?: string | null;
        disabledReason?: string | null;
      };
      setAgentHealth({
        ok: data.ok === true,
        enabled: data.enabled === true,
        moviesReady: data.moviesReady === true,
        outputWritable: data.outputWritable === true,
        disabledReason: data.disabledReason,
        error: response.ok ? data.disabledReason ?? undefined : data.error,
      });
      return data.activeJobId ?? null;
    } catch {
      setAgentHealth({
        ok: false,
        moviesReady: false,
        outputWritable: false,
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
      setHistory((data.jobs ?? []).filter((job) => job.mode !== "tv"));
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
    const response = await fetch("/api/movies/convert/history", {
      method: "DELETE",
    });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      throw new Error(data.error ?? "Failed to clear history");
    }
    await loadHistory();
  }, [loadHistory]);

  const pollJob = useCallback(
    async (jobId: string) => {
      const response = await fetch(
        `/api/movies/convert/${encodeURIComponent(jobId)}`,
      );
      if (!response.ok) return null;
      return (await response.json()) as ConversionJob;
    },
    [],
  );

  const restoreActiveJob = useCallback(
    async (activeJobId: string | null) => {
      if (!activeJobId) return;

      const job = await pollJob(activeJobId);
      if (!job || job.mode === "tv") return;

      setActiveJob((current) => current ?? job);
    },
    [pollJob],
  );

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
    if (
      activeJob.status !== "queued" &&
      activeJob.status !== "running"
    ) {
      return;
    }

    const interval = window.setInterval(async () => {
      const updated = await pollJob(activeJob.id);
      if (!updated) return;
      setActiveJob(updated);
      if (
        updated.status === "done" ||
        updated.status === "failed" ||
        updated.status === "cancelled"
      ) {
        setHistory((prev) => {
          const filtered = prev.filter((j) => j.id !== updated.id);
          return [updated, ...filtered];
        });
        if (updated.status === "done") {
          showToast("Conversion complete", "success");
        } else if (updated.status === "failed") {
          showToast(updated.error ?? "Conversion failed", "error");
        }
      }
    }, 1500);

    return () => window.clearInterval(interval);
  }, [activeJob, pollJob, showToast]);

  const handleConvert = async (
    overwrite: boolean,
    preset: string,
    tuning?: EncodingTuning,
  ) => {
    if (!selected) return;

    try {
      const response = await fetch("/api/movies/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          movieId: selected.id,
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
      } else if (data.jobId) {
        const job = await pollJob(data.jobId);
        if (job) setActiveJob(job);
      }
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to start conversion",
        "error",
      );
    }
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

  const handleConvertAnother = () => {
    setActiveJob(null);
    setSelected(null);
  };

  const converting =
    activeJob?.status === "queued" || activeJob?.status === "running";

  const showSummary =
    activeJob &&
    (activeJob.status === "done" ||
      activeJob.status === "failed" ||
      activeJob.status === "cancelled");

  const agentLabel = moviesAgentLabel(agentHealth);
  const moviesReady = agentLabel === "online";
  const canConvert = moviesReady;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Movies</h1>
          <p>
            Browse your Jellyfin library and convert movies to Jellyfin on the
            J drive with HandBrake.
          </p>
        </div>
        <span
          className={`${styles.statusPill} ${moviesReady ? styles.statusOnline : styles.statusOffline}`}
          title={
            agentHealth.disabledReason ||
            agentHealth.error ||
            undefined
          }
        >
          <span className={styles.statusDot} />
          Agent {agentLabel}
        </span>
      </header>

      {!canConvert && (
        <div className={styles.banner}>
          {agentHealth.error === "Converter agent unreachable"
            ? "Converter agent is unreachable — check Docker for converter-agent."
            : agentHealth.enabled === false
              ? "Converter is turned off — use the lightning icon in the nav bar to turn it on."
              : agentLabel === "J drive issue"
                ? "Converter is on, but the J drive Jellyfin output is not writable right now."
                : "Converter is not ready for movie conversion — use the lightning icon in the nav bar."}
          {agentHealth.disabledReason &&
          agentHealth.error !== agentHealth.disabledReason
            ? ` (${agentHealth.disabledReason})`
            : agentHealth.error &&
                agentHealth.error !== "Converter agent unreachable"
              ? ` (${agentHealth.error})`
              : ""}
        </div>
      )}

      <section className={`${styles.panel} ${converting ? styles.panelDimmed : ""}`}>
        <MoviePicker
          onSelect={setSelected}
          selectedId={selected?.id}
        />
      </section>

      {selected && !converting && !showSummary && (
        <MovieConvertPanel
          movie={selected}
          agentOnline={canConvert}
          outputWritable={agentHealth.outputWritable}
          converting={converting}
          onConvert={(overwrite, preset, tuning) =>
            void handleConvert(overwrite, preset, tuning)
          }
          onClear={() => setSelected(null)}
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
