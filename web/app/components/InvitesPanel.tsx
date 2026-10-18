"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatRelativeLastSeen } from "@/lib/format";
import { FriendCard } from "./FriendCard";
import { Toast } from "./Toast";
import styles from "./InvitesPanel.module.css";

type InviteTarget = {
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

type TargetsResponse = {
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

type StatusResponse = {
  authenticated?: boolean;
  displayName?: string | null;
  vrcxAvailable?: boolean;
  error?: string;
};

type ToastState = { message: string; type: "success" | "error" } | null;

type ManageAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "danger";
};

type SortMode = "alphabetical" | "lastSeen";

const DEFAULT_MESSAGE = "Movie night — join us for the feature!";

const REFRESH_INTERVAL_OPTIONS = [15, 30, 60, 120] as const;
const AUTO_REFRESH_STORAGE_KEY = "invites-auto-refresh";
const REFRESH_INTERVAL_STORAGE_KEY = "invites-refresh-seconds";

function readAutoRefreshEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
  return stored === null ? true : stored === "true";
}

function readRefreshIntervalSeconds(): number {
  if (typeof window === "undefined") return 15;
  const stored = Number(localStorage.getItem(REFRESH_INTERVAL_STORAGE_KEY));
  return REFRESH_INTERVAL_OPTIONS.includes(stored as (typeof REFRESH_INTERVAL_OPTIONS)[number])
    ? stored
    : 15;
}

function sortTargets(targets: InviteTarget[], mode: SortMode): InviteTarget[] {
  const copy = [...targets];
  if (mode === "alphabetical") {
    copy.sort((a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
    );
    return copy;
  }

  copy.sort((a, b) => {
    const ta = a.lastSeen ? Date.parse(a.lastSeen) : 0;
    const tb = b.lastSeen ? Date.parse(b.lastSeen) : 0;
    if (tb !== ta) return tb - ta;
    return a.displayName.localeCompare(b.displayName, undefined, {
      sensitivity: "base",
    });
  });
  return copy;
}

function toCardTarget(
  target: InviteTarget,
  sortMode: SortMode,
): InviteTarget & { lastSeenLabel?: string } {
  return {
    ...target,
    lastSeenLabel:
      sortMode === "lastSeen" ? formatRelativeLastSeen(target.lastSeen) : undefined,
  };
}

function defaultSelected(
  targets: InviteTarget[],
  invited: Set<string>,
  onlineOnly = false,
): Set<string> {
  return new Set(
    targets
      .filter(
        (t) => (!onlineOnly || t.online) && !invited.has(t.userId),
      )
      .map((t) => t.userId),
  );
}

export function InvitesPanel() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [targets, setTargets] = useState<TargetsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [messageSlot, setMessageSlot] = useState(1);
  const [bulkMode, setBulkMode] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("alphabetical");
  const [manageRegulars, setManageRegulars] = useState(false);
  const [manageBlocklist, setManageBlocklist] = useState(false);
  const [selectedRegulars, setSelectedRegulars] = useState<Set<string>>(new Set());
  const [selectedOthers, setSelectedOthers] = useState<Set<string>>(new Set());
  const [othersOpen, setOthersOpen] = useState(false);
  const [blacklistOpen, setBlacklistOpen] = useState(false);
  const [addRegularId, setAddRegularId] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingUserId, setLoadingUserId] = useState<string | null>(null);
  const [listActionUserId, setListActionUserId] = useState<string | null>(null);
  const [syncingRegulars, setSyncingRegulars] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(readAutoRefreshEnabled);
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(
    readRefreshIntervalSeconds,
  );
  const [lastLiveRefresh, setLastLiveRefresh] = useState<Date | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [invitedUserIds, setInvitedUserIds] = useState<Set<string>>(new Set());
  const invitedUserIdsRef = useRef(invitedUserIds);
  invitedUserIdsRef.current = invitedUserIds;
  const [toast, setToast] = useState<ToastState>(null);

  const showToast = useCallback((msg: string, type: "success" | "error") => {
    setToast({ message: msg, type });
    window.setTimeout(() => setToast(null), 6000);
  }, []);

  const applyTargetsInitial = useCallback((targetsData: TargetsResponse) => {
    setTargets(targetsData);
    const invited = invitedUserIdsRef.current;
    setSelectedRegulars(defaultSelected(targetsData.regulars, invited, true));
    setSelectedOthers(defaultSelected(targetsData.others, invited));
  }, []);

  const updateTargetsSilently = useCallback((targetsData: TargetsResponse) => {
    setTargets(targetsData);
    setSelectedRegulars((prev) => {
      const valid = new Set(targetsData.regulars.map((t) => t.userId));
      return new Set([...prev].filter((id) => valid.has(id)));
    });
    setSelectedOthers((prev) => {
      const valid = new Set(targetsData.others.map((t) => t.userId));
      return new Set([...prev].filter((id) => valid.has(id)));
    });
  }, []);

  const refreshLiveData = useCallback(
    async (options?: { silent?: boolean; resetSelection?: boolean }) => {
      const silent = options?.silent ?? true;
      const resetSelection = options?.resetSelection ?? false;

      try {
        const statusRes = await fetch("/api/vrchat/status");
        const statusData = (await statusRes.json()) as StatusResponse & {
          error?: string;
        };

        if (statusRes.status === 503) {
          if (!silent) {
            setConfigError(statusData.error ?? "VRChat not configured");
            setStatus(null);
            setTargets(null);
          }
          return;
        }

        if (statusRes.status === 401) {
          if (!silent) {
            setLoadError(statusData.error ?? "VRChat auth expired");
            setStatus(null);
            setTargets(null);
          }
          return;
        }

        if (!statusRes.ok) {
          if (!silent) {
            throw new Error(statusData.error ?? "Status failed");
          }
          return;
        }

        setStatus(statusData);

        const targetsRes = await fetch("/api/vrchat/invite-targets");
        const targetsData = (await targetsRes.json()) as TargetsResponse & {
          error?: string;
        };

        if (!targetsRes.ok) {
          if (!silent) {
            throw new Error(targetsData.error ?? "Failed to load targets");
          }
          return;
        }

        if (resetSelection) {
          applyTargetsInitial(targetsData);
        } else {
          updateTargetsSilently(targetsData);
        }

        setLastLiveRefresh(new Date());
      } catch (error) {
        if (!silent) {
          setLoadError(error instanceof Error ? error.message : "Load failed");
        }
      }
    },
    [applyTargetsInitial, updateTargetsSilently],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setConfigError(null);

    try {
      await refreshLiveData({ silent: false, resetSelection: true });
    } finally {
      setLoading(false);
    }
  }, [refreshLiveData]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(autoRefreshEnabled));
  }, [autoRefreshEnabled]);

  useEffect(() => {
    localStorage.setItem(
      REFRESH_INTERVAL_STORAGE_KEY,
      String(refreshIntervalSeconds),
    );
  }, [refreshIntervalSeconds]);

  useEffect(() => {
    if (!autoRefreshEnabled || configError || loadError) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshLiveData({ silent: true });
    }, refreshIntervalSeconds * 1000);

    return () => window.clearInterval(intervalId);
  }, [
    autoRefreshEnabled,
    refreshIntervalSeconds,
    configError,
    loadError,
    refreshLiveData,
  ]);

  useEffect(() => {
    if (targets && !targets.vrcxAvailable && sortMode === "lastSeen") {
      setSortMode("alphabetical");
    }
  }, [targets, sortMode]);

  const allSelectedIds = useMemo(() => {
    return [...selectedRegulars, ...selectedOthers];
  }, [selectedRegulars, selectedOthers]);

  const sortedInInstance = useMemo(
    () => (targets ? sortTargets(targets.inInstance, sortMode) : []),
    [targets, sortMode],
  );
  const sortedRegulars = useMemo(
    () => (targets ? sortTargets(targets.regulars, sortMode) : []),
    [targets, sortMode],
  );
  const sortedOthers = useMemo(
    () => (targets ? sortTargets(targets.others, sortMode) : []),
    [targets, sortMode],
  );
  const sortedBlacklisted = useMemo(
    () => (targets ? sortTargets(targets.blacklisted, sortMode) : []),
    [targets, sortMode],
  );

  const toggle = (
    userId: string,
    set: React.Dispatch<React.SetStateAction<Set<string>>>,
  ) => {
    set((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const setSectionAll = (
    list: InviteTarget[],
    set: React.Dispatch<React.SetStateAction<Set<string>>>,
    select: boolean,
    onlineOnly = false,
  ) => {
    if (select) {
      set(
        new Set(
          list
            .filter(
              (t) =>
                (!onlineOnly || t.online) && !invitedUserIds.has(t.userId),
            )
            .map((t) => t.userId),
        ),
      );
    } else {
      set(new Set());
    }
  };

  const markInvited = (userIds: string[]) => {
    if (userIds.length === 0) return;
    setInvitedUserIds((prev) => {
      const next = new Set(prev);
      for (const id of userIds) next.add(id);
      return next;
    });
    setSelectedRegulars((prev) => {
      const next = new Set(prev);
      for (const id of userIds) next.delete(id);
      return next;
    });
    setSelectedOthers((prev) => {
      const next = new Set(prev);
      for (const id of userIds) next.delete(id);
      return next;
    });
  };

  const clearInvitedMarks = () => {
    setInvitedUserIds(new Set());
    if (targets) {
      setSelectedRegulars(defaultSelected(targets.regulars, new Set(), true));
      setSelectedOthers(defaultSelected(targets.others, new Set()));
    }
  };

  const updateRegular = async (
    action: "add" | "remove",
    userId: string,
    displayName?: string,
  ) => {
    setListActionUserId(userId);
    try {
      const response = await fetch("/api/vrchat/regulars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, userId, displayName }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to update regulars");
      }
      await refreshLiveData({ silent: true });
      showToast(
        action === "add"
          ? `Added ${displayName ?? "friend"} to regulars.`
          : `Removed ${displayName ?? "friend"} from regulars.`,
        "success",
      );
      if (action === "add") setAddRegularId("");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to update regulars",
        "error",
      );
    } finally {
      setListActionUserId(null);
    }
  };

  const updateBlocklist = async (
    action: "add" | "remove",
    userId: string,
    displayName?: string,
  ) => {
    setListActionUserId(userId);
    try {
      const response = await fetch("/api/vrchat/blocklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, userId, displayName }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to update blocklist");
      }
      await refreshLiveData({ silent: true });
      showToast(
        action === "add"
          ? `Blocked ${displayName ?? "user"}.`
          : `Unblocked ${displayName ?? "user"}.`,
        "success",
      );
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to update blocklist",
        "error",
      );
    } finally {
      setListActionUserId(null);
    }
  };

  const syncRegularsFromVrcx = async () => {
    setSyncingRegulars(true);
    try {
      const response = await fetch("/api/vrchat/regulars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync-from-vrcx" }),
      });
      const data = (await response.json()) as {
        error?: string;
        count?: number;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to rebuild regulars from VRCX");
      }
      await refreshLiveData({ silent: true });
      showToast(
        `Saved ${data.count ?? 0} Movie Night regulars from VRCX.`,
        "success",
      );
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "VRCX regulars sync failed",
        "error",
      );
    } finally {
      setSyncingRegulars(false);
    }
  };

  const runInvite = async (dryRun: boolean) => {
    if (message.length > 64) {
      showToast("Message must be 64 characters or fewer", "error");
      return;
    }

    setSending(true);
    setPreview(null);

    try {
      const response = await fetch("/api/vrchat/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIds: allSelectedIds,
          message,
          messageSlot,
          withMessage: message.length > 0,
          dryRun,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        dryRun?: boolean;
        wouldSend?: Array<{ userId: string; displayName: string }>;
        skipped?: Array<{ displayName: string; reason: string }>;
        sent?: number;
        sentUsers?: Array<{ userId: string; displayName: string }>;
        failed?: unknown[];
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Invite failed");
      }

      if (dryRun) {
        const names = (data.wouldSend ?? []).map((u) => u.displayName).join(", ");
        setPreview(
          `Would invite ${data.wouldSend?.length ?? 0}: ${names || "(none)"}. Skipped: ${data.skipped?.length ?? 0}.`,
        );
        return;
      }

      const failed = data.failed?.length ?? 0;
      const sentIds = (data.sentUsers ?? []).map((u) => u.userId);
      markInvited(sentIds);
      showToast(
        `Sent ${data.sent ?? 0} invite(s)${failed ? `, ${failed} failed` : ""}.`,
        failed ? "error" : "success",
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Invite failed", "error");
    } finally {
      setSending(false);
    }
  };

  const inviteOne = async (userId: string, withMessage: boolean) => {
    if (withMessage && message.length > 64) {
      showToast("Message must be 64 characters or fewer", "error");
      return;
    }

    setLoadingUserId(userId);

    try {
      const response = await fetch("/api/vrchat/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIds: [userId],
          message,
          messageSlot,
          withMessage,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        sent?: number;
        sentUsers?: Array<{ userId: string; displayName: string }>;
        failed?: unknown[];
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Invite failed");
      }

      const sentIds = (data.sentUsers ?? []).map((u) => u.userId);
      if (sentIds.length > 0) {
        markInvited(sentIds);
        showToast(`Invited ${data.sentUsers?.[0]?.displayName ?? "friend"}.`, "success");
      } else if ((data.failed?.length ?? 0) > 0) {
        showToast("Invite failed", "error");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Invite failed", "error");
    } finally {
      setLoadingUserId(null);
    }
  };

  const renderInviteableCard = (
    target: InviteTarget,
    selected: Set<string>,
    setSelected: React.Dispatch<React.SetStateAction<Set<string>>>,
    manageActions?: ManageAction[],
  ) => {
    const invited = invitedUserIds.has(target.userId);
    const busy =
      loadingUserId === target.userId || listActionUserId === target.userId;

    return (
      <FriendCard
        key={target.userId}
        target={toCardTarget(target, sortMode)}
        variant="inviteable"
        invited={invited}
        bulkMode={bulkMode && !manageActions?.length}
        selected={selected.has(target.userId)}
        loading={busy}
        onToggle={() => toggle(target.userId, setSelected)}
        onInvite={(withMsg) => void inviteOne(target.userId, withMsg)}
        manageActions={manageActions}
      />
    );
  };

  const othersManageActions = (target: InviteTarget): ManageAction[] | undefined => {
    const actions: ManageAction[] = [];
    if (manageRegulars) {
      actions.push({
        label: "Add to regulars",
        onClick: () => void updateRegular("add", target.userId, target.displayName),
      });
    }
    if (manageBlocklist) {
      actions.push({
        label: "Block",
        variant: "danger",
        onClick: () => void updateBlocklist("add", target.userId, target.displayName),
      });
    }
    return actions.length > 0 ? actions : undefined;
  };

  const displayName = status?.displayName ?? "you";

  if (loading) {
    return (
      <main className={styles.page}>
        <p className={styles.hint}>Loading VRChat data…</p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <h1>VRChat invites</h1>
        <p>
          Invite Movie Night regulars and other friends who are in VRChat to
          your current instance. Friends who are only active on VRCX or the
          mobile app are not listed. Hover a card to invite, or turn on bulk
          select to send many at once.
        </p>
      </header>

      {configError && (
        <div className={styles.alert}>
          <strong>VRChat not configured.</strong> Add{" "}
          <code>VRCHAT_USER_AGENT</code> and <code>VRCHAT_AUTH_COOKIE</code> to{" "}
          <code>web/.env</code> (copy from your vrchat-cli setup), then restart
          Docker.
        </div>
      )}

      {loadError && !configError && (
        <div className={styles.alert}>{loadError}</div>
      )}

      {status && (
        <section className={styles.statusCard}>
          <div>
            <strong>{status.displayName ?? "Unknown"}</strong>
            <span className={styles.hint}>
              VRCX DB: {status.vrcxAvailable ? "connected" : "unavailable"}
            </span>
          </div>
          {targets?.location ? (
            <p className={styles.location} title={targets.location}>
              Instance ({targets.locationSource ?? "?"}):{" "}
              {targets.location.length > 80
                ? `${targets.location.slice(0, 80)}…`
                : targets.location}
            </p>
          ) : (
            <p className={styles.warn}>Not in a world — join VRChat first.</p>
          )}
          {targets && targets.instanceMembers.length > 0 && (
            <p className={styles.hint}>
              {targets.instanceMembers.length} in instance:{" "}
              {targets.instanceMembers.map((m) => m.displayName).join(", ")}
            </p>
          )}
          <div className={styles.statusActions}>
            <button
              type="button"
              className={styles.refresh}
              onClick={() => void refreshLiveData({ silent: true })}
            >
              Refresh now
            </button>
            <label className={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={autoRefreshEnabled}
                onChange={(e) => setAutoRefreshEnabled(e.target.checked)}
              />
              Auto-refresh
            </label>
            <label className={styles.refreshIntervalLabel}>
              Every
              <select
                value={refreshIntervalSeconds}
                disabled={!autoRefreshEnabled}
                onChange={(e) =>
                  setRefreshIntervalSeconds(Number(e.target.value))
                }
              >
                {REFRESH_INTERVAL_OPTIONS.map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds} sec
                  </option>
                ))}
              </select>
            </label>
          </div>
          {lastLiveRefresh && (
            <p className={styles.hint}>
              {autoRefreshEnabled
                ? `Live updates every ${refreshIntervalSeconds}s · last checked ${lastLiveRefresh.toLocaleTimeString()}`
                : `Last checked ${lastLiveRefresh.toLocaleTimeString()}`}
            </p>
          )}
        </section>
      )}

      {targets && (
        <>
          <section className={styles.controls}>
            <label>
              Invite message ({message.length}/64)
              <input
                type="text"
                maxLength={64}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </label>
            <label>
              Message slot
              <select
                value={messageSlot}
                onChange={(e) => setMessageSlot(Number(e.target.value))}
              >
                <option value={1}>Slot 1</option>
                <option value={2}>Slot 2</option>
              </select>
            </label>
            <label className={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={bulkMode}
                onChange={(e) => setBulkMode(e.target.checked)}
              />
              Bulk select
            </label>
            <div className={styles.sortGroup}>
              <span className={styles.sortLabel}>Sort</span>
              <div className={styles.sortToggle}>
                <button
                  type="button"
                  className={
                    sortMode === "alphabetical" ? styles.sortActive : undefined
                  }
                  onClick={() => setSortMode("alphabetical")}
                >
                  Alphabetical
                </button>
                <button
                  type="button"
                  className={sortMode === "lastSeen" ? styles.sortActive : undefined}
                  disabled={!targets.vrcxAvailable}
                  title={
                    targets.vrcxAvailable
                      ? "Most recently seen in your instances first (VRCX)"
                      : "VRCX database unavailable"
                  }
                  onClick={() => setSortMode("lastSeen")}
                >
                  Last seen
                </button>
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <h2>In instance with {displayName}</h2>
            <div className={styles.grid}>
              {sortedInInstance.length === 0 ? (
                <p className={styles.emptyState}>No friends in your instance.</p>
              ) : (
                sortedInInstance.map((t) => (
                  <FriendCard
                    key={t.userId}
                    target={toCardTarget(t, sortMode)}
                    variant="inInstance"
                  />
                ))
              )}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2>
                Movie Night regulars ({targets.regularsOnline} online
                {targets.regularsTotal > targets.regularsOnline
                  ? ` · ${targets.regularsTotal} saved`
                  : ""}
                )
              </h2>
              <div className={styles.sectionActions}>
                <label className={styles.toggleLabel}>
                  <input
                    type="checkbox"
                    checked={manageRegulars}
                    onChange={(e) => setManageRegulars(e.target.checked)}
                  />
                  Manage list
                </label>
                {bulkMode && !manageRegulars && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setSectionAll(
                          sortedRegulars,
                          setSelectedRegulars,
                          true,
                          true,
                        )
                      }
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSectionAll(
                          sortedRegulars,
                          setSelectedRegulars,
                          false,
                          true,
                        )
                      }
                    >
                      Clear
                    </button>
                  </>
                )}
              </div>
            </div>
            {targets.regularsUpdatedAt ? (
              <p className={styles.manageHint}>
                Saved list from{" "}
                {new Date(targets.regularsUpdatedAt).toLocaleString()}. Add or
                remove members below — the list does not update automatically.
              </p>
            ) : (
              <p className={styles.manageHint}>
                No saved regulars list yet. Turn on Manage list and use Rebuild
                from VRCX to create one.
              </p>
            )}
            {manageRegulars && (
              <>
                <p className={styles.manageHint}>
                  Hover a regular to remove them, or add from other in-VRChat
                  friends below.
                </p>
                <div className={styles.addRow}>
                  <button
                    type="button"
                    disabled={syncingRegulars || !targets.vrcxAvailable}
                    onClick={() => void syncRegularsFromVrcx()}
                  >
                    {syncingRegulars ? "Rebuilding…" : "Rebuild from VRCX"}
                  </button>
                </div>
              </>
            )}
            <div className={styles.grid}>
              {sortedRegulars.length === 0 ? (
                <p className={styles.emptyState}>
                  No regulars in VRChat right now.
                </p>
              ) : (
                sortedRegulars.map((t) =>
                  renderInviteableCard(
                    t,
                    selectedRegulars,
                    setSelectedRegulars,
                    manageRegulars
                      ? [
                          {
                            label: "Remove from regulars",
                            variant: "danger",
                            onClick: () =>
                              void updateRegular("remove", t.userId, t.displayName),
                          },
                        ]
                      : undefined,
                  ),
                )
              )}
            </div>
            {manageRegulars && sortedOthers.length > 0 && (
              <div className={styles.addRow}>
                <select
                  value={addRegularId}
                  onChange={(e) => setAddRegularId(e.target.value)}
                >
                  <option value="">Add in-VRChat friend to regulars…</option>
                  {sortedOthers.map((t) => (
                    <option key={t.userId} value={t.userId}>
                      {t.displayName}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!addRegularId || listActionUserId !== null}
                  onClick={() => {
                    const friend = targets.others.find((t) => t.userId === addRegularId);
                    if (friend) {
                      void updateRegular("add", friend.userId, friend.displayName);
                    }
                  }}
                >
                  Add
                </button>
              </div>
            )}
          </section>

          <section className={styles.section}>
            <button
              type="button"
              className={styles.collapseHead}
              onClick={() => setOthersOpen((o) => !o)}
            >
              <h2>Other in-VRChat friends ({sortedOthers.length})</h2>
              <span>{othersOpen ? "−" : "+"}</span>
            </button>
            {othersOpen && (
              <>
                <div className={styles.sectionActions}>
                  {bulkMode && !manageRegulars && !manageBlocklist && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          setSectionAll(sortedOthers, setSelectedOthers, true)
                        }
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setSectionAll(sortedOthers, setSelectedOthers, false)
                        }
                      >
                        Clear
                      </button>
                    </>
                  )}
                  <label className={styles.toggleLabel}>
                    <input
                      type="checkbox"
                      checked={manageBlocklist}
                      onChange={(e) => setManageBlocklist(e.target.checked)}
                    />
                    Manage blocklist
                  </label>
                </div>
                {(manageRegulars || manageBlocklist) && (
                  <p className={styles.manageHint}>
                    {manageRegulars && manageBlocklist
                      ? "Hover a card to add to regulars or block."
                      : manageRegulars
                        ? "Hover a card to add them to regulars."
                        : "Hover a card to block them."}
                  </p>
                )}
                <div className={styles.grid}>
                  {sortedOthers.length === 0 ? (
                    <p className={styles.emptyState}>No other online friends.</p>
                  ) : (
                    sortedOthers.map((t) =>
                      renderInviteableCard(
                        t,
                        selectedOthers,
                        setSelectedOthers,
                        othersManageActions(t),
                      ),
                    )
                  )}
                </div>
              </>
            )}

            <button
              type="button"
              className={`${styles.collapseHead} ${styles.subSectionHead}`}
              onClick={() => setBlacklistOpen((o) => !o)}
            >
              <h2>Blacklisted ({sortedBlacklisted.length} online)</h2>
              <span>{blacklistOpen ? "−" : "+"}</span>
            </button>
            {blacklistOpen && (
              <>
                <div className={styles.sectionActions}>
                  <label className={styles.toggleLabel}>
                    <input
                      type="checkbox"
                      checked={manageBlocklist}
                      onChange={(e) => setManageBlocklist(e.target.checked)}
                    />
                    Manage blocklist
                  </label>
                </div>
                {manageBlocklist && (
                  <p className={styles.manageHint}>
                    Hover a blocked user to unblock them (when allowed). Name-pattern
                    blocks cannot be removed here.
                  </p>
                )}
                <div className={styles.grid}>
                  {sortedBlacklisted.length === 0 ? (
                    <p className={styles.emptyState}>
                      No blacklisted users online right now.
                    </p>
                  ) : (
                    sortedBlacklisted.map((t) => (
                      <FriendCard
                        key={t.userId}
                        target={toCardTarget(t, sortMode)}
                        variant="blacklisted"
                        loading={listActionUserId === t.userId}
                        manageActions={
                          manageBlocklist && t.canUnblock
                            ? [
                                {
                                  label: "Unblock",
                                  onClick: () =>
                                    void updateBlocklist(
                                      "remove",
                                      t.userId,
                                      t.displayName,
                                    ),
                                },
                              ]
                            : undefined
                        }
                      />
                    ))
                  )}
                </div>
              </>
            )}
          </section>

          {bulkMode && !manageRegulars && !manageBlocklist && (
            <div className={styles.actions}>
              <button
                type="button"
                disabled={sending || allSelectedIds.length === 0}
                onClick={() => void runInvite(true)}
              >
                {sending ? "Working…" : "Preview (dry run)"}
              </button>
              <button
                type="button"
                className={styles.primary}
                disabled={
                  sending || allSelectedIds.length === 0 || !targets.location
                }
                onClick={() => void runInvite(false)}
              >
                {sending
                  ? "Sending…"
                  : `Send ${allSelectedIds.length} invite(s)`}
              </button>
              {invitedUserIds.size > 0 && (
                <button type="button" onClick={clearInvitedMarks}>
                  Clear invited marks
                </button>
              )}
            </div>
          )}

          {preview && <p className={styles.preview}>{preview}</p>}
        </>
      )}

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}
    </main>
  );
}
