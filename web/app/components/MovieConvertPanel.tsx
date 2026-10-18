"use client";

import { useCallback, useEffect, useState } from "react";
import { formatBytes } from "@/lib/format";
import { buildPlannedOutputPath } from "@/lib/converter-agent-client";
import type {
  ConversionPreset,
  EncodingTuning,
} from "@/lib/converter-agent";
import type { MovieEntry } from "@/lib/movies-library";
import { SubtitleApplyPanel } from "./SubtitleApplyPanel";
import styles from "./Movies.module.css";

type AudioTrackInfo = {
  streamIndex: number;
  language: string;
  codec: string;
  channels?: number | null;
};

type ProbeData = {
  durationLabel: string | null;
  resolution: string | null;
  videoCodec: string | null;
  audioTrackCount: number;
  audioLanguages: string[];
  audioTracks?: AudioTrackInfo[];
  subtitleTrackCount: number;
  error?: string;
};

type OutputCheck = {
  exists: boolean;
  outputPath: string;
  outputSizeBytes: number | null;
};

type PresetDetail = {
  summary?: {
    video?: string;
    audio?: string;
    subtitles?: string;
    container?: string;
  };
  description?: string;
};

type MovieConvertPanelProps = {
  movie: MovieEntry;
  agentOnline: boolean;
  outputWritable: boolean;
  converting: boolean;
  onConvert: (
    overwrite: boolean,
    preset: string,
    tuning?: EncodingTuning,
  ) => void;
  onClear: () => void;
};

const DEFAULT_PRESET = "jellyfin-library";

function isEnglishLanguage(language: string): boolean {
  const normalized = language.trim().toLowerCase();
  return (
    normalized === "eng" ||
    normalized === "en" ||
    normalized === "english" ||
    normalized.startsWith("en-") ||
    normalized.startsWith("eng")
  );
}

/** HandBrake uses 1-based indices over audio tracks in file order. */
function pickDefaultAudioTrack(tracks: AudioTrackInfo[]): number {
  if (tracks.length === 0) return 1;

  const scoreTrack = (track: AudioTrackInfo, index: number): number => {
    let score = 0;
    if (isEnglishLanguage(track.language)) score += 100;
    const codec = (track.codec || "").toLowerCase();
    // Prefer codecs HandBrake reliably re-encodes to stereo AAC.
    if (codec === "ac3" || codec === "aac" || codec === "mp3") score += 80;
    else if (codec === "opus" || codec === "vorbis") score += 60;
    else if (codec === "eac3") score += 10; // some E-AC3 streams decode as 0 frames
    else if (codec === "dts" || codec === "truehd" || codec === "dtshd") score += 20;
    if (track.channels === 2) score += 25;
    else if (track.channels === 6) score += 10;
    else if ((track.channels ?? 0) >= 8) score -= 15;
    // Mild preference for earlier tracks when scores tie.
    score -= index * 0.1;
    return score;
  };

  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  tracks.forEach((track, index) => {
    const score = scoreTrack(track, index);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex + 1;
}

function formatAudioTrackLabel(
  track: AudioTrackInfo,
  handbrakeIndex: number,
): string {
  const language = track.language?.trim() || "und";
  const codec = track.codec?.trim() || "unknown";
  const channels =
    track.channels && track.channels > 0 ? ` · ${track.channels}ch` : "";
  return `Track ${handbrakeIndex} · ${language} · ${codec}${channels}`;
}

export function MovieConvertPanel({
  movie,
  agentOnline,
  outputWritable,
  converting,
  onConvert,
  onClear,
}: MovieConvertPanelProps) {
  const [probe, setProbe] = useState<ProbeData | null>(null);
  const [outputCheck, setOutputCheck] = useState<OutputCheck | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [presets, setPresets] = useState<ConversionPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState(DEFAULT_PRESET);
  const [presetDetail, setPresetDetail] = useState<PresetDetail | null>(null);
  const [subtitleMessage, setSubtitleMessage] = useState<string | null>(null);
  const [audioTrack, setAudioTrack] = useState(1);

  const plannedOutput = buildPlannedOutputPath(movie.folderName, movie.videoFile);
  const audioTracks = probe?.audioTracks ?? [];

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    try {
      const [probeRes, checkRes] = await Promise.all([
        fetch(`/api/movies/${encodeURIComponent(movie.id)}/probe`),
        fetch(
          `/api/movies/convert/check-output?movieId=${encodeURIComponent(movie.id)}`,
        ),
      ]);

      if (probeRes.ok) {
        const nextProbe = (await probeRes.json()) as ProbeData;
        setProbe(nextProbe);
        setAudioTrack(pickDefaultAudioTrack(nextProbe.audioTracks ?? []));
      } else {
        setProbe(null);
        setAudioTrack(1);
      }

      if (checkRes.ok) {
        const check = (await checkRes.json()) as OutputCheck;
        setOutputCheck(check);
        setOverwrite(false);
      } else {
        setOutputCheck(null);
      }
    } finally {
      setLoadingMeta(false);
    }
  }, [movie.id]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/movies/convert/presets?mode=jellyfin");
        const data = (await response.json()) as { presets?: ConversionPreset[] };
        const list = data.presets ?? [];
        setPresets(list);
        if (list.some((p) => p.id === DEFAULT_PRESET)) {
          setSelectedPreset(DEFAULT_PRESET);
        } else if (list[0]) {
          setSelectedPreset(list[0].id);
        }
      } catch {
        setPresets([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedPreset) return;
    void (async () => {
      try {
        const response = await fetch(
          `/api/movies/convert/presets/${encodeURIComponent(selectedPreset)}`,
        );
        if (response.ok) {
          setPresetDetail((await response.json()) as PresetDetail);
        } else {
          setPresetDetail(null);
        }
      } catch {
        setPresetDetail(null);
      }
    })();
  }, [selectedPreset]);

  const convertDisabled =
    converting ||
    !agentOnline ||
    !outputWritable ||
    (outputCheck?.exists && !overwrite) ||
    presets.length === 0;

  const selectedPresetMeta = presets.find((p) => p.id === selectedPreset);

  return (
    <section className={styles.panel}>
      <h2 className={styles.sectionTitle}>Selected movie</h2>
      <p className={styles.metaValue} style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>
        {movie.title}
      </p>

      <div className={styles.metaGrid}>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Source format</span>
          <span className={styles.metaValue}>
            {movie.format.toUpperCase()} · {formatBytes(movie.sizeBytes)}
          </span>
        </div>
        {loadingMeta ? (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Metadata</span>
            <span className={styles.metaValue}>Loading…</span>
          </div>
        ) : probe ? (
          <>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Duration</span>
              <span className={styles.metaValue}>
                {probe.durationLabel ?? "—"}
              </span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Resolution</span>
              <span className={styles.metaValue}>
                {probe.resolution ?? "—"}
                {probe.videoCodec ? ` · ${probe.videoCodec}` : ""}
              </span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Audio tracks</span>
              <span className={styles.metaValue}>
                {probe.audioTrackCount}
                {probe.audioLanguages.length > 0
                  ? ` (${probe.audioLanguages.join(", ")})`
                  : ""}
              </span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Subtitle tracks</span>
              <span className={styles.metaValue}>{probe.subtitleTrackCount}</span>
            </div>
          </>
        ) : null}
        <div className={styles.metaItem} style={{ gridColumn: "1 / -1" }}>
          <span className={styles.metaLabel}>Output path</span>
          <span className={styles.metaValue}>{plannedOutput}</span>
        </div>
      </div>

      <div className={styles.metaItem} style={{ marginTop: "0.75rem" }}>
        <span className={styles.metaLabel}>Source subtitles</span>
        <SubtitleApplyPanel
          movieId={movie.id}
          compact
          onApplied={(message) => {
            setSubtitleMessage(message);
            window.setTimeout(() => setSubtitleMessage(null), 4000);
          }}
          onError={(message) => {
            setSubtitleMessage(message);
            window.setTimeout(() => setSubtitleMessage(null), 4000);
          }}
        />
        {subtitleMessage && (
          <p className={styles.presetHint} style={{ marginTop: "0.5rem" }}>
            {subtitleMessage}
          </p>
        )}
      </div>

      <div className={styles.metaItem} style={{ marginTop: "0.75rem" }}>
        <label className={styles.metaLabel} htmlFor="convert-preset">
          Conversion preset
        </label>
        <select
          id="convert-preset"
          className={styles.presetSelect}
          value={selectedPreset}
          disabled={converting || presets.length === 0}
          onChange={(e) => setSelectedPreset(e.target.value)}
        >
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
        {(presetDetail?.description || selectedPresetMeta?.description) && (
          <p className={styles.presetHint}>
            {presetDetail?.description ?? selectedPresetMeta?.description}
          </p>
        )}
        {presetDetail?.summary && (
          <ul className={styles.presetSummary}>
            {presetDetail.summary.video && <li>{presetDetail.summary.video}</li>}
            {presetDetail.summary.audio && <li>{presetDetail.summary.audio}</li>}
            {presetDetail.summary.subtitles && (
              <li>{presetDetail.summary.subtitles}</li>
            )}
            {presetDetail.summary.container && (
              <li>{presetDetail.summary.container}</li>
            )}
          </ul>
        )}
      </div>

      <div className={styles.metaItem} style={{ marginTop: "0.75rem" }}>
        <label className={styles.metaLabel} htmlFor="convert-audio-track">
          Audio track
        </label>
        <select
          id="convert-audio-track"
          className={styles.presetSelect}
          value={audioTrack}
          disabled={converting || loadingMeta || audioTracks.length === 0}
          onChange={(e) => setAudioTrack(Number(e.target.value))}
        >
          {audioTracks.length === 0 ? (
            <option value={1}>Track 1 (default)</option>
          ) : (
            audioTracks.map((track, index) => {
              const handbrakeIndex = index + 1;
              return (
                <option key={`${track.streamIndex}-${handbrakeIndex}`} value={handbrakeIndex}>
                  {formatAudioTrackLabel(track, handbrakeIndex)}
                </option>
              );
            })
          )}
        </select>
        <p className={styles.presetHint}>
          Jellyfin Library converts one stereo AAC track. Defaults to English when
          tagged; change this if the first track is another language.
        </p>
      </div>

      {outputCheck?.exists && (
        <div className={styles.warning}>
          Output already exists
          {outputCheck.outputSizeBytes
            ? ` (${formatBytes(outputCheck.outputSizeBytes)})`
            : ""}
          . Check overwrite to replace it.
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            Overwrite existing file
          </label>
        </div>
      )}

      <video
        className={styles.videoPreview}
        controls
        preload="metadata"
        src={`/api/movies/stream/${encodeURIComponent(movie.id)}`}
      />

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          disabled={convertDisabled}
          onClick={() =>
            onConvert(overwrite, selectedPreset, { audioTrack })
          }
        >
          Convert to Jellyfin
        </button>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonSecondary}`}
          disabled={converting}
          onClick={onClear}
        >
          Clear selection
        </button>
      </div>
    </section>
  );
}
