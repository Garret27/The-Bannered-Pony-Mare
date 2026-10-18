export type SrtCue = {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
};

export type SrtValidationIssue = {
  cueIndex: number | null;
  message: string;
  severity: "error" | "warning";
};

const SINGLE_TIMESTAMP_RE = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/;
const TIMESTAMP_RE =
  /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/;

function parseSingleTimestampToMs(timestamp: string): number | null {
  const match = timestamp.trim().match(SINGLE_TIMESTAMP_RE);
  if (!match) return null;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const millis = parseInt(match[4], 10);

  if (minutes >= 60 || seconds >= 60) return null;

  return ((hours * 3600 + minutes * 60 + seconds) * 1000) + millis;
}

export function parseTimestampToMs(timestamp: string): number | null {
  const rangeMatch = timestamp.trim().match(TIMESTAMP_RE);
  if (rangeMatch) {
    return parseSingleTimestampToMs(
      `${rangeMatch[1]}:${rangeMatch[2]}:${rangeMatch[3]},${rangeMatch[4]}`,
    );
  }

  return parseSingleTimestampToMs(timestamp);
}

export function formatMsToTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  const millis = clamped % 1000;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function parseSrt(content: string): SrtCue[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return [];

  const blocks = normalized.split(/\n\n+/);
  const cues: SrtCue[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trimEnd());
    if (lines.length < 2) continue;

    let lineIndex = 0;
    let index = cues.length + 1;

    if (/^\d+$/.test(lines[0].trim())) {
      index = parseInt(lines[0].trim(), 10);
      lineIndex = 1;
    }

    const timestampLine = lines[lineIndex]?.trim();
    if (!timestampLine) continue;

    const match = timestampLine.match(TIMESTAMP_RE);
    if (!match) continue;

    const startMs = parseTimestampToMs(
      `${match[1]}:${match[2]}:${match[3]},${match[4]}`,
    );
    const endMs = parseTimestampToMs(
      `${match[5]}:${match[6]}:${match[7]},${match[8]}`,
    );

    if (startMs === null || endMs === null) continue;

    const text = lines.slice(lineIndex + 1).join("\n").trim();
    cues.push({ index, startMs, endMs, text });
  }

  return cues;
}

export function serializeSrt(cues: SrtCue[]): string {
  if (cues.length === 0) return "";

  return cues
    .map((cue, i) => {
      const index = cue.index > 0 ? cue.index : i + 1;
      const start = formatMsToTimestamp(cue.startMs);
      const end = formatMsToTimestamp(cue.endMs);
      return `${index}\n${start} --> ${end}\n${cue.text}`;
    })
    .join("\n\n")
    .concat("\n");
}

export function countCues(content: string): number {
  return parseSrt(content).length;
}

export function shiftAll(cues: SrtCue[], offsetMs: number): SrtCue[] {
  return cues.map((cue) => ({
    ...cue,
    startMs: Math.max(0, cue.startMs + offsetMs),
    endMs: Math.max(0, cue.endMs + offsetMs),
  }));
}

export function validateSrt(cues: SrtCue[]): SrtValidationIssue[] {
  const issues: SrtValidationIssue[] = [];

  if (cues.length === 0) {
    issues.push({
      cueIndex: null,
      message: "No subtitle cues found",
      severity: "warning",
    });
    return issues;
  }

  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs);

  for (let i = 0; i < sorted.length; i++) {
    const cue = sorted[i];

    if (!cue.text.trim()) {
      issues.push({
        cueIndex: cue.index,
        message: `Cue #${cue.index} has empty text`,
        severity: "warning",
      });
    }

    if (cue.endMs <= cue.startMs) {
      issues.push({
        cueIndex: cue.index,
        message: `Cue #${cue.index} has end time before or equal to start time`,
        severity: "error",
      });
    }

    if (i > 0) {
      const prev = sorted[i - 1];
      if (cue.startMs < prev.endMs) {
        issues.push({
          cueIndex: cue.index,
          message: `Cue #${cue.index} overlaps with cue #${prev.index}`,
          severity: "warning",
        });
      }
    }
  }

  return issues;
}

export function findActiveCueIndex(cues: SrtCue[], timeMs: number): number {
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (timeMs >= cue.startMs && timeMs <= cue.endMs) {
      return i;
    }
  }
  return -1;
}
