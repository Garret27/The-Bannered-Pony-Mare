"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConversionPreset,
  EncodingTuning,
  PresetDetail,
  PresetPreview,
} from "@/lib/converter-agent";
import { formatBytes } from "@/lib/format";
import styles from "./SpaceSaver.module.css";

const STORAGE_PREFIX = "space-saver-tuning:";

const ENCODER_LABELS: Record<string, string> = {
  nvenc_h264: "NVENC H.264",
  nvenc_h265: "NVENC H.265",
  x264: "x264",
};

const RESOLUTION_LABELS: Record<string, string> = {
  source: "Keep source",
  "1080p": "1080p cap",
  "720p": "720p cap",
};

const CONTAINER_LABELS: Record<string, string> = {
  auto: "Auto",
  mkv: "MKV",
  mp4: "MP4",
};

function qualityHint(cq: number): string {
  if (cq <= 20) return "Very high quality";
  if (cq <= 23) return "Balanced";
  if (cq <= 26) return "Smaller files";
  return "Aggressive";
}

function loadStoredTuning(presetId: string): EncodingTuning | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${presetId}`);
    if (!raw) return null;
    return JSON.parse(raw) as EncodingTuning;
  } catch {
    return null;
  }
}

function saveStoredTuning(presetId: string, tuning: EncodingTuning) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${presetId}`, JSON.stringify(tuning));
  } catch {
    // ignore quota errors
  }
}

function clearStoredTuning(presetId: string) {
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${presetId}`);
  } catch {
    // ignore
  }
}

function tuningOverrides(
  defaults: EncodingTuning,
  current: EncodingTuning,
): EncodingTuning {
  const overrides: EncodingTuning = {};
  if (current.quality !== undefined && current.quality !== defaults.quality) {
    overrides.quality = current.quality;
  }
  if (current.encoder !== undefined && current.encoder !== defaults.encoder) {
    overrides.encoder = current.encoder;
  }
  if (
    current.resolutionMode !== undefined &&
    current.resolutionMode !== defaults.resolutionMode
  ) {
    overrides.resolutionMode = current.resolutionMode;
  }
  if (
    current.audioBitrate !== undefined &&
    current.audioBitrate !== defaults.audioBitrate
  ) {
    overrides.audioBitrate = current.audioBitrate;
  }
  if (
    current.keepAllAudio !== undefined &&
    current.keepAllAudio !== defaults.keepAllAudio
  ) {
    overrides.keepAllAudio = current.keepAllAudio;
  }
  if (
    current.keepSubtitles !== undefined &&
    current.keepSubtitles !== defaults.keepSubtitles
  ) {
    overrides.keepSubtitles = current.keepSubtitles;
  }
  if (
    current.container !== undefined &&
    current.container !== defaults.container
  ) {
    overrides.container = current.container;
  }
  return overrides;
}

type PresetTuningPanelProps = {
  presets: ConversionPreset[];
  presetId: string;
  onPresetChange: (presetId: string) => void;
  onTuningChange: (tuning: EncodingTuning, estimatedSizeRatio: number) => void;
  selectedTotalBytes?: number;
  disabled?: boolean;
};

export function PresetTuningPanel({
  presets,
  presetId,
  onPresetChange,
  onTuningChange,
  selectedTotalBytes = 0,
  disabled = false,
}: PresetTuningPanelProps) {
  const [detail, setDetail] = useState<PresetDetail | null>(null);
  const [tuning, setTuning] = useState<EncodingTuning>({});
  const [preview, setPreview] = useState<PresetPreview | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const previewTimer = useRef<number | null>(null);

  const fetchPreview = useCallback(
    async (id: string, current: EncodingTuning, defaults: EncodingTuning) => {
      const overrides = tuningOverrides(defaults, current);
      const hasOverrides = Object.keys(overrides).length > 0;
      try {
        const response = await fetch(
          `/api/movies/convert/presets/${encodeURIComponent(id)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tuning: hasOverrides ? overrides : undefined }),
          },
        );
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error ?? "Preview failed");
        }
        const data = (await response.json()) as PresetPreview;
        setPreview(data);
        onTuningChange(data.tuning, data.estimatedSizeRatio);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Preview failed");
      }
    },
    [onTuningChange],
  );

  const schedulePreview = useCallback(
    (id: string, current: EncodingTuning, defaults: EncodingTuning) => {
      if (previewTimer.current) {
        window.clearTimeout(previewTimer.current);
      }
      previewTimer.current = window.setTimeout(() => {
        void fetchPreview(id, current, defaults);
      }, 300);
    },
    [fetchPreview],
  );

  const loadPreset = useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/movies/convert/presets/${encodeURIComponent(id)}`,
        );
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error ?? "Failed to load preset");
        }
        const data = (await response.json()) as PresetDetail;
        setDetail(data);

        const stored = loadStoredTuning(id);
        const merged = { ...data.defaults, ...stored };
        setTuning(merged);
        setPreview({
          cliPreview: data.cliPreview,
          summary: data.summary,
          estimatedSizeRatio: data.estimatedSizeRatio,
          tuning: merged,
        });
        onTuningChange(merged, data.estimatedSizeRatio);
        schedulePreview(id, merged, data.defaults);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load preset");
        setDetail(null);
      } finally {
        setLoading(false);
      }
    },
    [onTuningChange, schedulePreview],
  );

  useEffect(() => {
    void loadPreset(presetId);
    return () => {
      if (previewTimer.current) {
        window.clearTimeout(previewTimer.current);
      }
    };
  }, [presetId, loadPreset]);

  const updateTuning = (patch: Partial<EncodingTuning>) => {
    if (!detail) return;
    const next = { ...tuning, ...patch };
    setTuning(next);
    saveStoredTuning(presetId, next);
    schedulePreview(presetId, next, detail.defaults);
  };

  const resetToDefaults = () => {
    if (!detail) return;
    clearStoredTuning(presetId);
    setTuning(detail.defaults);
    schedulePreview(presetId, detail.defaults, detail.defaults);
  };

  const schema = detail?.schema;
  const summary = preview?.summary ?? detail?.summary;
  const cliPreview = preview?.cliPreview ?? detail?.cliPreview ?? [];
  const estimatedRatio = preview?.estimatedSizeRatio ?? detail?.estimatedSizeRatio ?? 0.55;
  const quality = tuning.quality ?? detail?.defaults.quality ?? 22;
  const qualityMin = schema?.quality?.min ?? 18;
  const qualityMax = schema?.quality?.max ?? 30;

  return (
    <div className={styles.tuningPanel}>
      <div className={styles.tuningHeader}>
        <div className={styles.tuningPresetRow}>
          <label htmlFor="tuning-preset">Preset</label>
          <select
            id="tuning-preset"
            value={presetId}
            disabled={disabled || loading}
            onChange={(e) => onPresetChange(e.target.value)}
          >
            {presets.length > 0 ? (
              presets.map((p) => (
                <option key={p.id} value={p.id} title={p.description}>
                  {p.label}
                </option>
              ))
            ) : (
              <option value={presetId}>{presetId}</option>
            )}
          </select>
          <button
            type="button"
            className={styles.tuningResetBtn}
            disabled={disabled || loading || !detail}
            onClick={resetToDefaults}
          >
            Reset defaults
          </button>
        </div>
        {detail?.description && (
          <p className={styles.tuningDescription}>{detail.description}</p>
        )}
      </div>

      {error && <p className={styles.tuningError}>{error}</p>}
      {loading && !detail && (
        <p className={styles.tuningLoading}>Loading preset settings…</p>
      )}

      {detail && (
        <>
          <section className={styles.tuningSection}>
            <h3 className={styles.tuningSectionTitle}>Video</h3>
            <div className={styles.tuningSummaryGrid}>
              <div className={styles.tuningSummaryItem}>
                <span className={styles.tuningSummaryLabel}>Encoder</span>
                <span>{ENCODER_LABELS[tuning.encoder ?? ""] ?? tuning.encoder}</span>
              </div>
              <div className={styles.tuningSummaryItem}>
                <span className={styles.tuningSummaryLabel}>Resolution</span>
                <span>
                  {RESOLUTION_LABELS[tuning.resolutionMode ?? "source"] ??
                    tuning.resolutionMode}
                </span>
              </div>
            </div>

            <div className={styles.tuningSliderRow}>
              <div className={styles.tuningSliderHeader}>
                <label htmlFor="tuning-quality">Quality (CQ)</label>
                <span className={styles.tuningSliderValue}>
                  {quality}{" "}
                  <span className={styles.tuningSliderHint}>
                    — {qualityHint(quality)}
                  </span>
                </span>
              </div>
              <input
                id="tuning-quality"
                type="range"
                className={styles.tuningSlider}
                min={qualityMin}
                max={qualityMax}
                step={schema?.quality?.step ?? 1}
                value={quality}
                disabled={disabled}
                onChange={(e) =>
                  updateTuning({ quality: Number(e.target.value) })
                }
              />
              <div className={styles.tuningSliderLegend}>
                <span>Higher quality</span>
                <span>Smaller file</span>
              </div>
            </div>
          </section>

          {summary && (
            <section className={styles.tuningSection}>
              <h3 className={styles.tuningSectionTitle}>Audio / Subtitles</h3>
              <p className={styles.tuningSummaryText}>
                {summary.audio} · {summary.subtitles}
              </p>
            </section>
          )}

          <section className={styles.tuningSection}>
            <button
              type="button"
              className={styles.tuningAdvancedToggle}
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((open) => !open)}
            >
              Advanced {advancedOpen ? "▲" : "▼"}
            </button>

            {advancedOpen && (
              <div className={styles.tuningAdvancedGrid}>
                <div className={styles.tuningField}>
                  <label htmlFor="tuning-encoder">Encoder</label>
                  <select
                    id="tuning-encoder"
                    value={tuning.encoder ?? detail.defaults.encoder}
                    disabled={disabled || schema?.encoder?.editable === false}
                    onChange={(e) => updateTuning({ encoder: e.target.value })}
                  >
                    {(schema?.encoder?.options ?? []).map((opt) => (
                      <option key={opt} value={opt}>
                        {ENCODER_LABELS[opt] ?? opt}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.tuningField}>
                  <label htmlFor="tuning-resolution">Resolution cap</label>
                  <select
                    id="tuning-resolution"
                    value={tuning.resolutionMode ?? detail.defaults.resolutionMode}
                    disabled={
                      disabled || schema?.resolutionMode?.editable === false
                    }
                    onChange={(e) =>
                      updateTuning({
                        resolutionMode: e.target
                          .value as EncodingTuning["resolutionMode"],
                      })
                    }
                  >
                    {(schema?.resolutionMode?.options ?? []).map((opt) => (
                      <option key={opt} value={opt}>
                        {RESOLUTION_LABELS[opt] ?? opt}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.tuningFieldWide}>
                  <div className={styles.tuningSliderHeader}>
                    <label htmlFor="tuning-audio-bitrate">Audio bitrate</label>
                    <span className={styles.tuningSliderValue}>
                      {tuning.audioBitrate ?? detail.defaults.audioBitrate} kbps
                    </span>
                  </div>
                  <input
                    id="tuning-audio-bitrate"
                    type="range"
                    className={styles.tuningSlider}
                    min={schema?.audioBitrate?.min ?? 96}
                    max={schema?.audioBitrate?.max ?? 320}
                    step={schema?.audioBitrate?.step ?? 32}
                    value={tuning.audioBitrate ?? detail.defaults.audioBitrate}
                    disabled={
                      disabled || schema?.audioBitrate?.editable === false
                    }
                    onChange={(e) =>
                      updateTuning({ audioBitrate: Number(e.target.value) })
                    }
                  />
                </div>

                <label className={styles.tuningCheckbox}>
                  <input
                    type="checkbox"
                    checked={tuning.keepAllAudio ?? detail.defaults.keepAllAudio}
                    disabled={
                      disabled || schema?.keepAllAudio?.editable === false
                    }
                    onChange={(e) =>
                      updateTuning({ keepAllAudio: e.target.checked })
                    }
                  />
                  Keep all audio tracks
                </label>

                <label className={styles.tuningCheckbox}>
                  <input
                    type="checkbox"
                    checked={
                      tuning.keepSubtitles ?? detail.defaults.keepSubtitles
                    }
                    disabled={
                      disabled || schema?.keepSubtitles?.editable === false
                    }
                    onChange={(e) =>
                      updateTuning({ keepSubtitles: e.target.checked })
                    }
                  />
                  Copy subtitle tracks
                </label>

                <div className={styles.tuningField}>
                  <label htmlFor="tuning-container">Container</label>
                  <select
                    id="tuning-container"
                    value={tuning.container ?? detail.defaults.container}
                    disabled={disabled || schema?.container?.editable === false}
                    onChange={(e) =>
                      updateTuning({
                        container: e.target.value as EncodingTuning["container"],
                      })
                    }
                  >
                    {(schema?.container?.options ?? []).map((opt) => (
                      <option key={opt} value={opt}>
                        {CONTAINER_LABELS[opt] ?? opt}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </section>

          <section className={styles.tuningSection}>
            <h3 className={styles.tuningSectionTitle}>Output preview</h3>
            <p className={styles.tuningEstimate}>
              Est. size ratio:{" "}
              <strong>{Math.round(estimatedRatio * 100)}%</strong> of original
              {selectedTotalBytes > 0 && (
                <>
                  {" "}
                  (~{formatBytes(Math.round(selectedTotalBytes * estimatedRatio))}{" "}
                  for selected)
                </>
              )}
            </p>
            <pre className={styles.tuningCliPreview}>
              HandBrakeCLI -i &lt;source&gt; -o &lt;output&gt;{" "}
              {cliPreview.join(" ")}
            </pre>
          </section>
        </>
      )}
    </div>
  );
}
