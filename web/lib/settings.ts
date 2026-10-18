import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { atomicWrite } from "./atomic-write";
import { getDataRoot, getSettingsPath } from "./paths";
import {
  defaultSettings,
  SECRET_MASK,
  SETTINGS_VERSION,
  type MovieNightSettings,
  type SettingsSection,
} from "./settings-types";

export {
  defaultSettings,
  SECRET_MASK,
  SETTINGS_VERSION,
  type MovieNightSettings,
  type SettingsSection,
} from "./settings-types";

const SECRET_PATHS: Array<[SettingsSection, string]> = [
  ["tmdb", "apiKey"],
  ["vrchat", "authCookie"],
  ["smb", "pass"],
  ["movies", "jellyfinApiKey"],
  ["opensubtitles", "apiKey"],
  ["opensubtitles", "password"],
  ["bunny", "storagePassword"],
  ["discord", "webhookMain"],
  ["discord", "webhookHspc"],
  ["github", "token"],
];

const RESTART_SECTIONS = new Set<SettingsSection>(["smb", "converter"]);

function envString(key: string, fallback = ""): string {
  return process.env[key]?.trim() || fallback;
}

function settingsFromEnv(): MovieNightSettings {
  const defaults = defaultSettings();
  return {
    version: SETTINGS_VERSION,
    tmdb: {
      apiKey: envString("TMDB_API_KEY"),
    },
    vrchat: {
      userAgent: envString("VRCHAT_USER_AGENT", defaults.vrchat.userAgent),
      authCookie: envString("VRCHAT_AUTH_COOKIE"),
      photosDir: envString("VRCHAT_PHOTOS_DIR", defaults.vrchat.photosDir),
    },
    smb: {
      user: envString("SMB_USER"),
      pass: envString("SMB_PASS"),
    },
    movies: {
      roots: envString("MOVIES_ROOTS", defaults.movies.roots),
      jellyfinUrl: envString("JELLYFIN_URL", defaults.movies.jellyfinUrl),
      jellyfinApiKey: envString("JELLYFIN_API_KEY"),
      jellyfinUserId: envString("JELLYFIN_USER_ID"),
      jellyfinPathEPrefix: envString("JELLYFIN_PATH_E_PREFIX"),
      jellyfinPathJPrefix: envString("JELLYFIN_PATH_J_PREFIX"),
      jellyfinPathHPrefix: envString(
        "JELLYFIN_PATH_H_PREFIX",
        defaults.movies.jellyfinPathHPrefix,
      ),
      jellyfinPathHJellyfinPrefix: envString(
        "JELLYFIN_PATH_H_JELLYFIN_PREFIX",
        defaults.movies.jellyfinPathHJellyfinPrefix,
      ),
    },
    opensubtitles: {
      apiKey: envString("OPENSUBTITLES_API_KEY"),
      username: envString("OPENSUBTITLES_USERNAME"),
      password: envString("OPENSUBTITLES_PASSWORD"),
    },
    bunny: {
      storageZone: envString("BUNNY_STORAGE_ZONE"),
      storagePassword: envString("BUNNY_STORAGE_PASSWORD"),
      storageRegion: envString(
        "BUNNY_STORAGE_REGION",
        defaults.bunny.storageRegion,
      ),
      cdnHostname: envString("BUNNY_CDN_HOSTNAME", defaults.bunny.cdnHostname),
      prefix: envString("BUNNY_STORAGE_PREFIX", defaults.bunny.prefix),
    },
    converter: {
      agentUrl: envString("CONVERTER_AGENT_URL", defaults.converter.agentUrl),
      handbrakeEncoder: envString(
        "HANDBRAKE_ENCODER",
        defaults.converter.handbrakeEncoder,
      ),
      jellyfinOutputLabel: envString(
        "JELLYFIN_OUTPUT_LABEL",
        defaults.converter.jellyfinOutputLabel,
      ),
      tvJellyfinOutputLabel: envString(
        "TV_JELLYFIN_OUTPUT_LABEL",
        defaults.converter.tvJellyfinOutputLabel,
      ),
    },
    discord: {
      webhookMain: envString("DISCORD_WEBHOOK_MAIN"),
      webhookHspc: envString("DISCORD_WEBHOOK_HSPC"),
      roleMain: envString("DISCORD_ROLE_MAIN"),
      roleHspc: envString("DISCORD_ROLE_HSPC"),
      announceTimeMain: envString(
        "DISCORD_ANNOUNCE_TIME_MAIN",
        envString("DISCORD_ANNOUNCE_TIME", defaults.discord.announceTimeMain),
      ),
      announceTimeHspc: envString(
        "DISCORD_ANNOUNCE_TIME_HSPC",
        defaults.discord.announceTimeHspc,
      ),
      announceTimezone: envString(
        "DISCORD_ANNOUNCE_TIMEZONE",
        defaults.discord.announceTimezone,
      ),
    },
    github: {
      token: envString("GITHUB_TOKEN"),
      owner: envString("GITHUB_OWNER", defaults.github.owner),
      repo: envString("GITHUB_REPO", defaults.github.repo),
      branch: envString("GITHUB_BRANCH", defaults.github.branch),
    },
  };
}

function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function mergeEnvIntoSettings(
  settings: MovieNightSettings,
  envMap: Record<string, string>,
): MovieNightSettings {
  const get = (key: string, fallback: string) =>
    envMap[key]?.trim() || fallback;

  return {
    ...settings,
    tmdb: { apiKey: get("TMDB_API_KEY", settings.tmdb.apiKey) },
    vrchat: {
      userAgent: get("VRCHAT_USER_AGENT", settings.vrchat.userAgent),
      authCookie: get("VRCHAT_AUTH_COOKIE", settings.vrchat.authCookie),
      photosDir: get("VRCHAT_PHOTOS_DIR", settings.vrchat.photosDir),
    },
    smb: {
      user: get("SMB_USER", settings.smb.user),
      pass: get("SMB_PASS", settings.smb.pass),
    },
    movies: {
      roots: get("MOVIES_ROOTS", settings.movies.roots),
      jellyfinUrl: get("JELLYFIN_URL", settings.movies.jellyfinUrl),
      jellyfinApiKey: get("JELLYFIN_API_KEY", settings.movies.jellyfinApiKey),
      jellyfinUserId: get("JELLYFIN_USER_ID", settings.movies.jellyfinUserId),
      jellyfinPathEPrefix: get(
        "JELLYFIN_PATH_E_PREFIX",
        settings.movies.jellyfinPathEPrefix,
      ),
      jellyfinPathJPrefix: get(
        "JELLYFIN_PATH_J_PREFIX",
        settings.movies.jellyfinPathJPrefix,
      ),
      jellyfinPathHPrefix: get(
        "JELLYFIN_PATH_H_PREFIX",
        settings.movies.jellyfinPathHPrefix,
      ),
      jellyfinPathHJellyfinPrefix: get(
        "JELLYFIN_PATH_H_JELLYFIN_PREFIX",
        settings.movies.jellyfinPathHJellyfinPrefix,
      ),
    },
    opensubtitles: {
      apiKey: get("OPENSUBTITLES_API_KEY", settings.opensubtitles.apiKey),
      username: get("OPENSUBTITLES_USERNAME", settings.opensubtitles.username),
      password: get("OPENSUBTITLES_PASSWORD", settings.opensubtitles.password),
    },
    bunny: {
      storageZone: get("BUNNY_STORAGE_ZONE", settings.bunny.storageZone),
      storagePassword: get(
        "BUNNY_STORAGE_PASSWORD",
        settings.bunny.storagePassword,
      ),
      storageRegion: get("BUNNY_STORAGE_REGION", settings.bunny.storageRegion),
      cdnHostname: get("BUNNY_CDN_HOSTNAME", settings.bunny.cdnHostname),
      prefix: get("BUNNY_STORAGE_PREFIX", settings.bunny.prefix),
    },
    converter: {
      agentUrl: get("CONVERTER_AGENT_URL", settings.converter.agentUrl),
      handbrakeEncoder: get(
        "HANDBRAKE_ENCODER",
        settings.converter.handbrakeEncoder,
      ),
      jellyfinOutputLabel: get(
        "JELLYFIN_OUTPUT_LABEL",
        settings.converter.jellyfinOutputLabel,
      ),
      tvJellyfinOutputLabel: get(
        "TV_JELLYFIN_OUTPUT_LABEL",
        settings.converter.tvJellyfinOutputLabel,
      ),
    },
    discord: {
      webhookMain: get("DISCORD_WEBHOOK_MAIN", settings.discord.webhookMain),
      webhookHspc: get("DISCORD_WEBHOOK_HSPC", settings.discord.webhookHspc),
      roleMain: get("DISCORD_ROLE_MAIN", settings.discord.roleMain),
      roleHspc: get("DISCORD_ROLE_HSPC", settings.discord.roleHspc),
      announceTimeMain: get(
        "DISCORD_ANNOUNCE_TIME_MAIN",
        get("DISCORD_ANNOUNCE_TIME", settings.discord.announceTimeMain),
      ),
      announceTimeHspc: get(
        "DISCORD_ANNOUNCE_TIME_HSPC",
        settings.discord.announceTimeHspc,
      ),
      announceTimezone: get(
        "DISCORD_ANNOUNCE_TIMEZONE",
        settings.discord.announceTimezone,
      ),
    },
    github: {
      token: get("GITHUB_TOKEN", settings.github.token),
      owner: get("GITHUB_OWNER", settings.github.owner),
      repo: get("GITHUB_REPO", settings.github.repo),
      branch: get("GITHUB_BRANCH", settings.github.branch),
    },
  };
}

function normalizeSettings(raw: unknown): MovieNightSettings {
  const defaults = defaultSettings();
  if (!raw || typeof raw !== "object") {
    return defaults;
  }

  const input = raw as Partial<MovieNightSettings>;
  const mergeSection = <K extends SettingsSection>(
    section: K,
    fallback: MovieNightSettings[K],
  ): MovieNightSettings[K] => {
    const value = input[section];
    if (!value || typeof value !== "object") {
      return fallback;
    }
    return { ...fallback, ...(value as MovieNightSettings[K]) };
  };

  const discord = mergeSection("discord", defaults.discord);
  // Drop legacy shared announceTime — per-event defaults (Main 17:00 / HSPC 18:00) apply.
  if ("announceTime" in (discord as Record<string, unknown>)) {
    delete (discord as Record<string, unknown>).announceTime;
  }

  return {
    version: SETTINGS_VERSION,
    tmdb: mergeSection("tmdb", defaults.tmdb),
    vrchat: mergeSection("vrchat", defaults.vrchat),
    smb: mergeSection("smb", defaults.smb),
    movies: mergeSection("movies", defaults.movies),
    opensubtitles: mergeSection("opensubtitles", defaults.opensubtitles),
    bunny: mergeSection("bunny", defaults.bunny),
    converter: mergeSection("converter", defaults.converter),
    discord,
    github: mergeSection("github", defaults.github),
  };
}

let settingsCache: MovieNightSettings | null = null;

export function clearSettingsCache(): void {
  settingsCache = null;
}

function getWebDotEnvPath(): string {
  // In Docker, DATA_ROOT=/data mounts the repo root — web/.env lives at /data/web/.env
  if (process.env.DATA_ROOT?.trim()) {
    return path.join(getDataRoot(), "web", ".env");
  }
  return path.join(process.cwd(), ".env");
}

function tryLoadDotEnvSync(): Record<string, string> {
  const paths = [
    getWebDotEnvPath(),
    path.join(process.cwd(), ".env"),
  ];
  for (const envPath of paths) {
    try {
      const content = fs.readFileSync(envPath, "utf-8");
      const parsed = parseDotEnv(content);
      if (Object.keys(parsed).length > 0) {
        return parsed;
      }
    } catch {
      continue;
    }
  }
  return {};
}

/** Fill empty JSON fields from web/.env without overwriting values already saved. */
function backfillEmptyFromEnv(
  settings: MovieNightSettings,
  envMap: Record<string, string>,
): MovieNightSettings {
  const pick = (envKey: string, current: string) =>
    current.trim() || envMap[envKey]?.trim() || current;

  return {
    ...settings,
    tmdb: { apiKey: pick("TMDB_API_KEY", settings.tmdb.apiKey) },
    vrchat: {
      userAgent: pick("VRCHAT_USER_AGENT", settings.vrchat.userAgent),
      authCookie: pick("VRCHAT_AUTH_COOKIE", settings.vrchat.authCookie),
      photosDir: pick("VRCHAT_PHOTOS_DIR", settings.vrchat.photosDir),
    },
    smb: {
      user: pick("SMB_USER", settings.smb.user),
      pass: pick("SMB_PASS", settings.smb.pass),
    },
    movies: {
      roots: pick("MOVIES_ROOTS", settings.movies.roots),
      jellyfinUrl: pick("JELLYFIN_URL", settings.movies.jellyfinUrl),
      jellyfinApiKey: pick("JELLYFIN_API_KEY", settings.movies.jellyfinApiKey),
      jellyfinUserId: pick("JELLYFIN_USER_ID", settings.movies.jellyfinUserId),
      jellyfinPathEPrefix: pick(
        "JELLYFIN_PATH_E_PREFIX",
        settings.movies.jellyfinPathEPrefix,
      ),
      jellyfinPathJPrefix: pick(
        "JELLYFIN_PATH_J_PREFIX",
        settings.movies.jellyfinPathJPrefix,
      ),
      jellyfinPathHPrefix: pick(
        "JELLYFIN_PATH_H_PREFIX",
        settings.movies.jellyfinPathHPrefix,
      ),
      jellyfinPathHJellyfinPrefix: pick(
        "JELLYFIN_PATH_H_JELLYFIN_PREFIX",
        settings.movies.jellyfinPathHJellyfinPrefix,
      ),
    },
    opensubtitles: {
      apiKey: pick("OPENSUBTITLES_API_KEY", settings.opensubtitles.apiKey),
      username: pick("OPENSUBTITLES_USERNAME", settings.opensubtitles.username),
      password: pick("OPENSUBTITLES_PASSWORD", settings.opensubtitles.password),
    },
    bunny: {
      storageZone: pick("BUNNY_STORAGE_ZONE", settings.bunny.storageZone),
      storagePassword: pick(
        "BUNNY_STORAGE_PASSWORD",
        settings.bunny.storagePassword,
      ),
      storageRegion: pick("BUNNY_STORAGE_REGION", settings.bunny.storageRegion),
      cdnHostname: pick("BUNNY_CDN_HOSTNAME", settings.bunny.cdnHostname),
      prefix: pick("BUNNY_STORAGE_PREFIX", settings.bunny.prefix),
    },
    converter: {
      agentUrl: pick("CONVERTER_AGENT_URL", settings.converter.agentUrl),
      handbrakeEncoder: pick(
        "HANDBRAKE_ENCODER",
        settings.converter.handbrakeEncoder,
      ),
      jellyfinOutputLabel: pick(
        "JELLYFIN_OUTPUT_LABEL",
        settings.converter.jellyfinOutputLabel,
      ),
      tvJellyfinOutputLabel: pick(
        "TV_JELLYFIN_OUTPUT_LABEL",
        settings.converter.tvJellyfinOutputLabel,
      ),
    },
    discord: {
      webhookMain: pick("DISCORD_WEBHOOK_MAIN", settings.discord.webhookMain),
      webhookHspc: pick("DISCORD_WEBHOOK_HSPC", settings.discord.webhookHspc),
      roleMain: pick("DISCORD_ROLE_MAIN", settings.discord.roleMain),
      roleHspc: pick("DISCORD_ROLE_HSPC", settings.discord.roleHspc),
      announceTimeMain: pick(
        "DISCORD_ANNOUNCE_TIME_MAIN",
        settings.discord.announceTimeMain,
      ),
      announceTimeHspc: pick(
        "DISCORD_ANNOUNCE_TIME_HSPC",
        settings.discord.announceTimeHspc,
      ),
      announceTimezone: pick(
        "DISCORD_ANNOUNCE_TIMEZONE",
        settings.discord.announceTimezone,
      ),
    },
    github: {
      token: pick("GITHUB_TOKEN", settings.github.token),
      owner: pick("GITHUB_OWNER", settings.github.owner),
      repo: pick("GITHUB_REPO", settings.github.repo),
      branch: pick("GITHUB_BRANCH", settings.github.branch),
    },
  };
}

function loadSettingsFromDiskSync(): MovieNightSettings {
  const filePath = getSettingsPath();
  const dotEnv = tryLoadDotEnvSync();
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = normalizeSettings(JSON.parse(content));
    return backfillEmptyFromEnv(parsed, dotEnv);
  } catch {
    let settings = settingsFromEnv();
    if (Object.keys(dotEnv).length > 0) {
      settings = mergeEnvIntoSettings(settings, dotEnv);
    }
    return settings;
  }
}

async function maybePersistBackfilled(settings: MovieNightSettings): Promise<void> {
  const filePath = getSettingsPath();
  try {
    const content = await fsPromises.readFile(filePath, "utf-8");
    const existing = normalizeSettings(JSON.parse(content));
    const dotEnv = tryLoadDotEnvSync();
    const backfilled = backfillEmptyFromEnv(existing, dotEnv);
    if (JSON.stringify(backfilled) !== JSON.stringify(existing)) {
      await atomicWrite(filePath, JSON.stringify(backfilled, null, 2));
      settingsCache = backfilled;
    }
  } catch {
    await atomicWrite(filePath, JSON.stringify(settings, null, 2));
  }
}

export function getSettingsSync(): MovieNightSettings {
  if (!settingsCache) {
    settingsCache = loadSettingsFromDiskSync();
  }
  return settingsCache;
}

export async function getSettings(): Promise<MovieNightSettings> {
  const settings = getSettingsSync();
  await maybePersistBackfilled(settings);
  return getSettingsSync();
}

export function maskSettings(settings: MovieNightSettings): MovieNightSettings {
  const masked = structuredClone(settings);
  for (const [section, key] of SECRET_PATHS) {
    const group = masked[section] as Record<string, string>;
    if (group[key]?.trim()) {
      group[key] = SECRET_MASK;
    }
  }
  return masked;
}

function isSecretPath(section: SettingsSection, key: string): boolean {
  return SECRET_PATHS.some(([s, k]) => s === section && k === key);
}

export function mergeSettingsUpdate(
  current: MovieNightSettings,
  incoming: Partial<MovieNightSettings>,
): MovieNightSettings {
  const merged = structuredClone(current);

  for (const section of Object.keys(incoming) as SettingsSection[]) {
    const patch = incoming[section];
    if (!patch || typeof patch !== "object") continue;

    const target = merged[section] as Record<string, string>;
    for (const [key, value] of Object.entries(patch)) {
      if (typeof value !== "string") continue;
      if (isSecretPath(section, key) && value === SECRET_MASK) {
        continue;
      }
      target[key] = value;
    }
  }

  merged.version = SETTINGS_VERSION;
  return merged;
}

export function settingsRequireRestart(
  before: MovieNightSettings,
  after: MovieNightSettings,
): boolean {
  for (const section of RESTART_SECTIONS) {
    if (JSON.stringify(before[section]) !== JSON.stringify(after[section])) {
      return true;
    }
  }
  return false;
}

export async function syncSmbToDotEnv(settings: MovieNightSettings): Promise<void> {
  const lines = [
    "# SMB credentials for Docker Compose CIFS volume mounts.",
    "# Other settings are stored in movie-night-settings.json (Settings page).",
    `SMB_USER=${settings.smb.user}`,
    `SMB_PASS=${settings.smb.pass}`,
    "",
  ];
  await atomicWrite(getWebDotEnvPath(), lines.join("\n"));
}

export async function saveSettings(
  settings: MovieNightSettings,
): Promise<{ requiresRestart: boolean }> {
  const previous = getSettingsSync();
  const normalized = normalizeSettings(settings);
  const filePath = getSettingsPath();
  await atomicWrite(filePath, JSON.stringify(normalized, null, 2));
  await syncSmbToDotEnv(normalized);
  clearSettingsCache();
  settingsCache = normalized;
  return {
    requiresRestart: settingsRequireRestart(previous, normalized),
  };
}

export function validateSettings(settings: MovieNightSettings): string | null {
  if (!settings.movies.jellyfinUrl.trim()) {
    return "Jellyfin URL is required";
  }
  if (!/^\d{2}:\d{2}$/.test(settings.discord.announceTimeMain.trim())) {
    return "Main announce time must be HH:MM";
  }
  if (!/^\d{2}:\d{2}$/.test(settings.discord.announceTimeHspc.trim())) {
    return "HSPC announce time must be HH:MM";
  }
  return null;
}

export type PublicSettings = MovieNightSettings & {
  configured: Record<SettingsSection, boolean>;
};

export function getConfiguredFlags(
  settings: MovieNightSettings,
): Record<SettingsSection, boolean> {
  return {
    tmdb: Boolean(settings.tmdb.apiKey.trim()),
    vrchat: Boolean(
      settings.vrchat.userAgent.trim() && settings.vrchat.authCookie.trim(),
    ),
    smb: Boolean(settings.smb.user.trim() && settings.smb.pass.trim()),
    movies: Boolean(
      settings.movies.jellyfinApiKey.trim() && settings.movies.jellyfinUrl.trim(),
    ),
    opensubtitles: Boolean(settings.opensubtitles.apiKey.trim()),
    bunny: Boolean(
      settings.bunny.storageZone.trim() &&
        settings.bunny.storagePassword.trim(),
    ),
    converter: Boolean(settings.converter.agentUrl.trim()),
    discord: Boolean(
      settings.discord.webhookMain.trim() || settings.discord.webhookHspc.trim(),
    ),
    github: Boolean(settings.github.token.trim()),
  };
}
