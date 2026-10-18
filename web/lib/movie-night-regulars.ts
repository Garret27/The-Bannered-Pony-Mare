import type Database from "better-sqlite3";
import {
  getRegularsSnapshotPath,
  type RegularSnapshotMember,
  type RegularsSnapshot,
  saveRegularsSnapshot,
} from "./invite-lists";
import { inferMyIdFromVrcx, isVrcxAvailable, openVrcxReadOnly } from "./vrcx";

const DENVER_TZ = "America/Denver";
const LOOKBACK_DAYS = 62;
const SAT_WIN_START_MIN = 17 * 60;
const SAT_WIN_END_MIN = 22 * 60;
const TUE_WIN_START_MIN = 18 * 60;
const TUE_WIN_END_MIN = 22 * 60;

export type MovieNightRegularStats = {
  displayName: string;
  distinctSaturdays: number;
  distinctTuesdays: number;
};

type JoinRow = {
  created_at: string;
  display_name?: string;
  user_id: string;
  location: string;
};

function parseUtc(iso: string): Date | null {
  const parsed = Date.parse(iso.replace("Z", "+00:00"));
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed);
}

function weekdayInDenver(date: Date): number {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: DENVER_TZ,
    weekday: "short",
  }).format(date);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[label] ?? -1;
}

function dateKeyInDenver(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DENVER_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function localMinutesInDenver(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DENVER_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function qualifiesSaturday(localMinutes: number, weekday: number): boolean {
  return weekday === 6 && localMinutes >= SAT_WIN_START_MIN && localMinutes < SAT_WIN_END_MIN;
}

function qualifiesTuesday(localMinutes: number, weekday: number): boolean {
  return weekday === 2 && localMinutes >= TUE_WIN_START_MIN && localMinutes < TUE_WIN_END_MIN;
}

function scanMovieNightJoins(
  db: Database.Database,
  myId: string,
  cutoffMs: number,
): {
  saturdayDates: Map<string, Set<string>>;
  tuesdayDates: Map<string, Set<string>>;
  displayNames: Map<string, string>;
} {
  const saturdayDates = new Map<string, Set<string>>();
  const tuesdayDates = new Map<string, Set<string>>();
  const displayNames = new Map<string, string>();

  const rows = db
    .prepare(
      `SELECT created_at, display_name, user_id, location
       FROM gamelog_join_leave
       WHERE type = 'OnPlayerJoined'
         AND user_id IS NOT NULL
         AND TRIM(user_id) != ''
         AND user_id != ?`,
    )
    .all(myId) as JoinRow[];

  for (const row of rows) {
    const loc = String(row.location ?? "");
    if (!loc.includes(myId)) continue;

    const uid = String(row.user_id);
    const utc = parseUtc(String(row.created_at));
    if (!utc || utc.getTime() < cutoffMs) continue;

    const weekday = weekdayInDenver(utc);
    const minutes = localMinutesInDenver(utc);
    const dateKey = dateKeyInDenver(utc);

    if (qualifiesSaturday(minutes, weekday)) {
      let dates = saturdayDates.get(uid);
      if (!dates) {
        dates = new Set();
        saturdayDates.set(uid, dates);
      }
      dates.add(dateKey);
    }

    if (qualifiesTuesday(minutes, weekday)) {
      let dates = tuesdayDates.get(uid);
      if (!dates) {
        dates = new Set();
        tuesdayDates.set(uid, dates);
      }
      dates.add(dateKey);
    }

    if (row.display_name?.trim()) {
      displayNames.set(uid, row.display_name.trim());
    }
  }

  return { saturdayDates, tuesdayDates, displayNames };
}

export function buildMovieNightRegularsFromVrcx(): RegularSnapshotMember[] {
  if (!isVrcxAvailable()) return [];

  const db = openVrcxReadOnly();
  try {
    const myId = inferMyIdFromVrcx();
    if (!myId) return [];

    const cutoffMs = Date.now() - LOOKBACK_DAYS * 86400000;
    const { saturdayDates, tuesdayDates, displayNames } = scanMovieNightJoins(
      db,
      myId,
      cutoffMs,
    );

    const userIds = new Set([...saturdayDates.keys(), ...tuesdayDates.keys()]);
    const members: RegularSnapshotMember[] = [];

    for (const userId of userIds) {
      const distinctSaturdays = saturdayDates.get(userId)?.size ?? 0;
      const distinctTuesdays = tuesdayDates.get(userId)?.size ?? 0;
      if (distinctSaturdays === 0 && distinctTuesdays === 0) continue;

      members.push({
        userId,
        displayName: displayNames.get(userId) ?? userId,
        distinctSaturdays,
        distinctTuesdays,
      });
    }

    members.sort((a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
    );
    return members;
  } finally {
    db.close();
  }
}

export const MOVIE_NIGHT_REGULARS_META = {
  lookbackDays: LOOKBACK_DAYS,
  saturdayWindow: "17:00–22:00 MDT",
  tuesdayWindow: "18:00–22:00 MDT",
  description:
    "Joined your instance on Sat 5–10 PM or Tue 6–10 PM MDT at least once in the lookback window.",
};

export async function syncMovieNightRegularsFromVrcx(): Promise<RegularsSnapshot> {
  const members = buildMovieNightRegularsFromVrcx();
  const snapshot: RegularsSnapshot = {
    updatedAt: new Date().toISOString(),
    source: "vrcx",
    criteria: MOVIE_NIGHT_REGULARS_META,
    members,
  };
  await saveRegularsSnapshot(snapshot);
  return snapshot;
}

export function getRegularsSnapshotPathForExport(): string {
  return getRegularsSnapshotPath();
}
