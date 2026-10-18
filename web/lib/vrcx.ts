import fs from "fs";
import Database from "better-sqlite3";

export type VrcxMember = {
  userId: string;
  displayName: string;
  source: "friend_log_current" | "gamelog";
};

function getVrcxDbPath(): string {
  if (process.env.VRCX_DB_PATH?.trim()) {
    return process.env.VRCX_DB_PATH.trim();
  }
  const appData = process.env.APPDATA;
  if (appData) {
    return `${appData.replace(/\\/g, "/")}/VRCX/VRCX.sqlite3`;
  }
  return "";
}

export function isVrcxAvailable(): boolean {
  const path = getVrcxDbPath();
  if (!path) return false;
  try {
    fs.accessSync(path, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function openReadOnly(): Database.Database {
  const path = getVrcxDbPath();
  if (!path || !isVrcxAvailable()) {
    throw new Error("VRCX database is not available");
  }
  return new Database(path, { readonly: true, fileMustExist: true });
}

export function openVrcxReadOnly(): Database.Database {
  return openReadOnly();
}

export function inferMyIdFromVrcx(): string | null {
  if (!isVrcxAvailable()) return null;
  const db = openReadOnly();
  try {
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'usr%_feed_gps' LIMIT 1",
      )
      .get() as { name?: string } | undefined;
    if (!row?.name) return null;
    const core = row.name.split("_feed_gps")[0].slice(3);
    if (core.length < 32) return null;
    return `usr_${core.slice(0, 8)}-${core.slice(8, 12)}-${core.slice(12, 16)}-${core.slice(16, 20)}-${core.slice(20)}`;
  } finally {
    db.close();
  }
}

export function locationFromVrcx(): string | null {
  if (!isVrcxAvailable()) return null;
  const db = openReadOnly();
  try {
    const row = db
      .prepare(
        `SELECT location FROM gamelog_location
         WHERE location LIKE 'wrld_%'
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get() as { location?: string } | undefined;
    const loc = row?.location?.trim();
    return loc || null;
  } finally {
    db.close();
  }
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
    )
    .get(name);
  return Boolean(row);
}

function usersFromFriendLogCurrent(
  db: Database.Database,
  location: string,
): VrcxMember[] {
  if (!tableExists(db, "friend_log_current")) {
    return [];
  }
  const rows = db
    .prepare(
      `SELECT user_id, display_name FROM friend_log_current
       WHERE location = ?
         AND user_id IS NOT NULL
         AND TRIM(user_id) != ''`,
    )
    .all(location) as Array<{ user_id: string; display_name?: string }>;

  return rows.map((r) => ({
    userId: String(r.user_id),
    displayName: String(r.display_name ?? ""),
    source: "friend_log_current" as const,
  }));
}

function usersFromGamelogHeuristic(
  db: Database.Database,
  location: string,
  myId: string | null,
): VrcxMember[] {
  if (!tableExists(db, "gamelog_join_leave")) {
    return [];
  }

  const joins = db
    .prepare(
      `SELECT user_id, display_name, created_at FROM gamelog_join_leave
       WHERE type = 'OnPlayerJoined'
         AND location = ?
         AND user_id IS NOT NULL
         AND TRIM(user_id) != ''
       ORDER BY created_at DESC
       LIMIT 200`,
    )
    .all(location) as Array<{
    user_id: string;
    display_name?: string;
    created_at: string;
  }>;

  const members: VrcxMember[] = [];
  const seen = new Set<string>();

  for (const join of joins) {
    const uid = String(join.user_id);
    if (myId && uid === myId) continue;
    if (seen.has(uid)) continue;

    const leave = db
      .prepare(
        `SELECT 1 FROM gamelog_join_leave
         WHERE type = 'OnPlayerLeft'
           AND location = ?
           AND user_id = ?
           AND created_at > ?
         LIMIT 1`,
      )
      .get(location, uid, join.created_at);

    if (leave) continue;

    seen.add(uid);
    members.push({
      userId: uid,
      displayName: String(join.display_name ?? ""),
      source: "gamelog",
    });
  }

  return members;
}

export function usersInInstance(location: string): VrcxMember[] {
  if (!isVrcxAvailable()) return [];
  const db = openReadOnly();
  try {
    const myId = inferMyIdFromVrcx();
    const fromLog = usersFromFriendLogCurrent(db, location);
    const fromGamelog = usersFromGamelogHeuristic(db, location, myId);

    const byId = new Map<string, VrcxMember>();
    for (const m of [...fromGamelog, ...fromLog]) {
      if (myId && m.userId === myId) continue;
      if (!byId.has(m.userId)) {
        byId.set(m.userId, m);
      }
    }
    return [...byId.values()];
  } finally {
    db.close();
  }
}

function normalizeDisplayName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

function parseLastSeen(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function lastSeenByDisplayName(
  db: Database.Database,
  myId: string,
  displayNames: Map<string, string>,
): Map<string, string> {
  const out = new Map<string, string>();
  const dnToUids = new Map<string, string[]>();

  for (const [uid, name] of displayNames) {
    const key = normalizeDisplayName(name);
    if (!key) continue;
    const list = dnToUids.get(key) ?? [];
    list.push(uid);
    dnToUids.set(key, list);
  }

  const rows = db
    .prepare(
      `SELECT display_name, MAX(created_at) AS last_seen
       FROM gamelog_join_leave
       WHERE (user_id IS NULL OR TRIM(user_id) = '')
         AND display_name IS NOT NULL AND TRIM(display_name) != ''
         AND location LIKE '%' || ? || '%'
       GROUP BY display_name`,
    )
    .all(myId) as Array<{ display_name: string; last_seen: string }>;

  for (const row of rows) {
    const key = normalizeDisplayName(String(row.display_name ?? ""));
    const uids = dnToUids.get(key);
    if (!uids || uids.length !== 1) continue;
    const iso = parseLastSeen(row.last_seen);
    if (iso) out.set(uids[0], iso);
  }

  return out;
}

export function getLastSeenForFriends(
  userIds: string[],
  displayNames: Map<string, string>,
): Map<string, string | null> {
  const result = new Map<string, string | null>();
  for (const id of userIds) {
    result.set(id, null);
  }

  if (!isVrcxAvailable() || userIds.length === 0) {
    return result;
  }

  const db = openReadOnly();
  try {
    const myId = inferMyIdFromVrcx();
    if (!myId) return result;

    const chunkSize = 400;
    for (let i = 0; i < userIds.length; i += chunkSize) {
      const chunk = userIds.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => "?").join(", ");
      const rows = db
        .prepare(
          `SELECT user_id, MAX(created_at) AS last_seen
           FROM gamelog_join_leave
           WHERE user_id IN (${placeholders})
             AND user_id != ?
             AND location LIKE '%' || ? || '%'
           GROUP BY user_id`,
        )
        .all(...chunk, myId, myId) as Array<{ user_id: string; last_seen: string }>;

      for (const row of rows) {
        const iso = parseLastSeen(row.last_seen);
        if (iso) result.set(String(row.user_id), iso);
      }
    }

    const missing = new Map<string, string>();
    for (const id of userIds) {
      if (!result.get(id)) {
        const name = displayNames.get(id);
        if (name) missing.set(id, name);
      }
    }

    if (missing.size > 0) {
      for (const [uid, iso] of lastSeenByDisplayName(db, myId, missing)) {
        result.set(uid, iso);
      }
    }
  } finally {
    db.close();
  }

  return result;
}
