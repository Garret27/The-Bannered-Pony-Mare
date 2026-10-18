"use client";

import type { BunnyUploadJob } from "@/lib/bunny-upload-jobs";
import { formatBytes } from "@/lib/format";
import styles from "./Cdn.module.css";

type BunnyUploadProgressProps = {
  job: BunnyUploadJob;
  label?: string;
};

export function BunnyUploadProgress({ job, label }: BunnyUploadProgressProps) {
  const isActive = job.status === "queued" || job.status === "running";

  return (
    <section className={styles.panel}>
      <h2 className={styles.sectionTitle}>
        {label ?? "Upload progress"}
      </h2>
      <p className={styles.meta}>{job.filename}</p>

      <div className={styles.progressBar}>
        <div
          className={styles.progressFill}
          style={{ width: `${Math.min(100, job.percent)}%` }}
        />
      </div>

      <p className={styles.meta}>
        {job.percent.toFixed(1)}% · {formatBytes(job.bytesSent)} /{" "}
        {formatBytes(job.totalBytes)} · {job.status}
        {job.status === "queued" && job.bytesSent === 0 && (
          <> · waiting for upload slot</>
        )}
      </p>

      {job.status === "done" && job.cdnUrl && (
        <p className={styles.meta} style={{ marginTop: "0.5rem", color: "#86efac" }}>
          Upload complete — {job.cdnUrl}
        </p>
      )}

      {!isActive && job.error && (
        <p className={styles.warning}>{job.error}</p>
      )}
    </section>
  );
}
