"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ConversionJob } from "@/lib/converter-agent";
import styles from "./ConverterAgentMenu.module.css";

type AgentStateResponse = {
  reachable?: boolean;
  enabled?: boolean;
  ok?: boolean;
  moviesReady?: boolean;
  tvReady?: boolean;
  replaceReady?: boolean;
  nvencAvailable?: boolean;
  disabledReason?: string | null;
  activeJobId?: string | null;
  error?: string;
};

type StatusKind = "online" | "degraded" | "disabled" | "offline" | "gpu";

type CompletedUnread = {
  jobId: string;
  title: string;
  finishedAt: string;
};

const COMPLETED_STORAGE_KEY = "converter-agent-completed-unread";
const COMPLETED_TTL_MS = 10 * 60 * 1000;

function deriveStatus(data: AgentStateResponse | null): StatusKind {
  if (!data?.reachable) return "offline";
  if (!data.enabled) return "disabled";
  // Lightning = power/on state. Green when enabled; amber if mounts/GPU block work.
  if (data.ok) return "online";
  if (data.nvencAvailable === false) return "gpu";
  return "degraded";
}

function statusLabel(kind: StatusKind): string {
  switch (kind) {
    case "online":
      return "On";
    case "degraded":
      return "On (drives issue)";
    case "disabled":
      return "Off";
    case "gpu":
      return "GPU unavailable";
    default:
      return "Offline";
  }
}

function formatEtaDisplay(eta: string | null): string {
  if (!eta) return "—:—:—";
  const hb = eta.match(/^(\d+)h(\d+)m(\d+)s$/);
  if (hb) {
    const hours = Number(hb[1]);
    const minutes = Number(hb[2]);
    const seconds = Number(hb[3]);
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return eta;
}

function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function readCompletedUnread(): CompletedUnread | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(COMPLETED_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CompletedUnread;
    if (
      typeof parsed?.jobId !== "string" ||
      typeof parsed?.finishedAt !== "string" ||
      typeof parsed?.title !== "string"
    ) {
      return null;
    }
    const age = Date.now() - new Date(parsed.finishedAt).getTime();
    if (!Number.isFinite(age) || age >= COMPLETED_TTL_MS) {
      localStorage.removeItem(COMPLETED_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCompletedUnread(value: CompletedUnread | null) {
  if (typeof window === "undefined") return;
  if (!value) {
    localStorage.removeItem(COMPLETED_STORAGE_KEY);
    return;
  }
  localStorage.setItem(COMPLETED_STORAGE_KEY, JSON.stringify(value));
}

export function ConverterAgentMenu() {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const trackedJobIdRef = useRef<string | null>(null);
  const completedUnreadRef = useRef<CompletedUnread | null>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<AgentStateResponse | null>(null);
  const [job, setJob] = useState<ConversionJob | null>(null);
  const [completedUnread, setCompletedUnread] = useState<CompletedUnread | null>(
    null,
  );
  const [sessionCompleted, setSessionCompleted] = useState<CompletedUnread | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const clearCompletedUnread = useCallback(() => {
    writeCompletedUnread(null);
    completedUnreadRef.current = null;
    setCompletedUnread(null);
  }, []);

  const markCompletedUnread = useCallback((next: CompletedUnread) => {
    writeCompletedUnread(next);
    completedUnreadRef.current = next;
    setCompletedUnread(next);
  }, []);

  const loadState = useCallback(async () => {
    try {
      const response = await fetch("/api/agent/state");
      const data = (await response.json()) as AgentStateResponse;
      setState({ ...data, reachable: response.ok || data.reachable === true });
      return data.activeJobId ?? null;
    } catch {
      setState({ reachable: false, ok: false, enabled: false });
      return null;
    }
  }, []);

  const loadJob = useCallback(
    async (jobId: string) => {
      try {
        const response = await fetch(
          `/api/movies/convert/${encodeURIComponent(jobId)}`,
        );
        if (!response.ok) {
          if (response.status === 404) {
            setJob(null);
            trackedJobIdRef.current = null;
          }
          return null;
        }
        const data = (await response.json()) as ConversionJob;
        setJob(data);
        trackedJobIdRef.current = data.id;

        if (data.status === "done") {
          markCompletedUnread({
            jobId: data.id,
            title: data.title,
            finishedAt: data.finishedAt ?? new Date().toISOString(),
          });
          trackedJobIdRef.current = null;
        } else if (data.status === "failed" || data.status === "cancelled") {
          if (completedUnreadRef.current?.jobId === data.id) {
            clearCompletedUnread();
          }
          // Keep terminal job briefly so UI can settle, then drop active tracking.
          trackedJobIdRef.current = null;
        } else if (data.status === "queued" || data.status === "running") {
          if (
            completedUnreadRef.current &&
            completedUnreadRef.current.jobId !== data.id
          ) {
            clearCompletedUnread();
          }
        }

        return data;
      } catch {
        return null;
      }
    },
    [clearCompletedUnread, markCompletedUnread],
  );

  useEffect(() => {
    const stored = readCompletedUnread();
    completedUnreadRef.current = stored;
    setCompletedUnread(stored);
  }, []);

  useEffect(() => {
    void loadState();
    const interval = window.setInterval(() => void loadState(), 15_000);
    return () => window.clearInterval(interval);
  }, [loadState]);

  // When agent reports a new active job (or clears one we were tracking), sync.
  useEffect(() => {
    const activeJobId = state?.activeJobId ?? null;
    if (activeJobId) {
      trackedJobIdRef.current = activeJobId;
      void loadJob(activeJobId);
      return;
    }

    // activeJobId cleared — fetch one last time if we were tracking a job.
    const previous = trackedJobIdRef.current;
    if (previous) {
      void loadJob(previous).then((result) => {
        if (
          result &&
          (result.status === "queued" || result.status === "running")
        ) {
          return;
        }
        if (result?.status !== "done") {
          setJob((current) =>
            current &&
            (current.status === "queued" || current.status === "running")
              ? null
              : current,
          );
        }
      });
    }
  }, [loadJob, state?.activeJobId]);

  // Fast poll while a conversion is active.
  useEffect(() => {
    const active =
      Boolean(state?.activeJobId) ||
      job?.status === "queued" ||
      job?.status === "running";
    if (!active) return;

    const interval = window.setInterval(() => {
      const jobId = state?.activeJobId ?? trackedJobIdRef.current;
      if (jobId) void loadJob(jobId);
    }, 2_000);
    return () => window.clearInterval(interval);
  }, [job?.status, loadJob, state?.activeJobId]);

  // Expire completed-unread after 10 minutes.
  useEffect(() => {
    if (!completedUnread) return;

    const finishedMs = new Date(completedUnread.finishedAt).getTime();
    const remaining = COMPLETED_TTL_MS - (Date.now() - finishedMs);
    if (remaining <= 0) {
      clearCompletedUnread();
      return;
    }

    const timer = window.setTimeout(() => {
      clearCompletedUnread();
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [clearCompletedUnread, completedUnread]);

  useEffect(() => {
    if (!open) {
      setSessionCompleted(null);
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const runAction = async (action: "enable" | "disable" | "reset") => {
    if (action === "reset") {
      const confirmed = window.confirm(
        "Reset the converter agent? This cancels any active job and clears session history.",
      );
      if (!confirmed) return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/agent/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json()) as AgentStateResponse;
      if (!response.ok) {
        throw new Error(data.error ?? "Agent control failed");
      }
      setState({ ...data, reachable: true });
      if (action === "reset") {
        setJob(null);
        trackedJobIdRef.current = null;
        clearCompletedUnread();
      }
      setMessage(
        action === "enable"
          ? "Converter turned on"
          : action === "disable"
            ? "Converter turned off"
            : "Converter reset",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Agent control failed",
      );
      await loadState();
    } finally {
      setLoading(false);
    }
  };

  const remountDrives = async () => {
    const confirmed = window.confirm(
      "Remount E/H/J drives and recreate the converter containers?\n\nUse this when Movies/TV show a drive permission error after reboot. The site may briefly disconnect.",
    );
    if (!confirmed) return;

    setLoading(true);
    setMessage("Remounting drives…");
    try {
      const response = await fetch("/api/stack/remount", { method: "POST" });
      const data = (await response.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Remount failed");
      }
      setMessage(
        data.message ??
          "Remount started. Waiting for the site to come back…",
      );

      // Containers recreate shortly after the helper responds — poll until ready.
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        try {
          const health = await fetch("/api/agent/state", { cache: "no-store" });
          if (health.ok) {
            await loadState();
            setMessage("Drives remounted and stack is back.");
            return;
          }
        } catch {
          // Still restarting.
        }
      }
      setMessage("Remount requested. Refresh the page if it is still reconnecting.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Remount failed",
      );
    } finally {
      setLoading(false);
    }
  };

  const status = deriveStatus(state);
  const label = statusLabel(status);
  const isJobActive =
    job?.status === "queued" || job?.status === "running";
  const showCompleted =
    Boolean(completedUnread) && !isJobActive && !state?.activeJobId;
  const showMiniProgress = isJobActive && job;
  const completedSummary = showCompleted
    ? completedUnread
    : open
      ? sessionCompleted
      : null;
  const showCompletedSummary = Boolean(completedSummary) && !showMiniProgress;

  const triggerClass = [
    styles.trigger,
    open ? styles.triggerOpen : "",
    isJobActive ? styles.triggerActive : "",
    showCompleted ? styles.triggerCompleted : "",
  ]
    .filter(Boolean)
    .join(" ");

  const handleTriggerClick = () => {
    if (showCompleted && completedUnread) {
      setSessionCompleted(completedUnread);
      clearCompletedUnread();
    }
    setOpen((value) => {
      const next = !value;
      if (!next) {
        setSessionCompleted(null);
      }
      return next;
    });
    setMessage(null);
    void loadState().then((activeJobId) => {
      if (activeJobId) {
        void loadJob(activeJobId);
      }
    });
  };

  const triggerLabel = isJobActive
    ? `Converter agent: converting ${job?.title ?? ""}`
    : showCompleted
      ? `Converter agent: conversion complete`
      : `Converter agent: ${label}`;

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={triggerClass}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        title={triggerLabel}
        aria-label={triggerLabel}
        onClick={handleTriggerClick}
      >
        {!isJobActive && !showCompleted && (
          <span
            className={`${styles.statusDot} ${styles[`status_${status}`]}`}
            aria-hidden="true"
          />
        )}
        <svg
          className={styles.icon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M13 2 4 14h7l-1 8 10-14h-7l1-6Z" />
        </svg>
        {isJobActive && (
          <span className={styles.shimmer} aria-hidden="true" />
        )}
      </button>

      {open && (
        <div
          id={panelId}
          className={styles.panel}
          role="dialog"
          aria-label="Converter agent controls"
        >
          <div className={styles.header}>
            <div>
              <p className={styles.title}>Converter</p>
              <p className={styles.subtitle}>HandBrake agent power controls</p>
            </div>
            <span className={styles.statusPill}>
              <span
                className={`${styles.statusDotInline} ${styles[`status_${status}`]}`}
                aria-hidden="true"
              />
              {label}
            </span>
          </div>

          {state?.disabledReason && status !== "online" && (
            <p className={styles.detail}>{state.disabledReason}</p>
          )}
          {state?.enabled && (
            <p className={styles.detail}>
              Movies: {state.moviesReady ? "ready" : "not ready"} · TV:{" "}
              {state.tvReady ? "ready" : "not ready"} · Space Saver:{" "}
              {state.replaceReady ? "ready" : "not ready"}
            </p>
          )}
          {!state?.reachable && (
            <p className={styles.detail}>
              Agent unreachable. Check Docker logs for converter-agent.
            </p>
          )}

          {showMiniProgress && job && (
            <div className={styles.miniProgress}>
              <div className={styles.miniProgressHeader}>
                <p className={styles.miniProgressLabel}>Conversion progress</p>
                <span className={styles.miniStatusBadge}>{job.status}</span>
              </div>
              <p className={styles.miniProgressTitle}>{job.title}</p>
              <p className={styles.miniPercent}>{job.percent.toFixed(1)}%</p>
              <div className={styles.miniProgressBar}>
                <div
                  className={styles.miniProgressFill}
                  style={{ width: `${Math.min(100, Math.max(0, job.percent))}%` }}
                />
              </div>
              <p className={styles.miniStats}>
                ETA {formatEtaDisplay(job.eta)} · Elapsed{" "}
                {formatElapsed(job.elapsedSec)}
              </p>
            </div>
          )}

          {showCompletedSummary && completedSummary && (
            <div className={styles.miniProgress}>
              <div className={styles.miniProgressHeader}>
                <p className={styles.miniProgressLabel}>Last conversion</p>
                <span
                  className={`${styles.miniStatusBadge} ${styles.miniStatusDone}`}
                >
                  done
                </span>
              </div>
              <p className={styles.miniProgressTitle}>{completedSummary.title}</p>
              <p className={styles.miniPercent}>100%</p>
              <div className={styles.miniProgressBar}>
                <div
                  className={`${styles.miniProgressFill} ${styles.miniProgressFillDone}`}
                  style={{ width: "100%" }}
                />
              </div>
            </div>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.button}
              disabled={loading || state?.enabled === true}
              onClick={() => void runAction("enable")}
            >
              Turn on
            </button>
            <button
              type="button"
              className={styles.button}
              disabled={loading || state?.enabled === false}
              onClick={() => void runAction("disable")}
            >
              Turn off
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.danger}`}
              disabled={loading}
              onClick={() => void runAction("reset")}
            >
              Reset agent
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.fullWidth}`}
              disabled={loading}
              title="Runs start-stack.ps1: remount E/H/J and recreate containers"
              onClick={() => void remountDrives()}
            >
              Remount drives
            </button>
          </div>

          {message && <p className={styles.message}>{message}</p>}

          <div className={styles.links}>
            <Link
              href="/settings"
              className={styles.link}
              onClick={() => setOpen(false)}
            >
              More converter settings
            </Link>
            <Link
              href="/movies"
              className={styles.link}
              onClick={() => setOpen(false)}
            >
              Conversion activity
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
