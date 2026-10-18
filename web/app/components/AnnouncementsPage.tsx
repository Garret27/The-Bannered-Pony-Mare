"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatDiscordEventTimestampsPreview,
  formatDiscordTimestampLongPreview,
  parseEventDateTime,
} from "@/lib/event-datetime";
import type { Event } from "@/lib/paths";
import { EVENT_LABELS, EVENTS } from "@/lib/paths";
import { Toast } from "./Toast";
import styles from "./AnnouncementsPage.module.css";

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

type PanelState = {
  movieTitle: string;
  eventDate: string;
  eventTime: string;
  customText: string;
  mentionRole: boolean;
  includePoster: boolean;
  sendDate: string;
  sendTime: string;
};

export type ScheduledAnnouncement = {
  id: string;
  event: Event;
  status: "scheduled" | "sent" | "cancelled" | "failed";
  sendAt: string;
  movieTitle: string;
  eventDate: string;
  eventTime: string;
  customText: string;
  mentionRole: boolean;
  includePoster: boolean;
  hasPosterOverride: boolean;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  lastError: string | null;
};

type EditDraft = {
  movieTitle: string;
  eventDate: string;
  eventTime: string;
  customText: string;
  sendDate: string;
  sendTime: string;
  mentionRole: boolean;
  includePoster: boolean;
};

type ToastState = { message: string; type: "success" | "error" } | null;

function customTextStorageKey(event: Event): string {
  return `announcement-custom-${event}`;
}

function mentionRoleStorageKey(event: Event): string {
  return `announcement-mention-role-${event}`;
}

function includePosterStorageKey(event: Event): string {
  return `announcement-include-poster-${event}`;
}

function readCustomText(event: Event): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(customTextStorageKey(event)) ?? "";
}

function readMentionRole(event: Event): boolean {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem(mentionRoleStorageKey(event));
  return stored === null ? true : stored === "true";
}

function readIncludePoster(event: Event): boolean {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem(includePosterStorageKey(event));
  return stored === null ? true : stored === "true";
}

function defaultSendParts(
  eventDate: string,
  eventTime: string,
): { sendDate: string; sendTime: string } {
  return {
    sendDate: eventDate,
    sendTime: eventTime || "17:00",
  };
}

function sendPartsInTimezone(
  sendAtIso: string,
  timezone: string,
): { sendDate: string; sendTime: string } {
  const sendAt = new Date(sendAtIso);
  const sendDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(sendAt);
  const sendParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(sendAt);
  const hour = sendParts.find((part) => part.type === "hour")?.value ?? "12";
  const minute = sendParts.find((part) => part.type === "minute")?.value ?? "00";
  return { sendDate, sendTime: `${hour}:${minute}` };
}

function buildPreviewText(params: {
  mentionRole: boolean;
  roleConfigured: boolean;
  eventLabel: string;
  movieTitle: string;
  eventDate: string;
  eventTime: string;
  customText: string;
  timezone: string;
}): string {
  const lines: string[] = [];
  const custom = params.customText.trim();
  const roleLabel = `@${params.eventLabel} role`;

  if (params.mentionRole && params.roleConfigured && custom) {
    lines.push(`${roleLabel} ${custom}`);
  } else if (params.mentionRole && params.roleConfigured) {
    lines.push(roleLabel);
  } else if (custom) {
    lines.push(custom);
  }

  const eventAt = parseEventDateTime(params.eventDate, params.eventTime, params.timezone);
  if (eventAt) {
    lines.push(formatDiscordEventTimestampsPreview(eventAt.toISOString(), params.timezone));
  } else {
    lines.push(`${params.eventDate} ${params.eventTime}`);
  }

  const movieTitle = params.movieTitle.trim();
  if (movieTitle) {
    lines.push(`**${movieTitle}**`);
  }

  return lines.join("\n");
}

type EventAnnouncementPanelProps = {
  draft: AnnouncementDraft;
  posterCacheKey: string;
  onToast: (message: string, type: "success" | "error") => void;
  onSchedulesChanged: () => void;
  embedded?: boolean;
};

export function EventAnnouncementPanel({
  draft,
  posterCacheKey,
  onToast,
  onSchedulesChanged,
  embedded = false,
}: EventAnnouncementPanelProps) {
  const initialSend = defaultSendParts(draft.suggestedDate, draft.suggestedTime);
  const [state, setState] = useState<PanelState>(() => ({
    movieTitle: draft.movieTitle,
    eventDate: draft.suggestedDate,
    eventTime: draft.suggestedTime,
    customText: readCustomText(draft.event),
    mentionRole: readMentionRole(draft.event),
    includePoster: readIncludePoster(draft.event),
    sendDate: initialSend.sendDate,
    sendTime: initialSend.sendTime,
  }));
  const [posting, setPosting] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [cooldown, setCooldown] = useState(false);

  useEffect(() => {
    const send = defaultSendParts(draft.suggestedDate, draft.suggestedTime);
    setState((current) => ({
      ...current,
      movieTitle: draft.movieTitle,
      eventDate: draft.suggestedDate,
      eventTime: draft.suggestedTime,
      sendDate: send.sendDate,
      sendTime: send.sendTime,
    }));
  }, [draft.movieTitle, draft.suggestedDate, draft.suggestedTime]);

  const previewText = useMemo(
    () =>
      buildPreviewText({
        mentionRole: state.mentionRole,
        roleConfigured: draft.roleConfigured,
        eventLabel: draft.eventLabel,
        movieTitle: state.movieTitle,
        eventDate: state.eventDate,
        eventTime: state.eventTime,
        customText: state.customText,
        timezone: draft.timezone,
      }),
    [
      draft.eventLabel,
      draft.roleConfigured,
      draft.timezone,
      state.customText,
      state.eventDate,
      state.eventTime,
      state.mentionRole,
      state.movieTitle,
    ],
  );

  const canCompose =
    draft.webhookConfigured &&
    (!state.includePoster || draft.posterExists) &&
    state.movieTitle.trim().length > 0;

  const canPost = canCompose && !posting && !cooldown && !scheduling;
  const canSchedule =
    canCompose &&
    state.sendDate.trim().length > 0 &&
    state.sendTime.trim().length > 0 &&
    !posting &&
    !scheduling;

  const handleCustomTextChange = (value: string) => {
    setState((current) => ({ ...current, customText: value }));
    localStorage.setItem(customTextStorageKey(draft.event), value);
  };

  const handleMentionRoleChange = (checked: boolean) => {
    setState((current) => ({ ...current, mentionRole: checked }));
    localStorage.setItem(mentionRoleStorageKey(draft.event), String(checked));
  };

  const handleIncludePosterChange = (checked: boolean) => {
    setState((current) => ({ ...current, includePoster: checked }));
    localStorage.setItem(includePosterStorageKey(draft.event), String(checked));
  };

  const handleMovieTitleChange = (value: string) => {
    setState((current) => ({ ...current, movieTitle: value }));
  };

  const handleResetMovieTitle = () => {
    setState((current) => ({ ...current, movieTitle: draft.movieTitle }));
  };

  const handleEventDateChange = (value: string) => {
    setState((current) => {
      const send = defaultSendParts(value, current.eventTime);
      return {
        ...current,
        eventDate: value,
        sendDate: send.sendDate,
        sendTime: send.sendTime,
      };
    });
  };

  const handleEventTimeChange = (value: string) => {
    setState((current) => {
      const send = defaultSendParts(current.eventDate, value);
      return {
        ...current,
        eventTime: value,
        sendDate: send.sendDate,
        sendTime: send.sendTime,
      };
    });
  };

  const payloadFromState = () => ({
    movieTitle: state.movieTitle.trim(),
    eventDate: state.eventDate,
    eventTime: state.eventTime,
    customText: state.customText,
    mentionRole: state.mentionRole,
    includePoster: state.includePoster,
  });

  const handlePost = async () => {
    if (!canPost) return;

    const confirmed = window.confirm(
      `Post announcement to ${draft.eventLabel} Discord now?`,
    );
    if (!confirmed) return;

    setPosting(true);
    try {
      const response = await fetch(`/api/announcements/${draft.event}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadFromState()),
      });

      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to post announcement");
      }

      onToast(data.message ?? "Announcement posted to Discord", "success");
      setCooldown(true);
      window.setTimeout(() => setCooldown(false), 2000);
    } catch (error) {
      onToast(
        error instanceof Error ? error.message : "Failed to post announcement",
        "error",
      );
    } finally {
      setPosting(false);
    }
  };

  const handleSchedule = async () => {
    if (!canSchedule) return;

    setScheduling(true);
    try {
      const response = await fetch(`/api/announcements/${draft.event}/schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payloadFromState(),
          sendDate: state.sendDate,
          sendTime: state.sendTime,
        }),
      });

      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to schedule announcement");
      }

      onToast(data.message ?? "Announcement scheduled", "success");
      onSchedulesChanged();
    } catch (error) {
      onToast(
        error instanceof Error ? error.message : "Failed to schedule announcement",
        "error",
      );
    } finally {
      setScheduling(false);
    }
  };

  const panelClass = embedded
    ? `${styles.panel} ${styles.embedded}`
    : draft.event === "main"
      ? `${styles.panel} ${styles.main}`
      : `${styles.panel} ${styles.hspc}`;

  return (
    <section className={panelClass}>
      <div className={styles.header}>
        <div>
          <h2>{embedded ? "Announcement" : draft.eventLabel}</h2>
          <p>
            {draft.event === "main"
              ? `Saturdays at ${draft.suggestedTime} (${draft.timezone.replace("_", " ")})`
              : `Tuesdays at ${draft.suggestedTime} (${draft.timezone.replace("_", " ")})`}
          </p>
        </div>
      </div>

      <div className={styles.statusRow}>
        <span
          className={`${styles.statusPill} ${draft.webhookConfigured ? styles.online : styles.offline}`}
        >
          <span className={styles.statusDot} />
          Webhook {draft.webhookConfigured ? "configured" : "missing"}
        </span>
        <span
          className={`${styles.statusPill} ${draft.posterExists ? styles.online : styles.offline}`}
        >
          <span className={styles.statusDot} />
          Poster {draft.posterExists ? "ready" : "missing"}
        </span>
        <span
          className={`${styles.statusPill} ${draft.roleConfigured ? styles.online : styles.offline}`}
        >
          <span className={styles.statusDot} />
          Role {draft.roleConfigured ? "configured" : "missing"}
        </span>
      </div>

      {!draft.webhookConfigured && (
        <div className={styles.alert}>
          Configure the {draft.eventLabel} Discord webhook in Settings.
        </div>
      )}

      {state.includePoster && !draft.posterExists && (
        <div className={styles.alert}>
          {embedded
            ? "Upload a poster above, or uncheck \"Attach poster\" below."
            : "Upload a poster on the Dashboard, or uncheck \"Attach poster\" below."}
        </div>
      )}

      <div className={styles.field}>
        <label htmlFor={`${draft.event}-title`}>Movie</label>
        <input
          id={`${draft.event}-title`}
          type="text"
          value={state.movieTitle}
          onChange={(event) => handleMovieTitleChange(event.target.value)}
          placeholder="Movie title"
        />
        <span className={styles.hint}>
          Loaded from the Dashboard Movie Title and included in the announcement
          as bold text.{" "}
          {state.movieTitle !== draft.movieTitle && (
            <button
              type="button"
              className={styles.linkButton}
              onClick={handleResetMovieTitle}
            >
              Reset to Movie Title
            </button>
          )}
        </span>
      </div>

      <div className={styles.datetimeRow}>
        <div className={styles.field}>
          <label htmlFor={`${draft.event}-date`}>Event date</label>
          <input
            id={`${draft.event}-date`}
            type="date"
            value={state.eventDate}
            onChange={(event) => handleEventDateChange(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${draft.event}-time`}>Event time</label>
          <input
            id={`${draft.event}-time`}
            type="time"
            value={state.eventTime}
            onChange={(event) => handleEventTimeChange(event.target.value)}
          />
        </div>
      </div>

      <div className={styles.field}>
        <label htmlFor={`${draft.event}-custom`}>Message</label>
        <textarea
          id={`${draft.event}-custom`}
          value={state.customText}
          onChange={(event) => handleCustomTextChange(event.target.value)}
          placeholder="Write your announcement intro here…"
        />
        <span className={styles.hint}>
          First line in Discord — role mention is added inline when enabled
        </span>
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Role mention</span>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={state.mentionRole}
            onChange={(event) => handleMentionRoleChange(event.target.checked)}
            disabled={!draft.roleConfigured}
          />
          <span>Ping {draft.eventLabel} role</span>
        </label>
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Poster attachment</span>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={state.includePoster}
            onChange={(event) => handleIncludePosterChange(event.target.checked)}
            disabled={!draft.posterExists}
          />
          <span>Attach poster image to Discord message</span>
        </label>
      </div>

      {state.includePoster && draft.posterExists && (
        <div className={styles.posterPreview}>
          <img
            src={`${draft.posterUrl}?v=${posterCacheKey}`}
            alt={`${draft.eventLabel} poster`}
          />
        </div>
      )}

      <div className={styles.preview}>
        <h3>Preview</h3>
        <div className={styles.previewText}>{previewText}</div>
        <span className={styles.hint}>
          Event time as Discord will render it ({draft.timezone.replace("_", " ")}).
        </span>
      </div>

      <div className={styles.scheduleCompose}>
        <h3>Schedule send</h3>
        <div className={styles.datetimeRow}>
          <div className={styles.field}>
            <label htmlFor={`${draft.event}-send-date`}>Send date</label>
            <input
              id={`${draft.event}-send-date`}
              type="date"
              value={state.sendDate}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  sendDate: event.target.value,
                }))
              }
            />
          </div>
          <div className={styles.field}>
            <label htmlFor={`${draft.event}-send-time`}>Send time</label>
            <input
              id={`${draft.event}-send-time`}
              type="time"
              value={state.sendTime}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  sendTime: event.target.value,
                }))
              }
            />
          </div>
        </div>
        <span className={styles.hint}>
          Defaults to the same movie night date/time (Main Saturdays 5:00 PM, HSPC
          Tuesdays 6:00 PM). Times use {draft.timezone.replace("_", " ")}.
        </span>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => void handleSchedule()}
          disabled={!canSchedule}
        >
          {scheduling ? "Scheduling…" : "Schedule"}
        </button>
        <button
          type="button"
          className={styles.postButton}
          onClick={() => void handlePost()}
          disabled={!canPost}
        >
          {posting ? "Posting…" : cooldown ? "Posted" : "Post now"}
        </button>
      </div>
    </section>
  );
}

type CombinedSchedulesProps = {
  schedules: ScheduledAnnouncement[];
  loading: boolean;
  timezone: string;
  drafts: Record<Event, AnnouncementDraft>;
  onToast: (message: string, type: "success" | "error") => void;
  onReload: () => Promise<void>;
};

export function CombinedSchedules({
  schedules,
  loading,
  timezone,
  drafts,
  onToast,
  onReload,
}: CombinedSchedulesProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [posterBump, setPosterBump] = useState(String(Date.now()));
  const [uploadingPoster, setUploadingPoster] = useState(false);
  const [pastOpen, setPastOpen] = useState(false);

  const activeSchedules = useMemo(
    () =>
      schedules
        .filter((item) => item.status === "scheduled" || item.status === "failed")
        .sort((a, b) => a.sendAt.localeCompare(b.sendAt)),
    [schedules],
  );

  const pastSchedules = useMemo(
    () =>
      schedules
        .filter((item) => item.status === "sent" || item.status === "cancelled")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 25),
    [schedules],
  );

  const startEdit = (item: ScheduledAnnouncement) => {
    const send = sendPartsInTimezone(item.sendAt, timezone);
    setEditingId(item.id);
    setEditDraft({
      movieTitle: item.movieTitle,
      eventDate: item.eventDate,
      eventTime: item.eventTime,
      customText: item.customText,
      sendDate: send.sendDate,
      sendTime: send.sendTime,
      mentionRole: item.mentionRole,
      includePoster: item.includePoster,
    });
    setPosterBump(String(Date.now()));
  };

  const handleSaveEdit = async (item: ScheduledAnnouncement) => {
    if (!editDraft) return;
    setBusyId(item.id);
    try {
      const response = await fetch(
        `/api/announcements/${item.event}/schedules/${item.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editDraft),
        },
      );
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to update schedule");
      }
      onToast(data.message ?? "Schedule updated", "success");
      setEditingId(null);
      setEditDraft(null);
      await onReload();
    } catch (error) {
      onToast(
        error instanceof Error ? error.message : "Failed to update schedule",
        "error",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleCancelSchedule = async (item: ScheduledAnnouncement) => {
    const confirmed = window.confirm(
      `Cancel this ${EVENT_LABELS[item.event]} scheduled announcement?`,
    );
    if (!confirmed) return;
    setBusyId(item.id);
    try {
      const response = await fetch(
        `/api/announcements/${item.event}/schedules/${item.id}`,
        { method: "DELETE" },
      );
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to cancel schedule");
      }
      onToast(data.message ?? "Schedule cancelled", "success");
      if (editingId === item.id) {
        setEditingId(null);
        setEditDraft(null);
      }
      await onReload();
    } catch (error) {
      onToast(
        error instanceof Error ? error.message : "Failed to cancel schedule",
        "error",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleSendNow = async (item: ScheduledAnnouncement) => {
    const confirmed = window.confirm(
      `Send this ${EVENT_LABELS[item.event]} announcement to Discord now?`,
    );
    if (!confirmed) return;
    setBusyId(item.id);
    try {
      const response = await fetch(
        `/api/announcements/${item.event}/schedules/${item.id}/send-now`,
        { method: "POST" },
      );
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to send announcement");
      }
      onToast(data.message ?? "Announcement posted to Discord", "success");
      if (editingId === item.id) {
        setEditingId(null);
        setEditDraft(null);
      }
      await onReload();
    } catch (error) {
      onToast(
        error instanceof Error ? error.message : "Failed to send announcement",
        "error",
      );
      await onReload().catch(() => {});
    } finally {
      setBusyId(null);
    }
  };

  const handleOverridePoster = async (
    item: ScheduledAnnouncement,
    file: File | undefined,
  ) => {
    if (!file) return;
    setUploadingPoster(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(
        `/api/announcements/${item.event}/schedules/${item.id}/poster`,
        { method: "POST", body: formData },
      );
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to upload poster override");
      }
      onToast(data.message ?? "Poster override saved", "success");
      setEditDraft((current) =>
        current ? { ...current, includePoster: true } : current,
      );
      setPosterBump(String(Date.now()));
      await onReload();
    } catch (error) {
      onToast(
        error instanceof Error ? error.message : "Failed to upload poster override",
        "error",
      );
    } finally {
      setUploadingPoster(false);
    }
  };

  const handleClearOverride = async (item: ScheduledAnnouncement) => {
    setUploadingPoster(true);
    try {
      const response = await fetch(
        `/api/announcements/${item.event}/schedules/${item.id}/poster`,
        { method: "DELETE" },
      );
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to clear poster override");
      }
      onToast(data.message ?? "Poster override cleared", "success");
      setPosterBump(String(Date.now()));
      await onReload();
    } catch (error) {
      onToast(
        error instanceof Error ? error.message : "Failed to clear poster override",
        "error",
      );
    } finally {
      setUploadingPoster(false);
    }
  };

  return (
    <section className={styles.combinedSchedules}>
      <div className={styles.combinedHeader}>
        <h2>Scheduled announcements</h2>
        <p>Upcoming Discord posts for Main and HSPC, ordered by send time.</p>
      </div>

      {loading ? (
        <p className={styles.hint}>Loading schedules…</p>
      ) : activeSchedules.length === 0 ? (
        <p className={styles.hint}>No upcoming scheduled posts.</p>
      ) : (
        <ul className={styles.scheduleList}>
          {activeSchedules.map((item) => {
            const isEditing = editingId === item.id && editDraft;
            const draft = drafts[item.event];
            const posterSrc = item.hasPosterOverride
              ? `/api/announcements/${item.event}/schedules/${item.id}/poster?v=${posterBump}`
              : `${draft.posterUrl}?v=${posterBump}`;
            const canShowPoster =
              Boolean(editDraft?.includePoster) &&
              (item.hasPosterOverride || draft.posterExists);
            const editPreview =
              editDraft
                ? buildPreviewText({
                    mentionRole: editDraft.mentionRole,
                    roleConfigured: draft.roleConfigured,
                    eventLabel: draft.eventLabel,
                    movieTitle: editDraft.movieTitle,
                    eventDate: editDraft.eventDate,
                    eventTime: editDraft.eventTime,
                    customText: editDraft.customText,
                    timezone,
                  })
                : "";

            return (
              <li
                key={item.id}
                className={`${styles.scheduleItem} ${
                  item.event === "main" ? styles.scheduleMain : styles.scheduleHspc
                }`}
              >
                {isEditing && editDraft ? (
                  <div className={styles.editForm}>
                    <div className={styles.scheduleMeta}>
                      <span
                        className={`${styles.eventBadge} ${
                          item.event === "main" ? styles.badgeMain : styles.badgeHspc
                        }`}
                      >
                        {EVENT_LABELS[item.event]}
                      </span>
                    </div>

                    <div className={styles.field}>
                      <label>Movie</label>
                      <input
                        type="text"
                        value={editDraft.movieTitle}
                        onChange={(event) =>
                          setEditDraft({
                            ...editDraft,
                            movieTitle: event.target.value,
                          })
                        }
                      />
                    </div>

                    <div className={styles.datetimeRow}>
                      <div className={styles.field}>
                        <label>Event date</label>
                        <input
                          type="date"
                          value={editDraft.eventDate}
                          onChange={(event) =>
                            setEditDraft({
                              ...editDraft,
                              eventDate: event.target.value,
                            })
                          }
                        />
                      </div>
                      <div className={styles.field}>
                        <label>Event time</label>
                        <input
                          type="time"
                          value={editDraft.eventTime}
                          onChange={(event) =>
                            setEditDraft({
                              ...editDraft,
                              eventTime: event.target.value,
                            })
                          }
                        />
                      </div>
                    </div>

                    <div className={styles.field}>
                      <label>Message</label>
                      <textarea
                        value={editDraft.customText}
                        onChange={(event) =>
                          setEditDraft({
                            ...editDraft,
                            customText: event.target.value,
                          })
                        }
                      />
                      <span className={styles.hint}>
                        First line in Discord — role mention is added inline when enabled
                      </span>
                    </div>

                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Role mention</span>
                      <label className={styles.checkboxRow}>
                        <input
                          type="checkbox"
                          checked={editDraft.mentionRole}
                          onChange={(event) =>
                            setEditDraft({
                              ...editDraft,
                              mentionRole: event.target.checked,
                            })
                          }
                          disabled={!draft.roleConfigured}
                        />
                        <span>Ping {EVENT_LABELS[item.event]} role</span>
                      </label>
                    </div>

                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Poster attachment</span>
                      <label className={styles.checkboxRow}>
                        <input
                          type="checkbox"
                          checked={editDraft.includePoster}
                          onChange={(event) =>
                            setEditDraft({
                              ...editDraft,
                              includePoster: event.target.checked,
                            })
                          }
                          disabled={!item.hasPosterOverride && !draft.posterExists}
                        />
                        <span>Attach poster image to Discord message</span>
                      </label>
                      <span className={styles.hint}>
                        {item.hasPosterOverride
                          ? "Using a custom poster override for this schedule."
                          : "Uses the current event poster unless you upload an override."}
                      </span>
                    </div>

                    {canShowPoster && (
                      <div className={styles.posterPreview}>
                        <img
                          src={posterSrc}
                          alt={`${EVENT_LABELS[item.event]} poster`}
                        />
                      </div>
                    )}

                    <div className={styles.posterOverrideActions}>
                      <label className={styles.uploadOverrideLabel}>
                        <span>
                          {uploadingPoster
                            ? "Uploading…"
                            : item.hasPosterOverride
                              ? "Replace override poster"
                              : "Upload override poster"}
                        </span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                          disabled={uploadingPoster || busyId === item.id}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            void handleOverridePoster(item, file);
                            event.target.value = "";
                          }}
                        />
                      </label>
                      {item.hasPosterOverride && (
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => void handleClearOverride(item)}
                          disabled={uploadingPoster || busyId === item.id}
                        >
                          Use event poster
                        </button>
                      )}
                    </div>

                    <div className={styles.datetimeRow}>
                      <div className={styles.field}>
                        <label>Send date</label>
                        <input
                          type="date"
                          value={editDraft.sendDate}
                          onChange={(event) =>
                            setEditDraft({
                              ...editDraft,
                              sendDate: event.target.value,
                            })
                          }
                        />
                      </div>
                      <div className={styles.field}>
                        <label>Send time</label>
                        <input
                          type="time"
                          value={editDraft.sendTime}
                          onChange={(event) =>
                            setEditDraft({
                              ...editDraft,
                              sendTime: event.target.value,
                            })
                          }
                        />
                      </div>
                    </div>

                    <div className={styles.preview}>
                      <h3>Preview</h3>
                      <div className={styles.previewText}>{editPreview}</div>
                      <span className={styles.hint}>
                        Event time as Discord will render it ({timezone.replace("_", " ")}).
                      </span>
                    </div>

                    <div className={styles.scheduleActions}>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => {
                          setEditingId(null);
                          setEditDraft(null);
                        }}
                        disabled={busyId === item.id}
                      >
                        Discard
                      </button>
                      <button
                        type="button"
                        className={styles.postButton}
                        onClick={() => void handleSaveEdit(item)}
                        disabled={busyId === item.id}
                      >
                        {busyId === item.id ? "Saving…" : "Save changes"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className={styles.scheduleMeta}>
                      <div className={styles.scheduleTitleRow}>
                        <span
                          className={`${styles.eventBadge} ${
                            item.event === "main" ? styles.badgeMain : styles.badgeHspc
                          }`}
                        >
                          {EVENT_LABELS[item.event]}
                        </span>
                        <strong>{item.movieTitle}</strong>
                      </div>
                      <span
                        className={`${styles.scheduleStatus} ${
                          item.status === "failed"
                            ? styles.scheduleFailed
                            : styles.schedulePending
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <p className={styles.hint}>
                      Event {item.eventDate} {item.eventTime} · Send{" "}
                      {formatDiscordTimestampLongPreview(item.sendAt, timezone)}
                      {item.mentionRole ? " · role ping" : ""}
                      {item.includePoster
                        ? item.hasPosterOverride
                          ? " · custom poster"
                          : " · poster"
                        : " · no poster"}
                    </p>
                    {item.lastError && (
                      <p className={styles.errorText}>{item.lastError}</p>
                    )}
                    <div className={styles.scheduleActions}>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => startEdit(item)}
                        disabled={busyId !== null}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => void handleSendNow(item)}
                        disabled={busyId !== null}
                      >
                        {busyId === item.id ? "Sending…" : "Send now"}
                      </button>
                      <button
                        type="button"
                        className={styles.dangerButton}
                        onClick={() => void handleCancelSchedule(item)}
                        disabled={busyId !== null}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className={styles.pastSection}>
        <button
          type="button"
          className={styles.pastToggle}
          aria-expanded={pastOpen}
          onClick={() => setPastOpen((open) => !open)}
        >
          <span>
            Past announcements
            {pastSchedules.length > 0 ? ` (${pastSchedules.length})` : ""}
          </span>
          <span className={styles.pastChevron} aria-hidden>
            {pastOpen ? "▾" : "▸"}
          </span>
        </button>

        {pastOpen && (
          <div className={styles.pastBody}>
            {pastSchedules.length === 0 ? (
              <p className={styles.hint}>No sent or cancelled announcements yet.</p>
            ) : (
              <ul className={styles.scheduleList}>
                {pastSchedules.map((item) => (
                  <li key={item.id} className={styles.scheduleItemMuted}>
                    <div className={styles.scheduleMeta}>
                      <div className={styles.scheduleTitleRow}>
                        <span
                          className={`${styles.eventBadge} ${
                            item.event === "main" ? styles.badgeMain : styles.badgeHspc
                          }`}
                        >
                          {EVENT_LABELS[item.event]}
                        </span>
                        <span>{item.movieTitle}</span>
                      </div>
                      <span
                        className={`${styles.scheduleStatus} ${
                          item.status === "sent"
                            ? styles.scheduleSent
                            : styles.scheduleCancelled
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <p className={styles.hint}>
                      Event {item.eventDate} {item.eventTime} ·{" "}
                      {item.status === "sent" ? "Sent" : "Cancelled"}{" "}
                      {formatDiscordTimestampLongPreview(
                        item.sentAt ?? item.updatedAt,
                        timezone,
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export function AnnouncementsPage() {
  const [drafts, setDrafts] = useState<Record<Event, AnnouncementDraft | null>>({
    main: null,
    hspc: null,
  });
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastState>(null);
  const [posterCacheKey, setPosterCacheKey] = useState(String(Date.now()));
  const [schedules, setSchedules] = useState<ScheduledAnnouncement[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(true);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const loadSchedules = useCallback(async () => {
    const results = await Promise.all(
      EVENTS.map(async (event) => {
        const response = await fetch(`/api/announcements/${event}/schedules`);
        if (!response.ok) {
          throw new Error(`Failed to load ${event} schedules`);
        }
        const data = (await response.json()) as {
          schedules?: ScheduledAnnouncement[];
        };
        return data.schedules ?? [];
      }),
    );
    setSchedules(results.flat());
  }, []);

  const loadDrafts = useCallback(async () => {
    const results = await Promise.all(
      EVENTS.map(async (event) => {
        const response = await fetch(`/api/announcements/${event}/draft`);
        if (!response.ok) {
          throw new Error(`Failed to load ${event} draft`);
        }
        const data = (await response.json()) as AnnouncementDraft;
        return [event, data] as const;
      }),
    );

    setDrafts(Object.fromEntries(results) as Record<Event, AnnouncementDraft>);
    setPosterCacheKey(String(Date.now()));
  }, []);

  useEffect(() => {
    loadDrafts()
      .catch(() => showToast("Failed to load announcement drafts", "error"))
      .finally(() => setLoading(false));
  }, [loadDrafts, showToast]);

  useEffect(() => {
    loadSchedules()
      .catch(() => showToast("Failed to load scheduled announcements", "error"))
      .finally(() => setSchedulesLoading(false));
  }, [loadSchedules, showToast]);

  if (loading) {
    return (
      <main className={styles.page}>
        <p className={styles.loading}>Loading…</p>
      </main>
    );
  }

  if (!drafts.main || !drafts.hspc) {
    return (
      <main className={styles.page}>
        <p className={styles.loading}>Unable to load announcement drafts.</p>
      </main>
    );
  }

  const timezone = drafts.main.timezone;

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <h1>Announcements</h1>
        <p>
          Compose, schedule, or post movie night announcements to Discord. Main
          autofills to Saturdays at 5:00 PM and HSPC to Tuesdays at 6:00 PM
          (America/Denver), unless you change times in Settings.
        </p>
      </header>

      <div className={styles.grid}>
        {EVENTS.map((event) => {
          const draft = drafts[event];
          if (!draft) return null;

          return (
            <EventAnnouncementPanel
              key={event}
              draft={draft}
              posterCacheKey={posterCacheKey}
              onToast={showToast}
              onSchedulesChanged={() => {
                void loadSchedules().catch(() =>
                  showToast("Failed to refresh schedules", "error"),
                );
              }}
            />
          );
        })}
      </div>

      <CombinedSchedules
        schedules={schedules}
        loading={schedulesLoading}
        timezone={timezone}
        drafts={{ main: drafts.main, hspc: drafts.hspc }}
        onToast={showToast}
        onReload={loadSchedules}
      />

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
