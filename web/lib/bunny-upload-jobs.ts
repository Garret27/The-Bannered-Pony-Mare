import fs from "fs/promises";
import { randomUUID } from "crypto";
import {
  buildCdnUrl,
  fileExistsOnBunny,
  uploadFileToBunny,
} from "./bunny-storage";
import { resolveJellyfinOutputPath } from "./jellyfin-output";
import { prepareMp4UploadFromPath } from "./mp4-faststart";
import { createCountingReadStream } from "./stream-upload";

export type BunnyUploadJob = {
  id: string;
  filename: string;
  relativePath: string;
  sourcePath: string;
  status: "queued" | "running" | "done" | "failed";
  percent: number;
  bytesSent: number;
  totalBytes: number;
  elapsedSec: number;
  cdnUrl: string | null;
  error: string | null;
  logLines?: string[];
};

const jobs = new Map<string, BunnyUploadJob>();
let activeJobId: string | null = null;

function appendLog(job: BunnyUploadJob, line: string): void {
  if (!job.logLines) {
    job.logLines = [];
  }
  job.logLines.push(line);
  if (job.logLines.length > 200) {
    job.logLines = job.logLines.slice(-200);
  }
}

async function acquireWorkerSlot(jobId: string): Promise<void> {
  while (activeJobId !== null && activeJobId !== jobId) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  activeJobId = jobId;
}

function releaseWorkerSlot(jobId: string): void {
  if (activeJobId === jobId) {
    activeJobId = null;
  }
}

async function runUpload(jobId: string, overwrite: boolean): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  await acquireWorkerSlot(jobId);
  const startedAt = Date.now();
  let cleanup: (() => Promise<void>) | null = null;

  try {
    job.status = "running";
    appendLog(job, `Uploading ${job.filename} to Bunny`);

    if (!overwrite && (await fileExistsOnBunny(job.filename))) {
      throw new Error(`File already exists on Bunny: ${job.filename}`);
    }

    appendLog(job, "Optimizing MP4 for streaming (faststart)…");
    const prepared = await prepareMp4UploadFromPath(job.sourcePath);
    cleanup = prepared.cleanup;
    const stat = await fs.stat(prepared.uploadPath);
    job.totalBytes = stat.size;
    job.bytesSent = 0;
    job.percent = 0;

    const uploadStream = createCountingReadStream(prepared.uploadPath, (bytesSent) => {
      job.bytesSent = bytesSent;
      if (job.totalBytes > 0) {
        job.percent = Math.min(99.9, (bytesSent / job.totalBytes) * 100);
      }
      job.elapsedSec = (Date.now() - startedAt) / 1000;
    });

    const { cdnUrl } = await uploadFileToBunny(
      job.filename,
      uploadStream as unknown as BodyInit,
      stat.size,
    );

    job.status = "done";
    job.percent = 100;
    job.bytesSent = job.totalBytes;
    job.cdnUrl = cdnUrl;
    job.elapsedSec = (Date.now() - startedAt) / 1000;
    appendLog(job, `SUCCESS: ${cdnUrl}`);
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "Upload failed";
    job.elapsedSec = (Date.now() - startedAt) / 1000;
    appendLog(job, `ERROR: ${job.error}`);
  } finally {
    if (cleanup) {
      await cleanup().catch(() => {});
    }
    releaseWorkerSlot(jobId);
  }
}

export function getBunnyUploadJob(jobId: string): BunnyUploadJob | null {
  return jobs.get(jobId) ?? null;
}

export async function createBunnyUploadJob(body: {
  relativePath: string;
  overwrite?: boolean;
}): Promise<BunnyUploadJob> {
  const sourcePath = resolveJellyfinOutputPath(body.relativePath);
  const stat = await fs.stat(sourcePath).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error(`Source file not found: ${sourcePath}`);
  }

  const filename = sourcePath.split(/[/\\]/).pop() ?? "upload.mp4";
  const job: BunnyUploadJob = {
    id: randomUUID(),
    filename,
    relativePath: body.relativePath.replace(/\\/g, "/"),
    sourcePath,
    status: "queued",
    percent: 0,
    bytesSent: 0,
    totalBytes: stat.size,
    elapsedSec: 0,
    cdnUrl: buildCdnUrl(filename),
    error: null,
    logLines: [],
  };

  jobs.set(job.id, job);
  void runUpload(job.id, body.overwrite === true);
  return job;
}
