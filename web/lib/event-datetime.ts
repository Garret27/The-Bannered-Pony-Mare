import type { Event } from "./paths";

export type SendAnnouncementInput = {
  movieTitle: string;
  eventDate: string;
  eventTime: string;
  customText: string;
  mentionRole: boolean;
  includePoster: boolean;
};

const TARGET_WEEKDAY: Record<Event, number> = {
  main: 6,
  hspc: 2,
};

const WEEKDAY_TO_NUM: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Fallback only — prefer per-event times from settings (Main 17:00 / HSPC 18:00). */
const DEFAULT_ANNOUNCE_TIME = "17:00";
const DEFAULT_ANNOUNCE_TIMEZONE = "America/Denver";

const DEFAULT_EVENT_TIME: Record<Event, string> = {
  main: "17:00",
  hspc: "18:00",
};

export function getBuiltinEventTime(event: Event): string {
  return DEFAULT_EVENT_TIME[event];
}

function getZonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: get("weekday"),
  };
}

function getTimezoneOffsetMinutes(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";

  const asUtc = Date.UTC(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
    Number(get("hour")),
    Number(get("minute")),
    Number(get("second")),
  );

  return (asUtc - date.getTime()) / 60_000;
}

export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const offset = getTimezoneOffsetMinutes(timeZone, new Date(utcGuess));
  return new Date(utcGuess - offset * 60_000);
}

function addDaysToYmd(year: number, month: number, day: number, days: number) {
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function getNextEventDate(
  event: Event,
  time = DEFAULT_ANNOUNCE_TIME,
  timezone = DEFAULT_ANNOUNCE_TIMEZONE,
  now = new Date(),
): Date {
  const targetDay = TARGET_WEEKDAY[event];
  const [hour, minute] = time.split(":").map(Number);
  const zoned = getZonedParts(now, timezone);
  const currentDay = WEEKDAY_TO_NUM[zoned.weekday] ?? 0;

  let daysToAdd = (targetDay - currentDay + 7) % 7;

  if (daysToAdd === 0) {
    const currentMinutes = zoned.hour * 60 + zoned.minute;
    const eventMinutes = hour * 60 + minute;
    if (currentMinutes >= eventMinutes) {
      daysToAdd = 7;
    }
  }

  const targetDate = addDaysToYmd(zoned.year, zoned.month, zoned.day, daysToAdd);
  return zonedTimeToUtc(
    targetDate.year,
    targetDate.month,
    targetDate.day,
    hour,
    minute,
    timezone,
  );
}

export function formatDateInTimezone(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function formatTimeInTimezone(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));

  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

export function parseEventDateTime(
  eventDate: string,
  eventTime: string,
  timezone: string,
): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(eventDate.trim());
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(eventTime.trim());

  if (!dateMatch || !timeMatch) {
    return null;
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    Number.isNaN(hour) ||
    Number.isNaN(minute)
  ) {
    return null;
  }

  return zonedTimeToUtc(year, month, day, hour, minute, timezone);
}

export function formatAnnouncementDateTime(isoDate: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(isoDate));
}

export function toUnixTimestamp(isoDate: string): number {
  return Math.floor(new Date(isoDate).getTime() / 1000);
}

export function formatDiscordTimestamp(
  unix: number,
  style: "F" | "R",
): string {
  return `<t:${unix}:${style}>`;
}

/** Long date/time (`F`) with relative (`R`) on the line below — Discord native format. */
export function formatDiscordEventTimestamps(isoDate: string): string {
  const unix = toUnixTimestamp(isoDate);
  return `${formatDiscordTimestamp(unix, "F")}\n${formatDiscordTimestamp(unix, "R")}`;
}

/** Human-readable preview of Discord `<t:…:F>` in the configured timezone. */
export function formatDiscordTimestampLongPreview(
  isoDate: string,
  timezone: string,
): string {
  const date = new Date(isoDate);
  const datePart = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${datePart} ${timePart}`;
}

/** Human-readable preview of Discord `<t:…:R>`. */
export function formatDiscordTimestampRelativePreview(isoDate: string): string {
  const diffSec = Math.round((new Date(isoDate).getTime() - Date.now()) / 1000);
  const absDiff = Math.abs(diffSec);
  const sign = diffSec >= 0 ? 1 : -1;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absDiff < 60) {
    return rtf.format(sign * absDiff, "second");
  }
  if (absDiff < 3600) {
    return rtf.format(sign * Math.floor(absDiff / 60), "minute");
  }
  if (absDiff < 86400) {
    return rtf.format(sign * Math.floor(absDiff / 3600), "hour");
  }
  if (absDiff < 604800) {
    return rtf.format(sign * Math.floor(absDiff / 86400), "day");
  }
  if (absDiff < 2629800) {
    return rtf.format(sign * Math.floor(absDiff / 604800), "week");
  }
  if (absDiff < 31557600) {
    return rtf.format(sign * Math.floor(absDiff / 2629800), "month");
  }
  return rtf.format(sign * Math.floor(absDiff / 31557600), "year");
}

export function formatDiscordEventTimestampsPreview(
  isoDate: string,
  timezone: string,
): string {
  return `${formatDiscordTimestampLongPreview(isoDate, timezone)}\n${formatDiscordTimestampRelativePreview(isoDate)}`;
}
