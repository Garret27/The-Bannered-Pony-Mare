import { spawn } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { atomicWrite } from "@/lib/atomic-write";
import { fixLookalikeLetters } from "@/lib/ocr-cleanup";
import { getSubtitleFilename, getSubtitlePath, isEvent } from "@/lib/paths";

const WORK_ROOT = path.join("/tmp", "movie-night-ocr");
const SCRIPT_PATH = path.join(process.cwd(), "scripts", "ocr_bitmap.py");

export type OcrPhase = "copy" | "read" | "fix" | "write";

export type OcrJob = {
  id: string;
  status: "running" | "done" | "error";
  phase: OcrPhase;
  message: string;
  percent: number;
  current: number | null;
  total: number | null;
  fixes: number;
  error?: string;
  preview?: string;
  appliedMessage?: string;
  filename?: string;
  size?: number;
  modifiedAt?: string;
};

export type OcrRequest = {
  videoPath?: string;
  streamIndex?: number;
  codec?: string;
  sidecarPath?: string;
  sidecarFormat?: "pgs" | "vobsub";
  event?: string;
};

const jobs = new Map<string, OcrJob>();

export function getOcrJob(id: string): OcrJob | undefined {
  return jobs.get(id);
}

function bitmapKind(codec: string | undefined, format: string | undefined): "pgs" | "vobsub" {
  if (format === "vobsub" || codec === "dvd_subtitle") return "vobsub";
  return "pgs";
}

export function startOcrJob(request: OcrRequest): OcrJob {
  const job: OcrJob = {
    id: randomUUID(),
    status: "running",
    phase: "copy",
    message: "Copying subtitle images",
    percent: 2,
    current: null,
    total: null,
    fixes: 0,
  };
  jobs.set(job.id, job);
  void runOcrJob(job, request).catch((error: unknown) => {
    job.status = "error";
    job.error = error instanceof Error ? error.message : "OCR failed";
    job.message = job.error;
  });
  return job;
}

async function runOcrJob(job: OcrJob, request: OcrRequest): Promise<void> {
  const workDir = path.join(WORK_ROOT, job.id);
  await fs.mkdir(workDir, { recursive: true });
  try {
    const kind = bitmapKind(request.codec, request.sidecarFormat);
    const inputPath = await copyImages(job, request, workDir, kind);
    const rawPath = path.join(workDir, "raw.srt");
    await runOcrScript(job, kind, inputPath, rawPath);
    await finishSrt(job, rawPath, request.event);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function copyImages(
  job: OcrJob,
  request: OcrRequest,
  workDir: string,
  kind: "pgs" | "vobsub",
): Promise<string> {
  job.phase = "copy";
  job.message = "Copying subtitle images";
  job.percent = 4;

  if (request.sidecarPath) {
    if (kind === "pgs") {
      const target = path.join(workDir, "track.sup");
      await fs.copyFile(request.sidecarPath, target);
      job.percent = 10;
      return target;
    }
    const target = path.join(workDir, "track.idx");
    await fs.copyFile(request.sidecarPath, target);
    const subSource = request.sidecarPath.replace(/\.idx$/i, ".sub");
    await fs.copyFile(subSource, path.join(workDir, "track.sub"));
    job.percent = 10;
    return target;
  }

  if (!request.videoPath || request.streamIndex === undefined) {
    throw new Error("No subtitle stream to read");
  }

  if (kind === "pgs") {
    const target = path.join(workDir, "track.sup");
    await runProcess("ffmpeg", [
      "-y",
      "-nostdin",
      "-loglevel",
      "error",
      "-i",
      request.videoPath,
      "-map",
      `0:${request.streamIndex}`,
      "-c:s",
      "copy",
      target,
    ]);
    job.percent = 10;
    return target;
  }

  const target = path.join(workDir, "track.idx");
  await runProcess("mkvextract", [
    "tracks",
    request.videoPath,
    `${request.streamIndex}:${target}`,
  ]);
  job.percent = 10;
  return target;
}

function runProcess(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
  });
}

function runOcrScript(
  job: OcrJob,
  kind: "pgs" | "vobsub",
  inputPath: string,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [SCRIPT_PATH, kind, inputPath, outputPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        TESSDATA_PREFIX: "/usr/share/tessdata",
      },
    });
    let stderr = "";
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        applyProgress(job, line);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (buffer.trim()) applyProgress(job, buffer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || job.message || `OCR exited with ${code}`));
    });
  });
}

function applyProgress(job: OcrJob, line: string): void {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return;
  try {
    const payload = JSON.parse(trimmed) as {
      phase?: OcrPhase | "error";
      message?: string;
      percent?: number;
      current?: number;
      total?: number;
    };
    if (payload.phase === "error") {
      job.message = payload.message || job.message;
      return;
    }
    if (payload.phase === "copy" || payload.phase === "read") job.phase = payload.phase;
    if (payload.message) job.message = payload.message;
    if (typeof payload.percent === "number") {
      job.percent = Math.max(job.percent, Math.min(90, payload.percent));
    }
    if (typeof payload.current === "number") job.current = payload.current;
    if (typeof payload.total === "number") job.total = payload.total;
  } catch {
    // Ignore non-JSON log lines.
  }
}

async function finishSrt(job: OcrJob, rawPath: string, event: string | undefined): Promise<void> {
  job.phase = "fix";
  job.message = "Fixing lookalike letters";
  job.percent = 92;
  const raw = await fs.readFile(rawPath, "utf8");
  const { text, fixes } = fixLookalikeLetters(raw);
  job.fixes = fixes;
  job.message = `Fixed ${fixes} lookalike letter${fixes === 1 ? "" : "s"}`;
  job.percent = 96;

  job.phase = "write";
  job.message = "Writing the SRT";
  job.percent = 98;

  if (event && isEvent(event)) {
    const subtitlePath = getSubtitlePath(event);
    await atomicWrite(subtitlePath, text);
    const stat = await fs.stat(subtitlePath);
    job.filename = getSubtitleFilename(event);
    job.size = stat.size;
    job.modifiedAt = stat.mtime.toISOString();
    job.appliedMessage = "Subtitle extracted and applied";
  }

  job.preview = text.slice(0, 2000);
  job.percent = 100;
  job.status = "done";
  job.message = `Fixed ${fixes} lookalike letter${fixes === 1 ? "" : "s"}`;
}
