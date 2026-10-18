"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { formatBytes } from "@/lib/format";
import type { MovieEntry } from "@/lib/movies-library";
import type { Event } from "@/lib/paths";
import { MoviePicker } from "./MoviePicker";
import { SubtitleApplyPanel } from "./SubtitleApplyPanel";
import styles from "./MovieLibrary.module.css";

export function MovieLibrary() {
  const searchParams = useSearchParams();
  const eventParam = searchParams.get("event");
  const event: Event =
    eventParam === "main" || eventParam === "hspc" ? eventParam : "main";

  const [selected, setSelected] = useState<MovieEntry | null>(null);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>Movie Library</h1>
        <p>
          Browse your Jellyfin library. Duplicate titles appear as separate rows
          — compare format and file size to pick the right copy.
        </p>
      </header>

      <section className={styles.panel}>
        <MoviePicker
          onSelect={setSelected}
          selectedId={selected?.id}
        />

        {selected && (
          <div className={styles.selected}>
            <h3>Selected</h3>
            <p className={styles.selectedTitle}>{selected.title}</p>
            <p className={styles.selectedMeta}>
              {selected.format.toUpperCase()} · {formatBytes(selected.sizeBytes)}
            </p>
            <div className={styles.actions}>
              <Link
                href={`/subtitles/${event}/preview?movie=${encodeURIComponent(selected.id)}`}
                className={styles.button}
              >
                Preview subtitles
              </Link>
              <Link
                href={`/subtitles/extract?movie=${encodeURIComponent(selected.id)}`}
                className={`${styles.button} ${styles.buttonSecondary}`}
              >
                Extract subtitles
              </Link>
            </div>
            <SubtitleApplyPanel movieId={selected.id} />
          </div>
        )}
      </section>
    </main>
  );
}
