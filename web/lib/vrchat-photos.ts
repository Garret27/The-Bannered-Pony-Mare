import fs from "fs/promises";
import path from "path";
import { getSettingsSync } from "./settings";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export type VrchatPhoto = {
  id: string;
  filename: string;
  relativePath: string;
  modifiedAt: string;
  imageUrl: string;
};

export class VrchatPhotosConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VrchatPhotosConfigError";
  }
}

export class VrchatPhotoNotFoundError extends Error {
  constructor(message = "Photo not found") {
    super(message);
    this.name = "VrchatPhotoNotFoundError";
  }
}

export function getVrchatPhotosDir(): string {
  const dir = getSettingsSync().vrchat.photosDir.trim();
  if (!dir) {
    throw new VrchatPhotosConfigError(
      "VRChat photos directory is not configured. Set it in Settings and save.",
    );
  }
  return path.resolve(dir);
}

export async function isVrchatPhotosDirConfigured(): Promise<boolean> {
  try {
    const dir = getVrchatPhotosDir();
    await fs.access(dir);
    return true;
  } catch {
    return false;
  }
}

export function encodePhotoId(relativePath: string): string {
  return Buffer.from(relativePath, "utf-8").toString("base64url");
}

export function decodePhotoId(id: string): string {
  try {
    return Buffer.from(id, "base64url").toString("utf-8");
  } catch {
    throw new VrchatPhotoNotFoundError("Invalid photo ID");
  }
}

export function getImageMime(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

export function resolvePhotoById(id: string): { absolutePath: string; relativePath: string } {
  const root = getVrchatPhotosDir();
  const relativePath = decodePhotoId(id).replace(/\\/g, "/");
  const normalizedRelative = path.normalize(relativePath);

  if (
    normalizedRelative.startsWith("..") ||
    path.isAbsolute(normalizedRelative)
  ) {
    throw new VrchatPhotoNotFoundError("Invalid photo path");
  }

  const absolutePath = path.resolve(root, normalizedRelative);
  const resolvedRoot = path.resolve(root);

  if (
    absolutePath !== resolvedRoot &&
    !absolutePath.startsWith(resolvedRoot + path.sep)
  ) {
    throw new VrchatPhotoNotFoundError("Invalid photo path");
  }

  if (!isImageFile(absolutePath)) {
    throw new VrchatPhotoNotFoundError("Invalid photo file type");
  }

  return { absolutePath, relativePath: normalizedRelative };
}

async function walkImages(
  dir: string,
  root: string,
  results: Array<{ relativePath: string; modifiedAt: Date }>,
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walkImages(fullPath, root, results);
      continue;
    }

    if (!entry.isFile() || !isImageFile(entry.name)) {
      continue;
    }

    try {
      const stat = await fs.stat(fullPath);
      results.push({
        relativePath: path.relative(root, fullPath),
        modifiedAt: stat.mtime,
      });
    } catch {
      // Skip unreadable files
    }
  }
}

export async function listRecentPhotos(limit = 20): Promise<VrchatPhoto[]> {
  const root = getVrchatPhotosDir();
  await fs.access(root);

  const found: Array<{ relativePath: string; modifiedAt: Date }> = [];
  await walkImages(root, root, found);

  found.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

  return found.slice(0, limit).map((item) => {
    const id = encodePhotoId(item.relativePath);
    return {
      id,
      filename: path.basename(item.relativePath),
      relativePath: item.relativePath,
      modifiedAt: item.modifiedAt.toISOString(),
      imageUrl: `/api/movie-picture/${id}/image`,
    };
  });
}

export async function readPhotoBuffer(id: string): Promise<{
  buffer: Buffer;
  filename: string;
  mime: string;
}> {
  const { absolutePath } = resolvePhotoById(id);
  const buffer = await fs.readFile(absolutePath);
  const filename = path.basename(absolutePath);
  return {
    buffer,
    filename,
    mime: getImageMime(filename),
  };
}
