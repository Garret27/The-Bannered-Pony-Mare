"use client";

import styles from "./OcrProgress.module.css";

export type OcrJobView = {
  id: string;
  status: "running" | "done" | "error";
  message: string;
  percent: number;
  current: number | null;
  total: number | null;
  fixes: number;
  error?: string;
  preview?: string;
  appliedMessage?: string;
};

export function OcrProgress({ job }: { job: OcrJobView }) {
  const percent = Math.max(0, Math.min(100, job.percent || 0));
  return (
    <div className={styles.wrap}>
      <p className={styles.message}>{job.message || "Reading subtitle images"}</p>
      <div className={styles.bar} aria-hidden="true">
        <div className={styles.fill} style={{ width: `${percent}%` }} />
      </div>
      <p className={styles.percent}>{percent.toFixed(0)}%</p>
    </div>
  );
}

export async function pollOcrJob(
  jobId: string,
  onUpdate: (job: OcrJobView) => void,
  isCancelled?: () => boolean,
): Promise<OcrJobView> {
  for (;;) {
    if (isCancelled?.()) {
      throw new Error("OCR cancelled");
    }
    const response = await fetch(`/api/subtitles/ocr/${encodeURIComponent(jobId)}`);
    const data = (await response.json()) as OcrJobView & { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "OCR job not found");
    }
    onUpdate(data);
    if (data.status === "done" || data.status === "error") return data;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
}
