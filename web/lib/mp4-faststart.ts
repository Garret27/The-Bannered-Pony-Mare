import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Always remux for CDN — moves the moov atom to the start so seeking/range requests work. */
export async function remuxMp4Faststart(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    { timeout: 2 * 60 * 60 * 1000 },
  );
}

export async function prepareMp4UploadFromPath(
  sourcePath: string,
): Promise<{ uploadPath: string; cleanup: () => Promise<void>; remuxed: boolean }> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cdn-upload-"));
  const outputPath = path.join(tmpDir, `faststart-${path.basename(sourcePath)}`);
  await remuxMp4Faststart(sourcePath, outputPath);

  return {
    uploadPath: outputPath,
    remuxed: true,
    cleanup: async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

export async function prepareMp4UploadFromFile(
  file: File,
): Promise<{ uploadPath: string; cleanup: () => Promise<void>; remuxed: boolean }> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cdn-upload-"));
  const inputPath = path.join(tmpDir, file.name);
  const outputPath = path.join(tmpDir, `faststart-${file.name}`);

  await fs.writeFile(inputPath, Buffer.from(await file.arrayBuffer()));
  await remuxMp4Faststart(inputPath, outputPath);
  await fs.rm(inputPath, { force: true });

  return {
    uploadPath: outputPath,
    remuxed: true,
    cleanup: async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}
