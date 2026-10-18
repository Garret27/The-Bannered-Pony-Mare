"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { EVENT_LABELS, EVENTS, isEvent, type Event } from "@/lib/paths";
import styles from "./SubtitlesNav.module.css";

const STORAGE_KEY = "subtitle-event";

function readStoredEvent(): Event {
  if (typeof window === "undefined") return "main";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (isEvent(stored ?? "")) return stored as Event;
  return "main";
}

function writeStoredEvent(event: Event): void {
  window.localStorage.setItem(STORAGE_KEY, event);
}

function getEventFromPath(pathname: string): Event | null {
  const segment = pathname.split("/")[2];
  if (isEvent(segment ?? "")) return segment as Event;
  return null;
}

function getToolKind(
  pathname: string,
): "overview" | "library" | "edit" | "preview" | "extract" | "search" | null {
  if (pathname === "/subtitles") return "overview";
  if (pathname === "/subtitles/library") return "library";
  if (/\/subtitles\/[^/]+\/edit$/.test(pathname)) return "edit";
  if (/\/subtitles\/[^/]+\/preview$/.test(pathname)) return "preview";
  if (pathname === "/subtitles/extract") return "extract";
  if (pathname === "/subtitles/search") return "search";
  return null;
}

function hrefForTool(tool: string, event: Event): string {
  switch (tool) {
    case "overview":
      return `/subtitles?event=${event}`;
    case "library":
      return `/subtitles/library?event=${event}`;
    case "edit":
      return `/subtitles/${event}/edit`;
    case "preview":
      return `/subtitles/${event}/preview`;
    case "extract":
      return `/subtitles/extract?event=${event}`;
    case "search":
      return `/subtitles/search?event=${event}`;
    default:
      return `/subtitles?event=${event}`;
  }
}

const LINKS = [
  { id: "overview", label: "Overview" },
  { id: "library", label: "Library" },
  { id: "edit", label: "Editor" },
  { id: "preview", label: "Preview" },
  { id: "extract", label: "Extract" },
  { id: "search", label: "Search" },
] as const;

function isActive(pathname: string, id: string): boolean {
  return getToolKind(pathname) === id;
}

export function SubtitlesNav() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [event, setEvent] = useState<Event>("main");

  useEffect(() => {
    const fromPath = getEventFromPath(pathname);
    const fromQueryRaw = searchParams.get("event");
    const fromQuery = isEvent(fromQueryRaw ?? "")
      ? (fromQueryRaw as Event)
      : null;
    const next: Event = fromPath ?? fromQuery ?? readStoredEvent();

    setEvent(next);
    writeStoredEvent(next);

    const tool = getToolKind(pathname);
    if (
      tool &&
      !fromPath &&
      (tool === "overview" ||
        tool === "library" ||
        tool === "extract" ||
        tool === "search") &&
      fromQuery !== next
    ) {
      router.replace(hrefForTool(tool, next));
    }
  }, [pathname, searchParams, router]);

  const selectEvent = useCallback(
    (next: Event) => {
      if (next === event) return;
      writeStoredEvent(next);
      setEvent(next);

      const tool = getToolKind(pathname) ?? "overview";
      router.push(hrefForTool(tool, next));
    },
    [event, pathname, router],
  );

  return (
    <nav className={styles.subnav} aria-label="Subtitle tools">
      <div className={styles.inner}>
        <div className={styles.links}>
          {LINKS.map((link) => (
            <Link
              key={link.id}
              href={hrefForTool(link.id, event)}
              className={`${styles.link} ${isActive(pathname, link.id) ? styles.linkActive : ""}`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className={styles.eventSwitch} role="group" aria-label="Subtitle file">
          {EVENTS.map((option) => (
            <button
              key={option}
              type="button"
              className={`${styles.eventButton} ${option === "main" ? styles.eventMain : styles.eventHspc} ${event === option ? styles.eventActive : ""}`}
              aria-pressed={event === option}
              onClick={() => selectEvent(option)}
            >
              {EVENT_LABELS[option]}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}
