import { processDueScheduledAnnouncements } from "./announcement-schedules";

const POLL_MS = 30_000;

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;

export function startAnnouncementScheduler(): void {
  if (started) return;
  started = true;

  const tick = () => {
    void processDueScheduledAnnouncements().catch((error) => {
      console.error("[announcement-scheduler] tick failed:", error);
    });
  };

  tick();
  timer = setInterval(tick, POLL_MS);
  if (typeof timer.unref === "function") {
    timer.unref();
  }

  console.log(
    `[announcement-scheduler] started (every ${POLL_MS / 1000}s)`,
  );
}

export function stopAnnouncementScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
}
