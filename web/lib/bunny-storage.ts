import { getSettingsSync } from "./settings";

export type BunnyStorageObject = {
  ObjectName: string;
  Length: number;
  LastChanged: string;
  IsDirectory: boolean;
  Path: string;
};

export type BunnyLibraryEntry = {
  filename: string;
  sizeBytes: number;
  lastChanged: string;
  cdnUrl: string;
};

const VIDEO_EXTENSIONS = new Set([".mp4", ".m4v", ".webm", ".mkv"]);

function getStorageZone(): string | null {
  return getSettingsSync().bunny.storageZone.trim() || null;
}

function getStoragePassword(): string | null {
  return getSettingsSync().bunny.storagePassword.trim() || null;
}

function getStorageHost(): string {
  const region = getSettingsSync().bunny.storageRegion.trim();
  if (region) {
    return region.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
  return "storage.bunnycdn.com";
}

export function getStoragePrefix(): string {
  const prefix = getSettingsSync().bunny.prefix.trim() || "Movies";
  return prefix.replace(/^\/+|\/+$/g, "");
}

export function getCdnHostname(): string {
  return getSettingsSync().bunny.cdnHostname.trim() || "GarretStorage.b-cdn.net";
}

export function isBunnyConfigured(): boolean {
  return Boolean(getStorageZone() && getStoragePassword());
}

function buildStorageUrl(relativePath: string): string {
  const zone = getStorageZone()!;
  const host = getStorageHost();
  const normalized = relativePath.replace(/^\/+/, "").replace(/\/+/g, "/");
  const segments = normalized.split("/").map(encodeURIComponent).join("/");
  return `https://${host}/${zone}/${segments}`;
}

export function buildCdnUrl(filename: string): string {
  const hostname = getCdnHostname().replace(/^https?:\/\//, "");
  const prefix = getStoragePrefix();
  const encoded = encodeURIComponent(filename).replace(/%2F/g, "/");
  return `https://${hostname}/${prefix}/${encoded}`;
}

function buildRemotePath(filename: string): string {
  const prefix = getStoragePrefix();
  return `${prefix}/${filename}`;
}

function isNodeReadableStream(body: BodyInit | null | undefined): boolean {
  return (
    body !== null &&
    body !== undefined &&
    typeof body === "object" &&
    "pipe" in body &&
    typeof (body as { pipe?: unknown }).pipe === "function"
  );
}

async function bunnyFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const password = getStoragePassword();
  if (!password) {
    throw new Error("Bunny storage is not configured");
  }

  const url = buildStorageUrl(path);
  const fetchInit: RequestInit & { duplex?: "half" } = {
    ...init,
    headers: {
      AccessKey: password,
      ...(init?.headers ?? {}),
    },
  };
  if (isNodeReadableStream(init?.body)) {
    fetchInit.duplex = "half";
  }

  return fetch(url, fetchInit);
}

export async function listMovies(): Promise<BunnyLibraryEntry[]> {
  const prefix = getStoragePrefix();
  const listPath = `${prefix}/`;

  const response = await bunnyFetch(listPath, { method: "GET" });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Bunny list failed (${response.status}): ${text}`);
  }

  const objects = (await response.json()) as BunnyStorageObject[];
  const entries: BunnyLibraryEntry[] = [];

  for (const obj of objects) {
    if (obj.IsDirectory) continue;
    const ext = obj.ObjectName.slice(obj.ObjectName.lastIndexOf(".")).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(ext)) continue;

    entries.push({
      filename: obj.ObjectName,
      sizeBytes: obj.Length,
      lastChanged: obj.LastChanged,
      cdnUrl: buildCdnUrl(obj.ObjectName),
    });
  }

  entries.sort((a, b) => a.filename.localeCompare(b.filename));
  return entries;
}

export async function fileExistsOnBunny(filename: string): Promise<boolean> {
  const remotePath = buildRemotePath(filename);
  const response = await bunnyFetch(remotePath, { method: "GET" });
  return response.ok;
}

export async function uploadFileToBunny(
  filename: string,
  body: BodyInit,
  sizeBytes?: number,
): Promise<{ cdnUrl: string }> {
  const remotePath = buildRemotePath(filename);
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
  };
  if (sizeBytes !== undefined) {
    headers["Content-Length"] = String(sizeBytes);
  }

  const response = await bunnyFetch(remotePath, {
    method: "PUT",
    body,
    headers,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Bunny upload failed (${response.status}): ${text}`);
  }

  return { cdnUrl: buildCdnUrl(filename) };
}

const SAFE_FILENAME_RE = /^[^/\\]+\.(mp4|m4v|webm|mkv)$/i;

export function isSafeBunnyFilename(filename: string): boolean {
  return SAFE_FILENAME_RE.test(filename.trim());
}

export async function deleteFileFromBunny(filename: string): Promise<void> {
  if (!isSafeBunnyFilename(filename)) {
    throw new Error("Invalid filename");
  }

  const remotePath = buildRemotePath(filename);
  const response = await bunnyFetch(remotePath, { method: "DELETE" });

  if (!response.ok && response.status !== 404) {
    const text = await response.text().catch(() => "");
    throw new Error(`Bunny delete failed (${response.status}): ${text}`);
  }
}

export async function checkBunnyHealth(): Promise<{
  ok: boolean;
  configured: boolean;
  error?: string;
}> {
  if (!isBunnyConfigured()) {
    return { ok: false, configured: false, error: "Bunny credentials not configured" };
  }

  try {
    await listMovies();
    return { ok: true, configured: true };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : "Bunny API unreachable",
    };
  }
}
