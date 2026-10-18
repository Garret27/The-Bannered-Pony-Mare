import fs from "fs/promises";
import { randomUUID } from "crypto";
import { atomicWrite } from "./atomic-write";
import {
  getAnnounceTimezone,
  postAnnouncement,
  type SendAnnouncementInput,
} from "./discord-announcements";
import {
  formatDateInTimezone,
  formatTimeInTimezone,
  parseEventDateTime,
} from "./event-datetime";
import { processPoster } from "./image";
import {
  getAnnouncementSchedulesPath,
  getSchedulePosterPath,
  getSchedulePosterDir,
  isEvent,
  type Event,
} from "./paths";

export type ScheduledAnnouncementStatus = "scheduled" | "sent" | "cancelled" | "failed";

export type ScheduledAnnouncement = {
  id: string;
  event: Event;
  status: ScheduledAnnouncementStatus;
  sendAt: string;
  movieTitle: string;
  eventDate: string;
  eventTime: string;
  customText: string;
  mentionRole: boolean;
  includePoster: boolean;
  /** When true, Discord uses announcement-schedule-posters/{id}.jpg instead of event poster. */
  hasPosterOverride: boolean;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  lastError: string | null;
};

type ScheduleStore = {
  version: 1;
  items: ScheduledAnnouncement[];
};

export type CreateScheduleInput = SendAnnouncementInput & {
  sendDate: string;
  sendTime: string;
};

export type UpdateScheduleInput = Partial<CreateScheduleInput>;

const EMPTY_STORE: ScheduleStore = { version: 1, items: [] };

let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readStore(): Promise<ScheduleStore> {
  try {
    const raw = await fs.readFile(getAnnouncementSchedulesPath(), "utf-8");
    const parsed = JSON.parse(raw) as ScheduleStore;
    if (!parsed || !Array.isArray(parsed.items)) {
      return { ...EMPTY_STORE };
    }
    return {
      version: 1,
      items: parsed.items
        .filter((item) => isEvent(item.event))
        .map((item) => ({
          ...item,
          hasPosterOverride: Boolean(item.hasPosterOverride),
        })),
    };
  } catch {
    return { ...EMPTY_STORE };
  }
}

async function writeStore(store: ScheduleStore): Promise<void> {
  await atomicWrite(
    getAnnouncementSchedulesPath(),
    `${JSON.stringify(store, null, 2)}\n`,
  );
}

function toSendInput(item: ScheduledAnnouncement): SendAnnouncementInput {
  return {
    movieTitle: item.movieTitle,
    eventDate: item.eventDate,
    eventTime: item.eventTime,
    customText: item.customText,
    mentionRole: item.mentionRole,
    includePoster: item.includePoster,
  };
}

async function readOverridePosterBuffer(id: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(getSchedulePosterPath(id));
  } catch {
    return null;
  }
}

export async function schedulePosterOverrideExists(id: string): Promise<boolean> {
  try {
    await fs.access(getSchedulePosterPath(id));
    return true;
  } catch {
    return false;
  }
}

export async function saveSchedulePosterOverride(
  event: Event,
  id: string,
  buffer: Buffer,
): Promise<ScheduledAnnouncement> {
  return enqueueWrite(async () => {
    const store = await readStore();
    const index = store.items.findIndex(
      (item) => item.event === event && item.id === id,
    );
    if (index < 0) {
      throw new Error("Scheduled announcement not found.");
    }

    const current = store.items[index];
    if (current.status !== "scheduled" && current.status !== "failed") {
      throw new Error("Only scheduled or failed announcements can change posters.");
    }

    await fs.mkdir(getSchedulePosterDir(), { recursive: true });
    await processPoster(buffer, getSchedulePosterPath(id));

    const next: ScheduledAnnouncement = {
      ...current,
      hasPosterOverride: true,
      includePoster: true,
      updatedAt: new Date().toISOString(),
      status: "scheduled",
      lastError: null,
    };
    store.items[index] = next;
    await writeStore(store);
    return next;
  });
}

export async function clearSchedulePosterOverride(
  event: Event,
  id: string,
): Promise<ScheduledAnnouncement> {
  return enqueueWrite(async () => {
    const store = await readStore();
    const index = store.items.findIndex(
      (item) => item.event === event && item.id === id,
    );
    if (index < 0) {
      throw new Error("Scheduled announcement not found.");
    }

    const current = store.items[index];
    await fs.rm(getSchedulePosterPath(id), { force: true });

    const next: ScheduledAnnouncement = {
      ...current,
      hasPosterOverride: false,
      updatedAt: new Date().toISOString(),
    };
    store.items[index] = next;
    await writeStore(store);
    return next;
  });
}

async function deleteSchedulePosterFile(id: string): Promise<void> {
  await fs.rm(getSchedulePosterPath(id), { force: true });
}

function resolveSendAt(
  sendDate: string,
  sendTime: string,
  timezone: string,
): Date | null {
  return parseEventDateTime(sendDate, sendTime, timezone);
}

export async function listScheduledAnnouncements(
  event: Event,
): Promise<ScheduledAnnouncement[]> {
  const store = await readStore();
  return store.items
    .filter((item) => item.event === event)
    .sort((a, b) => a.sendAt.localeCompare(b.sendAt));
}

export async function getScheduledAnnouncement(
  event: Event,
  id: string,
): Promise<ScheduledAnnouncement | null> {
  const store = await readStore();
  return store.items.find((item) => item.event === event && item.id === id) ?? null;
}

export async function createScheduledAnnouncement(
  event: Event,
  input: CreateScheduleInput,
): Promise<ScheduledAnnouncement> {
  return enqueueWrite(async () => {
    const timezone = getAnnounceTimezone();
    const sendAt = resolveSendAt(input.sendDate, input.sendTime, timezone);
    if (!sendAt) {
      throw new Error("Invalid send date/time.");
    }
    if (!parseEventDateTime(input.eventDate, input.eventTime, timezone)) {
      throw new Error("Invalid event date/time.");
    }
    if (!input.movieTitle.trim()) {
      throw new Error("Movie title is required.");
    }

    const now = new Date().toISOString();
    const item: ScheduledAnnouncement = {
      id: randomUUID(),
      event,
      status: "scheduled",
      sendAt: sendAt.toISOString(),
      movieTitle: input.movieTitle.trim(),
      eventDate: input.eventDate,
      eventTime: input.eventTime,
      customText: input.customText ?? "",
      mentionRole: input.mentionRole !== false,
      includePoster: input.includePoster !== false,
      hasPosterOverride: false,
      createdAt: now,
      updatedAt: now,
      sentAt: null,
      lastError: null,
    };

    const store = await readStore();
    store.items.push(item);
    await writeStore(store);
    return item;
  });
}

export async function updateScheduledAnnouncement(
  event: Event,
  id: string,
  input: UpdateScheduleInput,
): Promise<ScheduledAnnouncement> {
  return enqueueWrite(async () => {
    const store = await readStore();
    const index = store.items.findIndex(
      (item) => item.event === event && item.id === id,
    );
    if (index < 0) {
      throw new Error("Scheduled announcement not found.");
    }

    const current = store.items[index];
    if (current.status !== "scheduled" && current.status !== "failed") {
      throw new Error("Only scheduled or failed announcements can be updated.");
    }

    const timezone = getAnnounceTimezone();
    const next: ScheduledAnnouncement = {
      ...current,
      movieTitle: input.movieTitle?.trim() ?? current.movieTitle,
      eventDate: input.eventDate ?? current.eventDate,
      eventTime: input.eventTime ?? current.eventTime,
      customText: input.customText ?? current.customText,
      mentionRole:
        input.mentionRole !== undefined ? input.mentionRole !== false : current.mentionRole,
      includePoster:
        input.includePoster !== undefined
          ? input.includePoster !== false
          : current.includePoster,
      updatedAt: new Date().toISOString(),
      status: "scheduled",
      lastError: null,
    };

    if (input.sendDate && input.sendTime) {
      const sendAt = resolveSendAt(input.sendDate, input.sendTime, timezone);
      if (!sendAt) {
        throw new Error("Invalid send date/time.");
      }
      next.sendAt = sendAt.toISOString();
    } else if (input.sendDate || input.sendTime) {
      throw new Error("Both sendDate and sendTime are required to change send time.");
    }

    if (!parseEventDateTime(next.eventDate, next.eventTime, timezone)) {
      throw new Error("Invalid event date/time.");
    }
    if (!next.movieTitle.trim()) {
      throw new Error("Movie title is required.");
    }

    store.items[index] = next;
    await writeStore(store);
    return next;
  });
}

export async function cancelScheduledAnnouncement(
  event: Event,
  id: string,
): Promise<ScheduledAnnouncement> {
  return enqueueWrite(async () => {
    const store = await readStore();
    const index = store.items.findIndex(
      (item) => item.event === event && item.id === id,
    );
    if (index < 0) {
      throw new Error("Scheduled announcement not found.");
    }

    const current = store.items[index];
    if (current.status === "sent") {
      throw new Error("Already sent announcements cannot be cancelled.");
    }
    if (current.status === "cancelled") {
      return current;
    }

    const next: ScheduledAnnouncement = {
      ...current,
      status: "cancelled",
      updatedAt: new Date().toISOString(),
    };
    store.items[index] = next;
    await writeStore(store);
    await deleteSchedulePosterFile(current.id).catch(() => {});
    return next;
  });
}

export async function sendScheduledAnnouncementNow(
  event: Event,
  id: string,
): Promise<ScheduledAnnouncement> {
  return enqueueWrite(async () => {
    const store = await readStore();
    const index = store.items.findIndex(
      (item) => item.event === event && item.id === id,
    );
    if (index < 0) {
      throw new Error("Scheduled announcement not found.");
    }

    const current = store.items[index];
    if (current.status === "sent") {
      throw new Error("Announcement was already sent.");
    }
    if (current.status === "cancelled") {
      throw new Error("Cancelled announcements cannot be sent.");
    }

    const override =
      current.includePoster && current.hasPosterOverride
        ? await readOverridePosterBuffer(current.id)
        : null;

    const result = await postAnnouncement(event, {
      ...toSendInput(current),
      posterBuffer: override,
    });
    const now = new Date().toISOString();

    if (!result.ok) {
      const failed: ScheduledAnnouncement = {
        ...current,
        status: "failed",
        updatedAt: now,
        lastError: result.error,
      };
      store.items[index] = failed;
      await writeStore(store);
      throw new Error(result.error);
    }

    const sent: ScheduledAnnouncement = {
      ...current,
      status: "sent",
      sentAt: now,
      updatedAt: now,
      lastError: null,
    };
    store.items[index] = sent;
    await writeStore(store);
    return sent;
  });
}

/** Process due scheduled posts. Safe to call from a timer. */
export async function processDueScheduledAnnouncements(
  now = new Date(),
): Promise<number> {
  const store = await readStore();
  const due = store.items.filter(
    (item) =>
      item.status === "scheduled" &&
      new Date(item.sendAt).getTime() <= now.getTime(),
  );

  let sentCount = 0;
  for (const item of due) {
    try {
      await sendScheduledAnnouncementNow(item.event, item.id);
      sentCount += 1;
    } catch (error) {
      console.error(
        `[announcement-scheduler] Failed to send ${item.id} (${item.event}):`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return sentCount;
}

export function scheduleViewParts(
  sendAtIso: string,
  timezone: string,
): { sendDate: string; sendTime: string } {
  return {
    sendDate: formatDateInTimezone(sendAtIso, timezone),
    sendTime: formatTimeInTimezone(sendAtIso, timezone),
  };
}

/** Default Discord send time: same as the movie night event date/time. */
export function defaultSendAtForEvent(
  eventDate: string,
  eventTime: string,
): { sendDate: string; sendTime: string } {
  return {
    sendDate: eventDate,
    sendTime: eventTime || "17:00",
  };
}
