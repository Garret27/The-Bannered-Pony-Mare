"use client";

import { formatBytes } from "@/lib/format";
import type { ConversionJob } from "@/lib/converter-agent";
import styles from "./Movies.module.css";

function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m ${s}s`;
  }
  return `${m}m ${s}s`;
}

type ConversionSummaryProps = {
  job: ConversionJob;
  onConvertAnother: () => void;
};

export function ConversionSummary({
  job,
  onConvertAnother,
}: ConversionSummaryProps) {
  const success = job.status === "done";

  const copyPath = async () => {
    if (!job.outputPath) return;
    try {
      await navigator.clipboard.writeText(job.outputPath);
    } catch {
      // ignore
    }
  };

  const openFolder = async () => {
    await fetch(`/api/movies/convert/${encodeURIComponent(job.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "open-folder" }),
    });
  };

  return (
    <section
      className={`${styles.panel} ${styles.summaryCard} ${success ? styles.summarySuccess : styles.summaryFailed}`}
    >
      <h2 className={styles.summaryTitle}>
        {success ? "Conversion complete" : "Conversion failed"}
      </h2>
      <p className={styles.metaValue} style={{ marginBottom: "0.75rem" }}>
        {job.title}
      </p>

      {job.outputPath && (
        <div className={styles.metaItem} style={{ marginBottom: "0.5rem" }}>
          <span className={styles.metaLabel}>Output</span>
          <span className={styles.metaValue}>{job.outputPath}</span>
        </div>
      )}

      {job.bytesSaved != null && job.bytesSaved > 0 && (
        <div className={styles.metaItem} style={{ marginBottom: "0.5rem" }}>
          <span className={styles.metaLabel}>Space saved</span>
          <span className={styles.metaValue}>{formatBytes(job.bytesSaved)}</span>
        </div>
      )}

      <div className={styles.metaGrid}>
        {job.outputSizeBytes !== null && job.outputSizeBytes !== undefined && (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>File size</span>
            <span className={styles.metaValue}>
              {formatBytes(job.outputSizeBytes)}
            </span>
          </div>
        )}
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Encode time</span>
          <span className={styles.metaValue}>
            {formatElapsed(job.elapsedSec)}
          </span>
        </div>
      </div>

      {job.error && (
        <p className={styles.warning} style={{ marginTop: "0.75rem" }}>
          {job.error}
        </p>
      )}

      <div className={styles.actions} style={{ marginTop: "0.75rem" }}>
        {job.outputPath && (
          <button
            type="button"
            className={`${styles.button} ${styles.buttonSecondary}`}
            onClick={() => void copyPath()}
          >
            Copy path
          </button>
        )}
        {success && (
          <button
            type="button"
            className={`${styles.button} ${styles.buttonSecondary}`}
            onClick={() => void openFolder()}
          >
            Open output folder
          </button>
        )}
        <button
          type="button"
          className={styles.button}
          onClick={onConvertAnother}
        >
          Convert another
        </button>
      </div>
    </section>
  );
}
