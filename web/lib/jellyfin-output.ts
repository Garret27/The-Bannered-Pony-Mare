import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { getSettingsSync } from "./settings";

export type JellyfinOutputFile = {
  title: string;
  relativePath: string;
  filename: string;
  sizeBytes: number;
  fullPath: string;
  modifiedAt: string;
};

export function getJellyfinOutputDir(): string {
  const label =
    getSettingsSync().converter.jellyfinOutputLabel.trim() ||
    "J:\\Movies J Drive - Jellyfin";

  if (label.startsWith("/")) {
    return label;
  }

  if (process.env.DATA_ROOT === "/data") {
    const folderName = label.replace(/^[A-Za-z]:[\\/]/, "").replace(/\\/g, "/");
    return path.posix.join("/movies-j", folderName);
  }

  if (label.includes(":") || label.includes("\\")) {
    return label;
  }

  return path.join(process.cwd(), label);
}

export function resolveJellyfinOutputPath(relativePath: string): string {
  const root = getJellyfinOutputDir();
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const full = path.resolve(root, normalized);
  const rootResolved = path.resolve(root);

  if (full !== rootResolved && !full.startsWith(`${rootResolved}${path.sep}`)) {
    throw new Error("Invalid jellyfin path");
  }

  return full;
}

export async function scanJellyfinOutputLibrary(): Promise<JellyfinOutputFile[]> {
  const root = getJellyfinOutputDir();
  const results: JellyfinOutputFile[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".mp4")) {
        continue;
      }

      const relativePath = path.relative(root, fullPath).replace(/\\/g, "/");
      const stat = await fsPromises.stat(fullPath).catch(() => null);
      results.push({
        title: path.basename(path.dirname(fullPath)),
        relativePath,
        filename: entry.name,
        sizeBytes: stat?.size ?? 0,
        fullPath,
        modifiedAt: stat?.mtime.toISOString() ?? "",
      });
    }
  }

  if (fs.existsSync(root)) {
    await walk(root);
  }

  return results;
}

export async function checkJellyfinOutputAccess(): Promise<{
  ok: boolean;
  path: string;
  error?: string;
}> {
  const outputPath = getJellyfinOutputDir();
  try {
    await fsPromises.access(outputPath, fs.constants.R_OK);
    return { ok: true, path: outputPath };
  } catch {
    return {
      ok: false,
      path: outputPath,
      error: "Jellyfin output folder is not readable",
    };
  }
}
