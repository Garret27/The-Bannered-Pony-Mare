"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatMsToTimestamp,
  parseSrt,
  parseTimestampToMs,
  serializeSrt,
  shiftAll,
  validateSrt,
  type SrtCue,
  type SrtValidationIssue,
} from "@/lib/srt";
import type { Event } from "@/lib/paths";
import { EVENT_LABELS } from "@/lib/paths";
import { Toast } from "./Toast";
import styles from "./SubtitleEditor.module.css";

type SubtitleEditorProps = {
  event: Event;
};

type ToastState = {
  message: string;
  type: "success" | "error";
} | null;

function cuesEqual(a: SrtCue[], b: SrtCue[]): boolean {
  return serializeSrt(a) === serializeSrt(b);
}

export function SubtitleEditor({ event }: SubtitleEditorProps) {
  const [cues, setCues] = useState<SrtCue[]>([]);
  const [savedCues, setSavedCues] = useState<SrtCue[]>([]);
  const [rawContent, setRawContent] = useState("");
  const [savedRawContent, setSavedRawContent] = useState("");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"cues" | "raw">("cues");
  const [shiftInput, setShiftInput] = useState("1");
  const [issues, setIssues] = useState<SrtValidationIssue[]>([]);
  const [toast, setToast] = useState<ToastState>(null);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const loadSubtitle = useCallback(async () => {
    const response = await fetch(`/api/subtitles/${event}`);
    if (!response.ok) {
      throw new Error("Failed to load subtitle");
    }
    const data = (await response.json()) as {
      content: string;
      cues: SrtCue[];
    };
    setCues(data.cues);
    setSavedCues(data.cues);
    setRawContent(data.content);
    setSavedRawContent(data.content);
    setSelectedIndex(data.cues.length > 0 ? 0 : null);
  }, [event]);

  useEffect(() => {
    loadSubtitle()
      .catch(() => showToast("Failed to load subtitle file", "error"))
      .finally(() => setLoading(false));
  }, [loadSubtitle, showToast]);

  const isDirty = useMemo(() => {
    if (mode === "raw") {
      return rawContent !== savedRawContent;
    }
    return !cuesEqual(cues, savedCues);
  }, [mode, rawContent, savedRawContent, cues, savedCues]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const selectedCue = selectedIndex !== null ? cues[selectedIndex] : null;

  const updateSelectedCue = (patch: Partial<SrtCue>) => {
    if (selectedIndex === null) return;
    setCues((prev) =>
      prev.map((cue, i) =>
        i === selectedIndex ? { ...cue, ...patch } : cue,
      ),
    );
  };

  const handleShiftAll = () => {
    const seconds = Number.parseFloat(shiftInput.trim());
    if (!Number.isFinite(seconds) || seconds === 0) {
      showToast("Enter a non-zero shift in seconds (e.g. -1.5 or 2)", "error");
      return;
    }

    const offsetMs = Math.round(seconds * 1000);
    setCues((prev) => shiftAll(prev, offsetMs));

    const label = `${seconds > 0 ? "+" : ""}${seconds}s`;
    showToast(`Shifted all cues by ${label}`, "success");
  };

  const handleAddCue = () => {
    const last = cues[cues.length - 1];
    const startMs = last ? last.endMs + 1000 : 0;
    const newCue: SrtCue = {
      index: cues.length + 1,
      startMs,
      endMs: startMs + 3000,
      text: "New subtitle",
    };
    setCues((prev) => [...prev, newCue]);
    setSelectedIndex(cues.length);
  };

  const handleDeleteCue = () => {
    if (selectedIndex === null) return;
    setCues((prev) => {
      const next = prev.filter((_, i) => i !== selectedIndex);
      return next.map((cue, i) => ({ ...cue, index: i + 1 }));
    });
    setSelectedIndex((prev) => {
      if (prev === null) return null;
      return Math.max(0, prev - 1);
    });
  };

  const handleDiscard = () => {
    if (mode === "raw") {
      setRawContent(savedRawContent);
    } else {
      setCues(savedCues);
    }
    setIssues([]);
  };

  const handleSave = async () => {
    setSaving(true);
    setIssues([]);

    try {
      const body =
        mode === "raw"
          ? { content: rawContent }
          : { cues };

      const response = await fetch(`/api/subtitles/${event}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await response.json()) as {
        error?: string;
        message?: string;
        issues?: SrtValidationIssue[];
        cueCount?: number;
      };

      if (!response.ok) {
        if (data.issues) setIssues(data.issues);
        throw new Error(data.error ?? "Save failed");
      }

      await loadSubtitle();
      if (data.issues && data.issues.length > 0) {
        setIssues(data.issues);
      }
      showToast(data.message ?? "Saved", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleModeSwitch = (nextMode: "cues" | "raw") => {
    if (isDirty) {
      const ok = window.confirm("You have unsaved changes. Switch mode anyway?");
      if (!ok) return;
    }
    if (nextMode === "raw") {
      setRawContent(serializeSrt(cues));
    } else {
      setCues(parseSrt(rawContent));
      setSelectedIndex(0);
    }
    setMode(nextMode);
    setIssues([]);
  };

  const validationIssues = useMemo(() => {
    const target = mode === "raw" ? parseSrt(rawContent) : cues;
    return validateSrt(target);
  }, [mode, rawContent, cues]);

  if (loading) {
    return (
      <main className={styles.page}>
        <p className={styles.loading}>Loading subtitle…</p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <Link href="/subtitles" className={styles.backLink}>
        ← Back to Subtitles
      </Link>

      <header className={styles.header}>
        <h1>Edit — {EVENT_LABELS[event]}</h1>
        <p>Adjust cue timing and text. Changes are saved to the canonical SRT file.</p>
      </header>

      <div className={styles.modeToggle}>
        <button
          type="button"
          className={mode === "cues" ? styles.modeActive : undefined}
          onClick={() => handleModeSwitch("cues")}
        >
          Cue list
        </button>
        <button
          type="button"
          className={mode === "raw" ? styles.modeActive : undefined}
          onClick={() => handleModeSwitch("raw")}
        >
          Raw SRT
        </button>
      </div>

      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.button}
          onClick={() => void handleSave()}
          disabled={saving || !isDirty}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonSecondary}`}
          onClick={handleDiscard}
          disabled={!isDirty}
        >
          Discard
        </button>
        {mode === "cues" && (
          <>
            <button type="button" className={styles.buttonSecondary} onClick={handleAddCue}>
              Add cue
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonDanger}`}
              onClick={handleDeleteCue}
              disabled={selectedIndex === null}
            >
              Delete
            </button>
            <div className={styles.shiftGroup}>
              <label htmlFor="shift-all-seconds">Shift all cues</label>
              <input
                id="shift-all-seconds"
                type="number"
                step="any"
                value={shiftInput}
                placeholder="e.g. -1.5"
                onChange={(e) => setShiftInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleShiftAll();
                  }
                }}
              />
              <span>sec</span>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonSecondary}`}
                onClick={handleShiftAll}
                disabled={cues.length === 0}
              >
                Apply
              </button>
            </div>
          </>
        )}
        {isDirty && <span className={styles.unsaved}>Unsaved changes</span>}
      </div>

      {issues.length > 0 && (
        <div className={styles.issues}>
          <strong>Save blocked:</strong>
          <ul>
            {issues.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      {validationIssues.length > 0 && issues.length === 0 && (
        <div className={`${styles.issues} ${styles.warnings}`}>
          <strong>Warnings:</strong>
          <ul>
            {validationIssues.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      {mode === "raw" ? (
        <div className={styles.rawMode}>
          <textarea
            value={rawContent}
            onChange={(e) => setRawContent(e.target.value)}
            spellCheck={false}
          />
        </div>
      ) : cues.length === 0 ? (
        <p className={styles.empty}>No cues. Add one to get started.</p>
      ) : (
        <div className={styles.layout}>
          <div className={styles.cueList}>
            <div className={styles.cueListHeader}>
              <span>#</span>
              <span>Start</span>
              <span>End</span>
              <span>Text</span>
            </div>
            <div className={styles.cueRows}>
              {cues.map((cue, i) => (
                <div
                  key={`${cue.index}-${i}`}
                  className={`${styles.cueRow} ${selectedIndex === i ? styles.cueRowSelected : ""}`}
                  onClick={() => setSelectedIndex(i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      setSelectedIndex(i);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <span className={styles.cueIndex}>{cue.index}</span>
                  <span className={styles.cueTime}>
                    {formatMsToTimestamp(cue.startMs)}
                  </span>
                  <span className={styles.cueTime}>
                    {formatMsToTimestamp(cue.endMs)}
                  </span>
                  <span className={styles.cueText}>{cue.text}</span>
                </div>
              ))}
            </div>
          </div>

          {selectedCue && (
            <aside className={styles.editorPanel}>
              <h3>Cue #{selectedCue.index}</h3>
              <div className={styles.timeRow}>
                <div>
                  <label htmlFor="start-time">Start</label>
                  <input
                    id="start-time"
                    value={formatMsToTimestamp(selectedCue.startMs)}
                    onChange={(e) => {
                      const ms = parseTimestampToMs(e.target.value);
                      if (ms !== null) updateSelectedCue({ startMs: ms });
                    }}
                  />
                </div>
                <div>
                  <label htmlFor="end-time">End</label>
                  <input
                    id="end-time"
                    value={formatMsToTimestamp(selectedCue.endMs)}
                    onChange={(e) => {
                      const ms = parseTimestampToMs(e.target.value);
                      if (ms !== null) updateSelectedCue({ endMs: ms });
                    }}
                  />
                </div>
              </div>
              <label htmlFor="cue-text">Text</label>
              <textarea
                id="cue-text"
                value={selectedCue.text}
                onChange={(e) => updateSelectedCue({ text: e.target.value })}
              />
            </aside>
          )}
        </div>
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
