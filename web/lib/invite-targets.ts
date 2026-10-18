import {
  canUnblockUser,
  isUserBlocked,
  loadManagedRegulars,
  loadRegularsSnapshot,
  type RegularStats,
} from "./invite-lists";
import {
  fetchInGameFriends,
  friendsInLocation,
  getCurrentUser,
  locationFromPresence,
  resolveInstanceLocation,
  type VrcFriend,
} from "./vrchat";
import {
  isVrcxAvailable,
  getLastSeenForFriends,
  locationFromVrcx,
  usersInInstance,
} from "./vrcx";

export type InviteTarget = {
  userId: string;
  displayName: string;
  alreadyInInstance: boolean;
  blocked: boolean;
  online: boolean;
  distinctSaturdays?: number;
  distinctTuesdays?: number;
  canUnblock?: boolean;
  lastSeen?: string | null;
};

export type InviteTargetsResult = {
  location: string | null;
  locationSource: "vrcx" | "api" | null;
  vrcxAvailable: boolean;
  regularsUpdatedAt: string | null;
  regularsTotal: number;
  regularsOnline: number;
  instanceMembers: Array<{ userId: string; displayName: string }>;
  inInstance: InviteTarget[];
  regulars: InviteTarget[];
  others: InviteTarget[];
  blacklisted: InviteTarget[];
};

async function resolveCurrentLocation(): Promise<{
  location: string | null;
  source: "vrcx" | "api" | null;
}> {
  const vrcxLoc = locationFromVrcx();
  if (vrcxLoc) {
    return {
      location: await resolveInstanceLocation(vrcxLoc),
      source: "vrcx",
    };
  }

  const user = await getCurrentUser();
  const apiLoc = locationFromPresence(user);
  if (!apiLoc) {
    return { location: null, source: null };
  }
  return {
    location: await resolveInstanceLocation(apiLoc),
    source: "api",
  };
}

function buildInstanceMemberSet(
  location: string | null,
  onlineFriends: VrcFriend[],
): {
  ids: Set<string>;
  members: Array<{ userId: string; displayName: string }>;
} {
  const ids = new Set<string>();
  const members: Array<{ userId: string; displayName: string }> = [];

  if (location && isVrcxAvailable()) {
    for (const m of usersInInstance(location)) {
      if (!ids.has(m.userId)) {
        ids.add(m.userId);
        members.push({ userId: m.userId, displayName: m.displayName });
      }
    }
  }

  if (location) {
    for (const f of friendsInLocation(onlineFriends, location)) {
      if (!ids.has(f.id)) {
        ids.add(f.id);
        members.push({
          userId: f.id,
          displayName: f.displayName ?? "",
        });
      }
    }
  }

  members.sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
  );

  return { ids, members };
}

function buildTarget(
  userId: string,
  displayName: string,
  regularEntry: RegularStats | undefined,
  onlineFriend: VrcFriend | undefined,
  instanceIds: Set<string>,
  blocked: boolean,
  canUnblock: boolean,
  lastSeen: string | null,
): InviteTarget {
  const name =
    onlineFriend?.displayName ||
    regularEntry?.displayName ||
    displayName ||
    userId;
  return {
    userId,
    displayName: name,
    alreadyInInstance: instanceIds.has(userId),
    blocked,
    online: Boolean(onlineFriend),
    distinctSaturdays: regularEntry?.distinctSaturdays,
    distinctTuesdays: regularEntry?.distinctTuesdays,
    canUnblock,
    lastSeen,
  };
}

export async function getInviteTargets(): Promise<InviteTargetsResult> {
  const { location, source } = await resolveCurrentLocation();
  const onlineFriends = await fetchInGameFriends();
  const regularsMap = loadManagedRegulars();
  const snapshot = loadRegularsSnapshot();
  const { ids: instanceIds, members } = buildInstanceMemberSet(
    location,
    onlineFriends,
  );

  const onlineById = new Map(onlineFriends.map((f) => [f.id, f]));
  const friendIds = onlineFriends.map((f) => f.id);
  const displayNames = new Map(
    onlineFriends.map((f) => [
      f.id,
      f.displayName || regularsMap.get(f.id)?.displayName || f.id,
    ]),
  );
  const lastSeenMap = isVrcxAvailable()
    ? getLastSeenForFriends(friendIds, displayNames)
    : new Map<string, string | null>();

  const inInstance: InviteTarget[] = [];
  const regulars: InviteTarget[] = [];
  const others: InviteTarget[] = [];
  const blacklisted: InviteTarget[] = [];
  const regularIds = new Set(regularsMap.keys());
  let regularsOnline = 0;

  for (const [userId, regularEntry] of regularsMap) {
    const onlineFriend = onlineById.get(userId);
    if (!onlineFriend) continue;

    const displayName = regularEntry.displayName;
    const blocked = isUserBlocked(userId, displayName);
    const target = buildTarget(
      userId,
      displayName,
      regularEntry,
      onlineFriend,
      instanceIds,
      blocked,
      canUnblockUser(userId, displayName),
      lastSeenMap.get(userId) ?? null,
    );

    if (blocked) {
      if (onlineFriend) blacklisted.push(target);
      continue;
    }

    if (target.online) regularsOnline += 1;

    if (target.alreadyInInstance) {
      inInstance.push(target);
      continue;
    }

    regulars.push(target);
  }

  for (const friend of onlineFriends) {
    if (regularIds.has(friend.id)) continue;

    const displayName = friend.displayName || friend.id;
    const blocked = isUserBlocked(friend.id, displayName);
    const target = buildTarget(
      friend.id,
      displayName,
      undefined,
      friend,
      instanceIds,
      blocked,
      canUnblockUser(friend.id, displayName),
      lastSeenMap.get(friend.id) ?? null,
    );

    if (blocked) {
      blacklisted.push(target);
      continue;
    }

    if (target.alreadyInInstance) {
      inInstance.push(target);
      continue;
    }

    others.push(target);
  }

  const sortByName = (a: InviteTarget, b: InviteTarget) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });

  inInstance.sort(sortByName);
  regulars.sort(sortByName);
  others.sort(sortByName);
  blacklisted.sort(sortByName);

  return {
    location,
    locationSource: source,
    vrcxAvailable: isVrcxAvailable(),
    regularsUpdatedAt: snapshot?.updatedAt ?? null,
    regularsTotal: regularsMap.size,
    regularsOnline,
    instanceMembers: members,
    inInstance,
    regulars,
    others,
    blacklisted,
  };
}

export async function getResolvedInviteLocation(): Promise<string> {
  const { location } = await resolveCurrentLocation();
  if (!location) {
    throw new Error("You are not in a world/instance. Join VRChat first.");
  }
  return location;
}
