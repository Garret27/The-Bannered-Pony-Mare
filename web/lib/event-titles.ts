import fs from "fs/promises";
import type { Event } from "./paths";
import { EVENTS, getEventTitlesPath } from "./paths";

export type EventTitles = Record<Event, string>;

const EMPTY_TITLES: EventTitles = {
  main: "",
  hspc: "",
};

export async function readEventTitles(): Promise<EventTitles> {
  try {
    const raw = await fs.readFile(getEventTitlesPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Record<Event, unknown>>;
    return Object.fromEntries(
      EVENTS.map((event) => [
        event,
        typeof parsed[event] === "string" ? parsed[event].trim() : "",
      ]),
    ) as EventTitles;
  } catch {
    return { ...EMPTY_TITLES };
  }
}

export async function writeEventTitle(
  event: Event,
  movieTitle: string,
): Promise<EventTitles> {
  const titles = await readEventTitles();
  titles[event] = movieTitle.trim();

  const outputPath = getEventTitlesPath();
  const tempPath = `${outputPath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(titles, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, outputPath);
  return titles;
}
