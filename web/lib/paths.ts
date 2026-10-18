import path from "path";

export type Event = "main" | "hspc";

export const EVENTS: Event[] = ["main", "hspc"];

export function isEvent(value: string): value is Event {
  return value === "main" || value === "hspc";
}

export function getDataRoot(): string {
  if (process.env.DATA_ROOT) {
    return process.env.DATA_ROOT;
  }
  return path.join(process.cwd(), "..");
}

const POSTER_FILES: Record<Event, string> = {
  main: "CurrentMovieNightPoster.jpg",
  hspc: "HSPCPoster.jpg",
};

const SUBTITLE_FILES: Record<Event, string> = {
  main: "MovieNightSubtitles.srt",
  hspc: "MovieNightHSPCSubtitles.srt",
};

export function getPosterPath(event: Event): string {
  return path.join(getDataRoot(), POSTER_FILES[event]);
}

export function getSubtitlePath(event: Event): string {
  return path.join(getDataRoot(), SUBTITLE_FILES[event]);
}

export function getRedirectsPath(): string {
  return path.join(getDataRoot(), "_redirects");
}

export function getSettingsPath(): string {
  return path.join(getDataRoot(), "movie-night-settings.json");
}

export function getAnnouncementSchedulesPath(): string {
  return path.join(getDataRoot(), "movie-night-announcement-schedules.json");
}

export function getEventTitlesPath(): string {
  return path.join(getDataRoot(), "movie-night-event-titles.json");
}

export function getSchedulePosterDir(): string {
  return path.join(getDataRoot(), "announcement-schedule-posters");
}

export function getSchedulePosterPath(scheduleId: string): string {
  return path.join(getSchedulePosterDir(), `${scheduleId}.jpg`);
}

export function getPosterFilename(event: Event): string {
  return POSTER_FILES[event];
}

export function getSubtitleFilename(event: Event): string {
  return SUBTITLE_FILES[event];
}

export const EVENT_LABELS: Record<Event, string> = {
  main: "Main",
  hspc: "HSPC",
};
