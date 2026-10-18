"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BunnyUploadJob } from "@/lib/bunny-upload-jobs";
import type { ConversionJob } from "@/lib/converter-agent";
import type { JellyfinOutputFile } from "@/lib/jellyfin-output";
import { formatBytes, formatDate } from "@/lib/format";
import { BunnyUploadProgress } from "./BunnyUploadProgress";
import styles from "./Cdn.module.css";

type BunnyUploadPanelProps = {
  bunnyConfigured: boolean;
  jellyfinOutputAvailable: boolean;
  bunnyFilenames: Set<string>;
  onUploadComplete: () => void;
};

type Tab = "jellyfin" | "drop";
type JellyfinSort = "newest" | "alpha";

function isJellyfinOutputJob(job: ConversionJob): boolean {
  return (
    job.mode === "jellyfin" ||
    job.preset === "vrchat-stream" ||
    job.preset === "jellyfin-library"
  );
}

function jellyfinRelativePathForJob(job: ConversionJob): string {
  if (job.outputPath) {
    const normalized = job.outputPath.replace(/\\/g, "/");
    const marker = "/jellyfin/";
    const idx = normalized.toLowerCase().indexOf(marker);
    if (idx >= 0) {
      return normalized.slice(idx + marker.length);
    }
  }
  const stem = job.videoFile.replace(/\.[^.]+$/, "");
  return `${job.title}/${stem}.mp4`;
}

function matchJellyfinFile(
  job: ConversionJob,
  files: JellyfinOutputFile[],
): JellyfinOutputFile | null {
  const rel = jellyfinRelativePathForJob(job).replace(/\\/g, "/");
  const byPath = files.find(
    (file) => file.relativePath.replace(/\\/g, "/") === rel,
  );
  if (byPath) return byPath;

  const filename = rel.split("/").pop() ?? "";
  return (
    files.find(
      (file) => file.title === job.title && file.filename === filename,
    ) ?? null
  );
}

type JellyfinFileRowProps = {
  file: JellyfinOutputFile;
  selected: boolean;
  onCdn: boolean;
  convertedAt?: string | null;
  disabled: boolean;
  onSelect: () => void;
};

function JellyfinFileRow({
  file,
  selected,
  onCdn,
  convertedAt,
  disabled,
  onSelect,
}: JellyfinFileRowProps) {
  return (
    <button
      type="button"
      className={`${styles.jellyfinRow} ${selected ? styles.jellyfinRowSelected : ""}`}
      onClick={onSelect}
      disabled={disabled}
    >
      <div style={{ textAlign: "left" }}>
        <p className={styles.jellyfinTitle}>{file.title}</p>
        <p className={styles.jellyfinMeta}>
          {file.filename} · {formatBytes(file.sizeBytes)}
          {convertedAt
            ? ` · converted ${formatDate(convertedAt)}`
            : file.modifiedAt
              ? ` · ${formatDate(file.modifiedAt)}`
              : ""}
          {onCdn ? " · on CDN" : ""}
        </p>
      </div>
    </button>
  );
}

export function BunnyUploadPanel({
  bunnyConfigured,
  jellyfinOutputAvailable,
  bunnyFilenames,
  onUploadComplete,
}: BunnyUploadPanelProps) {
  const [tab, setTab] = useState<Tab>("jellyfin");
  const [jellyfinFiles, setJellyfinFiles] = useState<JellyfinOutputFile[]>([]);
  const [conversionHistory, setConversionHistory] = useState<ConversionJob[]>([]);
  const [loadingJellyfin, setLoadingJellyfin] = useState(false);
  const [jellyfinQuery, setJellyfinQuery] = useState("");
  const [jellyfinSort, setJellyfinSort] = useState<JellyfinSort>("newest");
  const [selected, setSelected] = useState<JellyfinOutputFile | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [directPercent, setDirectPercent] = useState(0);
  const [agentJob, setAgentJob] = useState<BunnyUploadJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragDepth, setDragDepth] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const completedJobRef = useRef<string | null>(null);

  const loadJellyfin = useCallback(async () => {
    setLoadingJellyfin(true);
    try {
      const [libraryResponse, historyResponse] = await Promise.all([
        fetch("/api/cdn/jellyfin-library"),
        fetch("/api/movies/convert/history"),
      ]);
      const libraryData = (await libraryResponse.json()) as {
        files: JellyfinOutputFile[];
        error?: string;
      };
      const historyData = (await historyResponse.json()) as {
        jobs: ConversionJob[];
      };
      setJellyfinFiles(libraryData.files ?? []);
      setConversionHistory(historyData.jobs ?? []);
    } catch {
      setJellyfinFiles([]);
      setConversionHistory([]);
    } finally {
      setLoadingJellyfin(false);
    }
  }, []);

  useEffect(() => {
    if (bunnyConfigured) {
      void loadJellyfin();
    }
  }, [bunnyConfigured, loadJellyfin]);

  const filterFiles = useCallback(
    (files: JellyfinOutputFile[]) => {
      const query = jellyfinQuery.trim().toLowerCase();
      let list = query
        ? files.filter(
            (file) =>
              file.title.toLowerCase().includes(query) ||
              file.filename.toLowerCase().includes(query),
          )
        : files;

      list = [...list];
      if (jellyfinSort === "newest") {
        list.sort(
          (a, b) =>
            Date.parse(b.modifiedAt || "0") - Date.parse(a.modifiedAt || "0"),
        );
      } else {
        list.sort((a, b) => a.title.localeCompare(b.title));
      }
      return list;
    },
    [jellyfinQuery, jellyfinSort],
  );

  const recentUploadCandidates = useMemo(() => {
    const seen = new Set<string>();
    const results: { file: JellyfinOutputFile; convertedAt: string | null }[] = [];

    for (const job of conversionHistory) {
      if (!isJellyfinOutputJob(job) || job.status !== "done") continue;
      const file = matchJellyfinFile(job, jellyfinFiles);
      if (!file || seen.has(file.relativePath)) continue;
      seen.add(file.relativePath);
      results.push({ file, convertedAt: job.finishedAt });
    }

    return results;
  }, [conversionHistory, jellyfinFiles]);

  const filteredRecent = useMemo(() => {
    const query = jellyfinQuery.trim().toLowerCase();
    let list = recentUploadCandidates;
    if (query) {
      list = list.filter(
        ({ file }) =>
          file.title.toLowerCase().includes(query) ||
          file.filename.toLowerCase().includes(query),
      );
    }
    return list.slice(0, 12);
  }, [recentUploadCandidates, jellyfinQuery]);

  const filteredJellyfinFiles = useMemo(() => {
    const recentPaths = new Set(
      recentUploadCandidates.map(({ file }) => file.relativePath),
    );
    const folderFiles = jellyfinFiles.filter(
      (file) => !recentPaths.has(file.relativePath),
    );
    return filterFiles(folderFiles);
  }, [jellyfinFiles, recentUploadCandidates, filterFiles]);

  useEffect(() => {
    if (!agentJob) return;

    if (agentJob.status === "done") {
      setUploading(false);
      setError(null);
      if (completedJobRef.current !== agentJob.id) {
        completedJobRef.current = agentJob.id;
        onUploadComplete();
        void loadJellyfin();
      }
      const timer = window.setTimeout(() => {
        setAgentJob(null);
        completedJobRef.current = null;
      }, 6000);
      return () => window.clearTimeout(timer);
    }

    if (agentJob.status === "failed") {
      setUploading(false);
      setError(agentJob.error ?? "Upload failed");
      return;
    }

    if (agentJob.status !== "queued" && agentJob.status !== "running") {
      return;
    }

    const interval = window.setInterval(async () => {
      const response = await fetch(
        `/api/cdn/upload/${encodeURIComponent(agentJob.id)}`,
      );
      if (!response.ok) {
        setError("Lost contact with upload job — try refreshing the page.");
        setUploading(false);
        return;
      }
      const job = (await response.json()) as BunnyUploadJob;
      setAgentJob(job);
      setError(null);
    }, 1500);

    return () => window.clearInterval(interval);
  }, [agentJob, onUploadComplete, loadJellyfin]);

  const selectedExistsOnBunny =
    selected !== null && bunnyFilenames.has(selected.filename);

  const uploadJellyfin = async () => {
    if (!selected) return;
    setError(null);
    setUploading(true);
    completedJobRef.current = null;

    try {
      const response = await fetch("/api/cdn/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jellyfinRelativePath: selected.relativePath,
          overwrite,
        }),
      });
      const data = (await response.json()) as {
        job?: BunnyUploadJob;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Upload failed");
      }
      if (data.job) {
        setAgentJob(data.job);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploading(false);
    }
  };

  const uploadFile = (file: File, forceOverwrite: boolean) => {
    setError(null);
    setUploading(true);
    setDirectPercent(0);
    setAgentJob(null);
    completedJobRef.current = null;

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/cdn/upload");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setDirectPercent((event.loaded / event.total) * 100);
      }
    };
    xhr.onload = () => {
      setUploading(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        setDirectPercent(100);
        onUploadComplete();
        void loadJellyfin();
        return;
      }
      try {
        const data = JSON.parse(xhr.responseText) as { error?: string };
        setError(data.error ?? "Upload failed");
      } catch {
        setError("Upload failed");
      }
    };
    xhr.onerror = () => {
      setUploading(false);
      setError("Upload failed");
    };

    const formData = new FormData();
    formData.append("file", file);
    formData.append("overwrite", forceOverwrite ? "true" : "false");
    xhr.send(formData);
  };

  const handleDropFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".mp4")) {
      setError("Only .mp4 files are supported");
      return;
    }
    const exists = bunnyFilenames.has(file.name);
    if (exists && !overwrite) {
      setError("File already exists on Bunny — enable overwrite to replace it");
      return;
    }
    uploadFile(file, overwrite || exists);
  };

  const disabled = !bunnyConfigured || uploading;

  return (
    <section className={styles.panel}>
      <h2 className={styles.sectionTitle}>Upload to Bunny</h2>

      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${tab === "jellyfin" ? styles.tabActive : ""}`}
          onClick={() => setTab("jellyfin")}
        >
          Jellyfin output
        </button>
        <button
          type="button"
          className={`${styles.tab} ${tab === "drop" ? styles.tabActive : ""}`}
          onClick={() => setTab("drop")}
        >
          Drag and drop
        </button>
      </div>

      {tab === "jellyfin" && (
        <>
          {!jellyfinOutputAvailable && (
            <p className={styles.warning}>
              Jellyfin output folder is not readable. Check the Jellyfin output
              path in Settings and that the J: drive mount is available.
            </p>
          )}

          <div className={styles.searchRow}>
            <input
              type="search"
              placeholder="Search movies…"
              value={jellyfinQuery}
              onChange={(e) => setJellyfinQuery(e.target.value)}
              aria-label="Search movies to upload"
            />
            <button
              type="button"
              className={`${styles.button} ${styles.buttonSecondary}`}
              disabled={loadingJellyfin || !jellyfinOutputAvailable}
              onClick={() => void loadJellyfin()}
              style={{ marginTop: "0.5rem" }}
            >
              {loadingJellyfin ? "Refreshing…" : "Refresh lists"}
            </button>
          </div>

          <div className={styles.tabs} style={{ marginBottom: "0.5rem" }}>
            <button
              type="button"
              className={`${styles.tab} ${jellyfinSort === "newest" ? styles.tabActive : ""}`}
              onClick={() => setJellyfinSort("newest")}
            >
              Newest first
            </button>
            <button
              type="button"
              className={`${styles.tab} ${jellyfinSort === "alpha" ? styles.tabActive : ""}`}
              onClick={() => setJellyfinSort("alpha")}
            >
              A–Z
            </button>
          </div>

          <section className={styles.uploadSection}>
            <h3 className={styles.subsectionTitle}>Recently converted</h3>
            <p className={styles.meta}>
              {loadingJellyfin
                ? "Loading…"
                : `${filteredRecent.length} ready from recent Jellyfin encodes`}
            </p>
            <div className={`${styles.list} ${styles.listCompact}`}>
              {loadingJellyfin && jellyfinFiles.length === 0 ? (
                <p className={styles.empty}>Loading…</p>
              ) : filteredRecent.length === 0 ? (
                <p className={styles.empty}>
                  No recent Jellyfin conversions found in the output folder.
                </p>
              ) : (
                filteredRecent.map(({ file, convertedAt }) => (
                  <JellyfinFileRow
                    key={`recent-${file.relativePath}`}
                    file={file}
                    selected={selected?.relativePath === file.relativePath}
                    onCdn={bunnyFilenames.has(file.filename)}
                    convertedAt={convertedAt}
                    disabled={!jellyfinOutputAvailable || uploading}
                    onSelect={() => {
                      setSelected(file);
                      setOverwrite(false);
                    }}
                  />
                ))
              )}
            </div>
          </section>

          <section className={styles.uploadSection}>
            <h3 className={styles.subsectionTitle}>Jellyfin output folder</h3>
            <p className={styles.meta}>
              {loadingJellyfin
                ? "Scanning folder…"
                : `${filteredJellyfinFiles.length} other .mp4 file${filteredJellyfinFiles.length === 1 ? "" : "s"} on J:`}
            </p>
            <div className={styles.list}>
              {loadingJellyfin && jellyfinFiles.length === 0 ? (
                <p className={styles.empty}>Loading Jellyfin files…</p>
              ) : filteredJellyfinFiles.length === 0 ? (
                <p className={styles.empty}>
                  {jellyfinFiles.length === 0
                    ? "No .mp4 files in the Jellyfin output folder."
                    : "No other files match your search."}
                </p>
              ) : (
                filteredJellyfinFiles.map((file) => (
                  <JellyfinFileRow
                    key={file.relativePath}
                    file={file}
                    selected={selected?.relativePath === file.relativePath}
                    onCdn={bunnyFilenames.has(file.filename)}
                    disabled={!jellyfinOutputAvailable || uploading}
                    onSelect={() => {
                      setSelected(file);
                      setOverwrite(false);
                    }}
                  />
                ))
              )}
            </div>
          </section>

          {selected && (
            <>
              {selectedExistsOnBunny && (
                <div className={styles.warning}>
                  Already on Bunny. Check overwrite to replace.
                  <label className={styles.checkboxRow}>
                    <input
                      type="checkbox"
                      checked={overwrite}
                      onChange={(e) => setOverwrite(e.target.checked)}
                    />
                    Overwrite existing CDN file
                  </label>
                </div>
              )}
              <div style={{ marginTop: "0.75rem" }}>
                <button
                  type="button"
                  className={styles.button}
                  disabled={
                    disabled ||
                    !jellyfinOutputAvailable ||
                    (selectedExistsOnBunny && !overwrite)
                  }
                  onClick={() => void uploadJellyfin()}
                >
                  Upload to Bunny
                </button>
              </div>
            </>
          )}
        </>
      )}

      {tab === "drop" && (
        <>
          <div
            className={`${styles.dropZone} ${dragDepth > 0 ? styles.dropZoneActive : ""} ${disabled ? styles.dropZoneDisabled : ""}`}
            onDragEnter={(e) => {
              e.preventDefault();
              if (!disabled) setDragDepth((d) => d + 1);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragDepth((d) => Math.max(0, d - 1));
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              setDragDepth(0);
              if (disabled) return;
              const file = e.dataTransfer.files[0];
              if (file) handleDropFile(file);
            }}
            onClick={() => !disabled && fileInputRef.current?.click()}
          >
            Drop a .mp4 here or click to choose a file
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp4,video/mp4"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleDropFile(file);
              e.target.value = "";
            }}
          />
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            Overwrite if file already exists on Bunny
          </label>
          {uploading && !agentJob && (
            <>
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${directPercent}%` }}
                />
              </div>
              <p className={styles.meta}>{directPercent.toFixed(1)}% uploaded</p>
            </>
          )}
        </>
      )}

      {error && <p className={styles.warning}>{error}</p>}

      {agentJob && <BunnyUploadProgress job={agentJob} />}
    </section>
  );
}
