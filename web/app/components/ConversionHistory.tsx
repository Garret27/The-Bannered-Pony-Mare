"use client";

import { useState } from "react";
import { formatBytes } from "@/lib/format";
import type { ConversionJob } from "@/lib/converter-agent";
import { SubtitleApplyPanel } from "./SubtitleApplyPanel";
import styles from "./Movies.module.css";

type ConversionHistoryProps = {
  jobs: ConversionJob[];
  onRemove?: (jobId: string) => void | Promise<void>;
  onClearAll?: () => void | Promise<void>;
};

export function ConversionHistory({
  jobs,
  onRemove,
  onClearAll,
}: ConversionHistoryProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [subtitleMessage, setSubtitleMessage] = useState<string | null>(null);

  const handleRemove = async (jobId: string) => {
    if (!onRemove) return;
    setRemovingId(jobId);
    try {
      await onRemove(jobId);
    } finally {
      setRemovingId(null);
    }
  };

  if (jobs.length === 0) {
    return (
      <section className={styles.panel}>
        <h2 className={styles.sectionTitle}>Recent conversions</h2>
        <p className={styles.empty}>No conversions in history yet.</p>
      </section>
    );
  }

  return (
    <section className={styles.panel}>
      <div className={styles.historyHeading}>
        <h2 className={styles.sectionTitle}>Recent conversions</h2>
        {onClearAll && jobs.length > 0 && (
          <button
            type="button"
            className={`${styles.button} ${styles.buttonSecondary}`}
            style={{ padding: "0.25rem 0.625rem", fontSize: "0.75rem" }}
            onClick={() => void onClearAll()}
          >
            Clear all
          </button>
        )}
      </div>
      {subtitleMessage && (
        <p className={styles.presetHint} style={{ marginBottom: "0.75rem" }}>
          {subtitleMessage}
        </p>
      )}
      <div className={styles.historyList}>
        {jobs.map((job) => (
          <div key={job.id} className={styles.historyRow}>
            <div className={styles.historyHeader}>
              <span className={styles.historyTitle}>{job.title}</span>
              <div className={styles.historyHeaderActions}>
                <span className={styles.statusBadge}>{job.status}</span>
                {onRemove && job.status !== "running" && job.status !== "queued" && (
                  <button
                    type="button"
                    className={styles.historyRemoveBtn}
                    disabled={removingId === job.id}
                    aria-label={`Remove ${job.title} from history`}
                    title="Remove from history"
                    onClick={() => void handleRemove(job.id)}
                  >
                    {removingId === job.id ? "…" : "×"}
                  </button>
                )}
              </div>
            </div>
            <p className={styles.historyMeta}>
              {job.outputPath ?? "—"}
              {job.outputSizeBytes
                ? ` · ${formatBytes(job.outputSizeBytes)}`
                : ""}
              {job.elapsedSec ? ` · ${Math.round(job.elapsedSec)}s` : ""}
            </p>
            {job.status === "failed" && job.error && (
              <>
                <p className={styles.historyMeta} style={{ marginTop: "0.25rem" }}>
                  {job.error}
                </p>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  style={{
                    marginTop: "0.375rem",
                    padding: "0.25rem 0.5rem",
                    fontSize: "0.75rem",
                  }}
                  onClick={() =>
                    setExpandedId(expandedId === job.id ? null : job.id)
                  }
                >
                  {expandedId === job.id ? "Hide log" : "Show log"}
                </button>
                {expandedId === job.id && job.logLines && (
                  <pre
                    className={styles.logContent}
                    style={{
                      marginTop: "0.5rem",
                      maxHeight: "120px",
                      overflow: "auto",
                    }}
                  >
                    {job.logLines.slice(-20).join("\n")}
                  </pre>
                )}
              </>
            )}
            {job.outputPath && job.status === "done" && (
              <div className={styles.historyActions}>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                  onClick={() =>
                    void navigator.clipboard.writeText(job.outputPath!)
                  }
                >
                  Copy path
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                  onClick={() =>
                    void fetch(
                      `/api/movies/convert/${encodeURIComponent(job.id)}`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "open-folder" }),
                      },
                    )
                  }
                >
                  Open folder
                </button>
              </div>
            )}
            {job.status === "done" &&
              (job.remoteSourcePath ||
                (job.sourcePath && !job.sourcePath.startsWith("/work/"))) && (
              <SubtitleApplyPanel
                // Sidecars live next to the original source, not the converted output.
                videoPath={job.remoteSourcePath || job.sourcePath}
                compact
                onApplied={(message) => {
                  setSubtitleMessage(message);
                  window.setTimeout(() => setSubtitleMessage(null), 4000);
                }}
                onError={(message) => {
                  setSubtitleMessage(message);
                  window.setTimeout(() => setSubtitleMessage(null), 4000);
                }}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
