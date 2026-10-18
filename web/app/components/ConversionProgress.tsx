"use client";

import { useEffect, useRef, useState } from "react";
import type { ConversionJob } from "@/lib/converter-agent";
import styles from "./Movies.module.css";

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

function formatFpsDisplay(fps: string | null | undefined): string {
  if (!fps) return "— fps";
  const value = Number.parseFloat(fps);
  if (!Number.isFinite(value) || value <= 0) return "— fps";
  return `${value.toFixed(1)} fps`;
}

function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

type ConversionProgressProps = {
  job: ConversionJob;
  onCancel: () => void;
};

export function ConversionProgress({ job, onCancel }: ConversionProgressProps) {
  const logRef = useRef<HTMLPreElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  useEffect(() => {
    if (!stickToBottom || !logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job.logLines, stickToBottom]);

  const handleLogScroll = () => {
    const el = logRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setStickToBottom(atBottom);
  };

  const isActive = job.status === "queued" || job.status === "running";

  const handleCancel = () => {
    if (
      window.confirm(
        "Stop encoding? The partial output file will be deleted.",
      )
    ) {
      onCancel();
    }
  };

  return (
    <section className={styles.panel}>
      <div className={styles.progressHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Conversion progress</h2>
          <p className={styles.metaValue}>{job.title}</p>
        </div>
        <span className={styles.statusBadge}>{job.status}</span>
      </div>

      <div className={styles.percentLarge}>{job.percent.toFixed(1)}%</div>
      <div className={styles.progressBar}>
        <div
          className={styles.progressFill}
          style={{ width: `${Math.min(100, job.percent)}%` }}
        />
      </div>

      <p className={styles.statsRow}>
        ETA {formatEtaDisplay(job.eta)} · {formatFpsDisplay(job.fps)} · Elapsed{" "}
        {formatElapsed(job.elapsedSec)}
      </p>

      <div className={styles.logPanel}>
        <pre
          ref={logRef}
          className={styles.logContent}
          onScroll={handleLogScroll}
        >
          {(job.logLines ?? []).join("\n") || "Waiting for HandBrake output…"}
        </pre>
        {!stickToBottom && (job.logLines?.length ?? 0) > 0 && (
          <button
            type="button"
            className={styles.jumpLatest}
            onClick={() => {
              setStickToBottom(true);
              if (logRef.current) {
                logRef.current.scrollTop = logRef.current.scrollHeight;
              }
            }}
          >
            Jump to latest
          </button>
        )}
      </div>

      {isActive && (
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonDanger}`}
            onClick={handleCancel}
          >
            Cancel conversion
          </button>
        </div>
      )}
    </section>
  );
}
