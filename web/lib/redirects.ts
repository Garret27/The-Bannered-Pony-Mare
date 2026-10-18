import fs from "fs/promises";
import { getRedirectsPath } from "./paths";
import { atomicWrite } from "./atomic-write";

export type RedirectEntry = {
  path: string;
  url: string;
  status: number;
};

export type RedirectsConfig = {
  main: RedirectEntry;
  hspc: RedirectEntry;
};

const KNOWN_PATHS = ["/main", "/hspc"] as const;

function parseLine(line: string): RedirectEntry | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length < 3) {
    return null;
  }

  const routePath = parts[0];
  const status = parseInt(parts[parts.length - 1], 10);
  const url = parts.slice(1, -1).join(" ");

  if (
    !KNOWN_PATHS.includes(routePath as (typeof KNOWN_PATHS)[number]) ||
    Number.isNaN(status)
  ) {
    return null;
  }

  return { path: routePath, url, status };
}

const DEFAULT_REDIRECTS: RedirectsConfig = {
  main: { path: "/main", url: "", status: 200 },
  hspc: { path: "/hspc", url: "", status: 301 },
};

export async function readRedirects(): Promise<RedirectsConfig> {
  const filePath = getRedirectsPath();

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const config: RedirectsConfig = {
      main: { ...DEFAULT_REDIRECTS.main },
      hspc: { ...DEFAULT_REDIRECTS.hspc },
    };

    for (const line of content.split("\n")) {
      const entry = parseLine(line);
      if (!entry) continue;
      if (entry.path === "/main") config.main = entry;
      if (entry.path === "/hspc") config.hspc = entry;
    }

    return config;
  } catch {
    return {
      main: { ...DEFAULT_REDIRECTS.main },
      hspc: { ...DEFAULT_REDIRECTS.hspc },
    };
  }
}

export async function writeRedirects(config: RedirectsConfig): Promise<void> {
  const lines = [
    `${config.main.path} ${config.main.url} ${config.main.status}`,
    `${config.hspc.path} ${config.hspc.url} ${config.hspc.status}`,
    "",
  ];

  await atomicWrite(getRedirectsPath(), lines.join("\n"));
}

export function validateRedirectsConfig(
  config: Partial<RedirectsConfig>,
): config is RedirectsConfig {
  if (!config.main || !config.hspc) return false;

  for (const entry of [config.main, config.hspc]) {
    if (!entry.url || typeof entry.url !== "string") return false;
    if (![200, 301, 302].includes(entry.status)) return false;
    try {
      new URL(entry.url);
    } catch {
      return false;
    }
  }

  return true;
}
