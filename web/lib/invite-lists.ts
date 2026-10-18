import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { atomicWrite } from "./atomic-write";
import { getDataRoot } from "./paths";

const DEFAULT_BLOCKED_USER_IDS = [
  "usr_ffb0f90c-b9b3-47dd-abd6-eb9094312bfb",
  "usr_64a98359-d986-4383-9251-362ad6ae0f15",
];

export type RegularEntry = {
  userId: string;
  displayName: string;
};

export type RegularStats = {
  displayName: string;
  distinctSaturdays?: number;
  distinctTuesdays?: number;
};

export type RegularSnapshotMember = RegularStats & {
  userId: string;
  displayName: string;
};

export type RegularsSnapshot = {
  updatedAt: string;
  source: "vrcx";
  criteria: {
    lookbackDays: number;
    saturdayWindow: string;
    tuesdayWindow: string;
    description: string;
  };
  members: RegularSnapshotMember[];
};

export type RegularsOverrides = {
  added: RegularEntry[];
  removed: string[];
};

export type BlocklistOverrides = {
  added: string[];
  removed: string[];
};

const EMPTY_REGULARS: RegularsOverrides = { added: [], removed: [] };
const EMPTY_BLOCKLIST: BlocklistOverrides = { added: [], removed: [] };

function getMovieNightDir(): string {
  return path.join(getDataRoot(), "movie-night");
}

export function getRegularsOverridesPath(): string {
  return path.join(getMovieNightDir(), "regulars-overrides.json");
}

export function getRegularsSnapshotPath(): string {
  return path.join(getMovieNightDir(), "regulars-snapshot.json");
}

export function getBlocklistOverridesPath(): string {
  return path.join(getMovieNightDir(), "blocklist-overrides.json");
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
  const dir = path.dirname(filePath);
  await fsPromises.mkdir(dir, { recursive: true });
  await atomicWrite(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export function loadRegularsOverrides(): RegularsOverrides {
  const data = readJsonFile<RegularsOverrides>(
    getRegularsOverridesPath(),
    EMPTY_REGULARS,
  );
  return {
    added: Array.isArray(data.added) ? data.added : [],
    removed: Array.isArray(data.removed) ? data.removed : [],
  };
}

export function loadRegularsSnapshot(): RegularsSnapshot | null {
  const data = readJsonFile<RegularsSnapshot | null>(
    getRegularsSnapshotPath(),
    null,
  );
  if (!data || !Array.isArray(data.members)) return null;
  return data;
}

export function loadRegularsSnapshotMap(): Map<string, RegularStats> {
  const snapshot = loadRegularsSnapshot();
  const map = new Map<string, RegularStats>();
  if (!snapshot) return map;
  for (const member of snapshot.members) {
    if (!member.userId?.trim()) continue;
    map.set(member.userId, {
      displayName: member.displayName,
      distinctSaturdays: member.distinctSaturdays,
      distinctTuesdays: member.distinctTuesdays,
    });
  }
  return map;
}

export async function saveRegularsSnapshot(
  snapshot: RegularsSnapshot,
): Promise<void> {
  await writeJsonFile(getRegularsSnapshotPath(), snapshot);
}

export function loadManagedRegulars(): Map<string, RegularStats> {
  return mergeRegularsMap(loadRegularsSnapshotMap());
}

export function loadBlocklistOverrides(): BlocklistOverrides {
  const data = readJsonFile<BlocklistOverrides>(
    getBlocklistOverridesPath(),
    EMPTY_BLOCKLIST,
  );
  return {
    added: Array.isArray(data.added) ? data.added : [],
    removed: Array.isArray(data.removed) ? data.removed : [],
  };
}

export function isNamePatternBlocked(displayName: string): boolean {
  const low = (displayName || "").toLowerCase().replace(/\s+/g, " ");
  const compact = low.replace(/\s/g, "");
  if (compact.includes("octuple") && compact.includes("haddock")) return true;
  if (!compact.includes("ianto")) return false;
  return low.includes("gwynt") || low.includes("gwyent");
}

export function isHardcodedBlocked(userId: string): boolean {
  return DEFAULT_BLOCKED_USER_IDS.includes(userId);
}

export function isUserBlocked(
  userId: string,
  displayName: string,
  blocklist = loadBlocklistOverrides(),
): boolean {
  if (blocklist.removed.includes(userId)) return false;
  if (isHardcodedBlocked(userId)) return true;
  if (blocklist.added.includes(userId)) return true;
  return isNamePatternBlocked(displayName);
}

export function isPatternOnlyBlock(
  userId: string,
  displayName: string,
  blocklist = loadBlocklistOverrides(),
): boolean {
  if (blocklist.removed.includes(userId)) return false;
  if (isHardcodedBlocked(userId)) return false;
  if (blocklist.added.includes(userId)) return false;
  return isNamePatternBlocked(displayName);
}

export function mergeRegularsMap(
  baseMap: Map<string, RegularStats>,
  overrides = loadRegularsOverrides(),
): Map<string, RegularStats> {
  const merged = new Map(baseMap);

  for (const userId of overrides.removed) {
    merged.delete(userId);
  }

  for (const entry of overrides.added) {
    if (!entry.userId?.trim()) continue;
    const existing = merged.get(entry.userId);
    merged.set(entry.userId, {
      displayName: entry.displayName || existing?.displayName || entry.userId,
      distinctSaturdays: existing?.distinctSaturdays,
      distinctTuesdays: existing?.distinctTuesdays,
    });
  }

  return merged;
}

/** @deprecated Use mergeRegularsMap */
export function mergeRegularsCsv(
  csvMap: Map<string, { displayName: string; distinctSaturdays?: number }>,
  overrides = loadRegularsOverrides(),
): Map<string, RegularStats> {
  const base = new Map<string, RegularStats>();
  for (const [userId, entry] of csvMap) {
    base.set(userId, {
      displayName: entry.displayName,
      distinctSaturdays: entry.distinctSaturdays,
    });
  }
  return mergeRegularsMap(base, overrides);
}

export async function addRegular(
  userId: string,
  displayName: string,
): Promise<RegularsOverrides> {
  if (!userId.trim()) {
    throw new Error("Invalid user id");
  }

  const overrides = loadRegularsOverrides();
  overrides.removed = overrides.removed.filter((id) => id !== userId);
  const existing = overrides.added.find((e) => e.userId === userId);
  if (!existing) {
    overrides.added.push({ userId, displayName });
  } else {
    existing.displayName = displayName;
  }
  overrides.added.sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
  );

  await writeJsonFile(getRegularsOverridesPath(), overrides);
  return overrides;
}

export async function removeRegular(userId: string): Promise<RegularsOverrides> {
  const overrides = loadRegularsOverrides();
  overrides.added = overrides.added.filter((e) => e.userId !== userId);
  if (!overrides.removed.includes(userId)) {
    overrides.removed.push(userId);
  }
  await writeJsonFile(getRegularsOverridesPath(), overrides);
  return overrides;
}

export async function addToBlocklist(userId: string): Promise<BlocklistOverrides> {
  if (!userId.startsWith("usr_")) {
    throw new Error("Invalid user id");
  }

  const overrides = loadBlocklistOverrides();
  overrides.removed = overrides.removed.filter((id) => id !== userId);
  if (!overrides.added.includes(userId)) {
    overrides.added.push(userId);
  }
  overrides.added.sort();
  await writeJsonFile(getBlocklistOverridesPath(), overrides);
  return overrides;
}

export async function removeFromBlocklist(
  userId: string,
): Promise<BlocklistOverrides> {
  const overrides = loadBlocklistOverrides();
  overrides.added = overrides.added.filter((id) => id !== userId);
  if (!overrides.removed.includes(userId)) {
    overrides.removed.push(userId);
  }
  await writeJsonFile(getBlocklistOverridesPath(), overrides);
  return overrides;
}

export function canUnblockUser(
  userId: string,
  displayName: string,
  blocklist = loadBlocklistOverrides(),
): boolean {
  if (isPatternOnlyBlock(userId, displayName, blocklist)) return false;
  if (isHardcodedBlocked(userId) && !blocklist.removed.includes(userId)) {
    return true;
  }
  return blocklist.added.includes(userId);
}
