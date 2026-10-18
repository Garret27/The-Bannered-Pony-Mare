export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "Not set";
  return new Date(iso).toLocaleString();
}

export function formatRelativeLastSeen(iso: string | null | undefined): string {
  if (!iso) return "Never seen";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "Unknown";

  const diffSec = Math.round((Date.now() - then) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (Math.abs(diffSec) < 60) return "Just now";
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(-diffMin, "minute");
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 48) return rtf.format(-diffHr, "hour");
  const diffDay = Math.round(diffHr / 24);
  if (Math.abs(diffDay) < 60) return rtf.format(-diffDay, "day");
  const diffMonth = Math.round(diffDay / 30);
  if (Math.abs(diffMonth) < 24) return rtf.format(-diffMonth, "month");
  const diffYear = Math.round(diffDay / 365);
  return rtf.format(-diffYear, "year");
}

export type FileInfo = {
  exists: boolean;
  filename: string;
  size: number | null;
  modifiedAt: string | null;
  cueCount?: number | null;
};
