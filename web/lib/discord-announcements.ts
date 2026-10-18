import fs from "fs/promises";
import type { Event } from "./paths";
import { EVENT_LABELS, getPosterFilename, getPosterPath } from "./paths";
import { readEventTitles } from "./event-titles";
import { readRedirects } from "./redirects";
import { getSettingsSync, type MovieNightSettings } from "./settings";
import {
  formatDateInTimezone,
  formatDiscordTimestamp,
  formatTimeInTimezone,
  getNextEventDate,
  parseEventDateTime,
  toUnixTimestamp,
  type SendAnnouncementInput,
} from "./event-datetime";

export function getDefaultAnnounceTime(event: Event): string {
  const discord = getSettingsSync().discord;
  if (event === "main") {
    return discord.announceTimeMain.trim() || "17:00";
  }
  return discord.announceTimeHspc.trim() || "18:00";
}

export function getAnnounceTimezone(): string {
  return getSettingsSync().discord.announceTimezone.trim() || "America/Denver";
}

export type { SendAnnouncementInput };

export type DiscordEventConfig = {
  webhookUrl: string | null;
  roleId: string | null;
  webhookConfigured: boolean;
  roleConfigured: boolean;
};

export type AnnouncementDraft = {
  event: Event;
  eventLabel: string;
  movieTitle: string;
  suggestedAt: string;
  suggestedDate: string;
  suggestedTime: string;
  posterUrl: string;
  posterExists: boolean;
  webhookConfigured: boolean;
  roleConfigured: boolean;
  defaultTime: string;
  timezone: string;
};

const WEBHOOK_KEYS: Record<Event, keyof MovieNightSettings["discord"]> = {
  main: "webhookMain",
  hspc: "webhookHspc",
};

const ROLE_KEYS: Record<Event, keyof MovieNightSettings["discord"]> = {
  main: "roleMain",
  hspc: "roleHspc",
};

const QUALITY_TAG_PATTERN =
  /\b(\d{3,4}p|AAC|AC3|DDP?\d?(?:\.\d)?|x264|x265|HEVC|H\.?264|H\.?265|BluRay|WEB-DL|WEBRip|Remux)\b/gi;

export function getDiscordConfig(event: Event): DiscordEventConfig {
  const discord = getSettingsSync().discord;
  const webhookUrl = discord[WEBHOOK_KEYS[event]].trim() || null;
  const roleId = discord[ROLE_KEYS[event]].trim() || null;

  return {
    webhookUrl,
    roleId,
    webhookConfigured: Boolean(webhookUrl),
    roleConfigured: Boolean(roleId),
  };
}

export function parseMovieTitleFromRedirectUrl(url: string): string {
  if (!url) return "";

  try {
    const pathname = new URL(url).pathname;
    const filename = decodeURIComponent(pathname.split("/").pop() ?? "");
    const withoutExt = filename.replace(/\.[^.]+$/, "");

    return withoutExt
      .replace(QUALITY_TAG_PATTERN, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  } catch {
    return "";
  }
}

export function buildAnnouncementMessage(params: {
  roleId: string | null;
  mentionRole: boolean;
  eventAt: string;
  customText: string;
  movieTitle: string;
}): string {
  const lines: string[] = [];
  const custom = params.customText.trim();
  const movieTitle = params.movieTitle.trim();
  const roleMention =
    params.mentionRole && params.roleId ? `<@&${params.roleId}>` : null;

  if (roleMention && custom) {
    lines.push(`${roleMention} ${custom}`);
  } else if (roleMention) {
    lines.push(roleMention);
  } else if (custom) {
    lines.push(custom);
  }

  const unix = toUnixTimestamp(params.eventAt);
  lines.push(formatDiscordTimestamp(unix, "F"));
  lines.push(formatDiscordTimestamp(unix, "R"));

  if (movieTitle) {
    lines.push(`**${movieTitle}**`);
  }

  return lines.join("\n");
}

export async function posterExists(event: Event): Promise<boolean> {
  try {
    await fs.access(getPosterPath(event));
    return true;
  } catch {
    return false;
  }
}

export async function readPosterBuffer(event: Event): Promise<Buffer> {
  return fs.readFile(getPosterPath(event));
}

export async function buildAnnouncementDraft(event: Event): Promise<AnnouncementDraft> {
  const [redirects, eventTitles] = await Promise.all([
    readRedirects(),
    readEventTitles(),
  ]);
  const config = getDiscordConfig(event);
  const timezone = getAnnounceTimezone();
  const defaultTime = getDefaultAnnounceTime(event);
  const movieTitle =
    eventTitles[event] || parseMovieTitleFromRedirectUrl(redirects[event].url);
  const suggestedAt = getNextEventDate(event, defaultTime, timezone).toISOString();
  const hasPoster = await posterExists(event);

  return {
    event,
    eventLabel: EVENT_LABELS[event],
    movieTitle,
    suggestedAt,
    suggestedDate: formatDateInTimezone(suggestedAt, timezone),
    suggestedTime: formatTimeInTimezone(suggestedAt, timezone),
    posterUrl: `/api/posters/${event}`,
    posterExists: hasPoster,
    webhookConfigured: config.webhookConfigured,
    roleConfigured: config.roleConfigured,
    defaultTime,
    timezone,
  };
}

export async function postAnnouncement(
  event: Event,
  input: SendAnnouncementInput & { posterBuffer?: Buffer | null },
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const config = getDiscordConfig(event);

  if (!config.webhookUrl) {
    return { ok: false, error: "Discord webhook is not configured for this event." };
  }

  const timezone = getAnnounceTimezone();
  const eventAt = parseEventDateTime(input.eventDate, input.eventTime, timezone);
  if (!eventAt) {
    return { ok: false, error: "Invalid event date/time." };
  }

  const movieTitle = input.movieTitle.trim();
  if (!movieTitle) {
    return { ok: false, error: "Movie title is required." };
  }

  const includePoster = input.includePoster !== false;
  let posterBuffer: Buffer | null = null;

  if (includePoster) {
    if (input.posterBuffer && input.posterBuffer.length > 0) {
      posterBuffer = input.posterBuffer;
    } else {
      try {
        posterBuffer = await readPosterBuffer(event);
      } catch {
        return {
          ok: false,
          error:
            "Poster file not found. Upload a poster on the Dashboard, attach a schedule override, or disable poster attachment.",
        };
      }
    }
  }

  const mentionRole = input.mentionRole !== false;
  const roleId = mentionRole ? config.roleId : null;

  const content = buildAnnouncementMessage({
    roleId,
    mentionRole,
    eventAt: eventAt.toISOString(),
    customText: input.customText,
    movieTitle,
  });

  if (!content.trim()) {
    return { ok: false, error: "Announcement message is empty." };
  }

  if (content.length > 2000) {
    return { ok: false, error: "Announcement message exceeds Discord's 2000 character limit." };
  }

  const payload = {
    content,
    allowed_mentions:
      mentionRole && config.roleId
        ? { parse: [], roles: [config.roleId] }
        : { parse: [] },
  };

  let response: Response;

  if (includePoster && posterBuffer) {
    const formData = new FormData();
    formData.append("payload_json", JSON.stringify(payload));
    formData.append(
      "files[0]",
      new Blob([new Uint8Array(posterBuffer)], { type: "image/jpeg" }),
      getPosterFilename(event),
    );
    response = await fetch(config.webhookUrl, {
      method: "POST",
      body: formData,
    });
  } else {
    response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  if (!response.ok) {
    const body = await response.text();
    return {
      ok: false,
      error: body || `Discord returned ${response.status}`,
      status: response.status,
    };
  }

  return { ok: true };
}
