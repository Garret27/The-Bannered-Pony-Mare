import { getSettingsSync } from "./settings";

const API_BASE = "https://api.vrchat.cloud/api/1";

export class VrchatConfigError extends Error {
  constructor() {
    super("VRChat credentials are not configured");
    this.name = "VrchatConfigError";
  }
}

export class VrchatAuthError extends Error {
  constructor(message = "VRChat auth failed — cookie may be expired") {
    super(message);
    this.name = "VrchatAuthError";
  }
}

export class VrchatApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "VrchatApiError";
    this.status = status;
  }
}

export type VrcUserState = "offline" | "active" | "online";

export type VrcUser = {
  id: string;
  displayName?: string;
  username?: string;
  /** VRChat client state: online = in-game, active = website/VRCX/mobile only */
  state?: VrcUserState | string;
  location?: string;
  presence?: {
    world?: string;
    instance?: string;
    travelingToWorld?: string;
    travelingToInstance?: string;
  };
};

export type VrcFriend = VrcUser;

function getUserAgent(): string {
  const ua = getSettingsSync().vrchat.userAgent.trim();
  if (!ua) throw new VrchatConfigError();
  return ua;
}

function getAuthCookie(): string {
  const cookie = getSettingsSync().vrchat.authCookie.trim();
  if (!cookie) throw new VrchatConfigError();
  return cookie;
}

export function isVrchatConfigured(): boolean {
  const vrchat = getSettingsSync().vrchat;
  return Boolean(vrchat.userAgent.trim() && vrchat.authCookie.trim());
}

function vrchatHeaders(): HeadersInit {
  return {
    "User-Agent": getUserAgent(),
    Cookie: `auth=${getAuthCookie()};`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function vrchatFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  if (!isVrchatConfigured()) {
    throw new VrchatConfigError();
  }

  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      ...vrchatHeaders(),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
}

export async function getCurrentUser(): Promise<VrcUser> {
  const response = await vrchatFetch("/auth/user");
  if (response.status === 401) {
    throw new VrchatAuthError();
  }
  if (response.status === 403) {
    throw new VrchatApiError(
      "403: invalid User-Agent — check VRCHAT_USER_AGENT",
      403,
    );
  }
  if (!response.ok) {
    const text = await response.text();
    throw new VrchatApiError(text.slice(0, 500) || "Request failed", response.status);
  }
  return response.json() as Promise<VrcUser>;
}

export function locationFromPresence(user: VrcUser): string | null {
  const pres = user.presence;
  if (!pres) return null;
  const world = pres.travelingToWorld || pres.world;
  const instance = pres.travelingToInstance || pres.instance;
  if (!world || !instance || world === "offline") return null;
  return `${world}:${instance}`;
}

export async function resolveInstanceLocation(loc: string): Promise<string> {
  const trimmed = loc.trim();
  if (!trimmed.includes(":")) {
    return trimmed;
  }

  const response = await vrchatFetch(`/instances/${trimmed}`);
  if (!response.ok) {
    return trimmed;
  }

  try {
    const data = (await response.json()) as { location?: string };
    if (data.location?.startsWith("wrld_")) {
      return data.location;
    }
  } catch {
    // use trimmed
  }
  return trimmed;
}

async function fetchFriendsPage(
  offline: boolean,
  offset: number,
): Promise<VrcFriend[]> {
  const params = new URLSearchParams({
    offset: String(offset),
    n: "100",
    offline: offline ? "true" : "false",
  });
  const response = await vrchatFetch(`/auth/user/friends?${params}`);
  if (response.status === 401) {
    throw new VrchatAuthError();
  }
  if (!response.ok) {
    const text = await response.text();
    throw new VrchatApiError(text.slice(0, 500) || "Friends fetch failed", response.status);
  }
  const batch = (await response.json()) as unknown;
  if (!Array.isArray(batch)) return [];
  return batch.filter(
    (u): u is VrcFriend =>
      typeof u === "object" &&
      u !== null &&
      typeof (u as VrcFriend).id === "string" &&
      (u as VrcFriend).id.startsWith("usr_"),
  );
}

/** Friends with state active or online (excludes fully offline). */
export async function fetchOnlineFriends(): Promise<VrcFriend[]> {
  const out: VrcFriend[] = [];
  let offset = 0;
  while (true) {
    const batch = await fetchFriendsPage(false, offset);
    if (batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 100) break;
    offset += 100;
  }
  return out;
}

/** True when the friend is in the VRChat client, not merely active on VRCX/mobile/web. */
export function isFriendInGame(friend: VrcFriend): boolean {
  const state = friend.state?.toLowerCase();
  if (state === "active") return false;
  if (state === "online") return true;
  if (state === "offline") return false;

  const loc = (friend.location ?? "").trim();
  if (!loc || loc === "offline") return false;
  if (loc === "private" || loc === "traveling") return true;
  if (loc.startsWith("wrld_")) return true;
  return loc.includes(":");
}

export function filterInGameFriends(friends: VrcFriend[]): VrcFriend[] {
  return friends.filter(isFriendInGame);
}

/** Online friends who are in the VRChat game (excludes active-on-platform only). */
export async function fetchInGameFriends(): Promise<VrcFriend[]> {
  return filterInGameFriends(await fetchOnlineFriends());
}

export async function fetchAllFriends(): Promise<VrcFriend[]> {
  const out: VrcFriend[] = [];
  let offset = 0;
  while (true) {
    const batch = await fetchFriendsPage(true, offset);
    if (batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 100) break;
    offset += 100;
  }
  return out;
}

export function friendsInLocation(
  friends: VrcFriend[],
  location: string,
): VrcFriend[] {
  return friends.filter((f) => f.location === location);
}

export async function setInviteMessageSlot(
  userId: string,
  slot: number,
  message: string,
): Promise<{ ok: boolean; rateLimited: boolean }> {
  const response = await vrchatFetch(`/message/${userId}/message/${slot}`, {
    method: "PUT",
    body: JSON.stringify({ message }),
  });
  if (response.status === 429) {
    return { ok: false, rateLimited: true };
  }
  return { ok: response.ok, rateLimited: false };
}

export async function sendInvite(
  userId: string,
  instanceId: string,
  messageSlot?: number,
): Promise<{ ok: boolean; status: number; body: string }> {
  const payload: { instanceId: string; messageSlot?: number } = { instanceId };
  if (messageSlot !== undefined) {
    payload.messageSlot = messageSlot;
  }
  const response = await vrchatFetch(`/invite/${userId}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  return { ok: response.ok, status: response.status, body: body.slice(0, 300) };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
