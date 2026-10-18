"use client";

import { formatBytes } from "@/lib/format";
import type { ConversionPreset } from "@/lib/converter-agent";
import type { TvEpisodeEntry } from "@/lib/tv-types";
import styles from "./Movies.module.css";

export type TvEpisodeListItem = TvEpisodeEntry & { code: string };

export function tvEpisodeAnchorId(episodeId: string): string {
  return `tv-episode-${episodeId}`;
}

function ConvertedCheck() {
  return (
    <span
      className={styles.convertedCheck}
      title="Already converted to the Jellyfin TV library"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m4 12 6 6L20 6" />
      </svg>
      <span className={styles.srOnly}>Already converted</span>
    </span>
  );
}

export type TvSeasonListItem = {
  season: number;
  label: string;
  episodeCount: number;
};

type SeasonListProps = {
  seriesTitle: string;
  seasons: TvSeasonListItem[];
  loading?: boolean;
  onSelectSeason: (season: number) => void;
  onBack: () => void;
};

export function SeasonList({
  seriesTitle,
  seasons,
  loading,
  onSelectSeason,
  onBack,
}: SeasonListProps) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          marginBottom: "0.75rem",
        }}
      >
        <h2 className={styles.sectionTitle} style={{ marginBottom: 0 }}>
          {seriesTitle}
        </h2>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonSecondary}`}
          onClick={onBack}
        >
          Back to shows
        </button>
      </div>

      {loading ? (
        <p className={styles.empty}>Loading seasons…</p>
      ) : seasons.length === 0 ? (
        <p className={styles.empty}>
          No convertible seasons found on the H drive for this show.
        </p>
      ) : (
        <div className={styles.historyList}>
          {seasons.map((season) => (
            <button
              key={season.season}
              type="button"
              className={styles.historyRow}
              onClick={() => onSelectSeason(season.season)}
            >
              <div className={styles.historyHeader}>
                <span className={styles.historyTitle}>{season.label}</span>
                <span className={styles.statusBadge}>
                  {season.episodeCount} ep
                  {season.episodeCount === 1 ? "" : "s"}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type EpisodeListProps = {
  seriesTitle: string;
  seasonLabel: string;
  episodes: TvEpisodeListItem[];
  selectedId?: string | null;
  loading?: boolean;
  checkingConverted?: boolean;
  multiSelect: boolean;
  selectedIds: Set<string>;
  presets: ConversionPreset[];
  selectedPreset: string;
  overwrite: boolean;
  queueBusy: boolean;
  agentOnline: boolean;
  onSelect: (episode: TvEpisodeListItem) => void;
  onToggleMultiSelect: () => void;
  onToggleEpisode: (episodeId: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onPresetChange: (preset: string) => void;
  onOverwriteChange: (overwrite: boolean) => void;
  onQueueSelected: () => void;
  onBack: () => void;
};

export function EpisodeList({
  seriesTitle,
  seasonLabel,
  episodes,
  selectedId,
  loading,
  checkingConverted,
  multiSelect,
  selectedIds,
  presets,
  selectedPreset,
  overwrite,
  queueBusy,
  agentOnline,
  onSelect,
  onToggleMultiSelect,
  onToggleEpisode,
  onSelectAll,
  onClearSelection,
  onPresetChange,
  onOverwriteChange,
  onQueueSelected,
  onBack,
}: EpisodeListProps) {
  const selectedCount = selectedIds.size;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          marginBottom: "0.75rem",
        }}
      >
        <h2 className={styles.sectionTitle} style={{ marginBottom: 0 }}>
          {seriesTitle}
          <span className={styles.historyMeta} style={{ display: "block" }}>
            {seasonLabel}
          </span>
        </h2>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonSecondary}`}
          onClick={onBack}
        >
          Back to seasons
        </button>
      </div>

      <div className={styles.toolbarRow}>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonSecondary}`}
          onClick={onToggleMultiSelect}
          disabled={queueBusy}
        >
          {multiSelect ? "Exit multi-select" : "Multi-select"}
        </button>
        {multiSelect && (
          <>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonSecondary}`}
              onClick={onSelectAll}
              disabled={queueBusy || episodes.length === 0}
            >
              Select all
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonSecondary}`}
              onClick={onClearSelection}
              disabled={queueBusy || selectedCount === 0}
            >
              Clear
            </button>
            <span className={styles.historyMeta}>
              {selectedCount} selected
            </span>
          </>
        )}
      </div>

      {loading ? (
        <p className={styles.empty}>Loading episodes…</p>
      ) : episodes.length === 0 ? (
        <p className={styles.empty}>No episodes in this season.</p>
      ) : (
        <>
          {checkingConverted ? (
            <p className={styles.historyMeta} style={{ marginBottom: "0.75rem" }}>
              Checking Jellyfin library for converted files…
            </p>
          ) : null}
          <div className={styles.historyList}>
          {episodes.map((episode) => {
            const checked = selectedIds.has(episode.id);
            const isActive = !multiSelect && selectedId === episode.id;

            if (multiSelect) {
              return (
                <label
                  key={episode.id}
                  id={tvEpisodeAnchorId(episode.id)}
                  className={`${styles.historyRow} ${checked ? styles.selectedRow : ""} ${episode.converted ? styles.convertedRow : ""}`}
                >
                  <span className={styles.episodeCheck}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={queueBusy}
                      onChange={() => onToggleEpisode(episode.id)}
                    />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className={styles.historyHeader}>
                        <span className={styles.historyTitle}>
                          {episode.converted && <ConvertedCheck />}
                          {episode.code} · {episode.title}
                        </span>
                        <span className={styles.statusBadge}>
                          {episode.format.toUpperCase()}
                        </span>
                      </span>
                      <p className={styles.historyMeta}>
                        {episode.videoFile} · {formatBytes(episode.sizeBytes)}
                      </p>
                    </span>
                  </span>
                </label>
              );
            }

            return (
              <button
                key={episode.id}
                id={tvEpisodeAnchorId(episode.id)}
                type="button"
                className={`${styles.historyRow} ${isActive ? styles.selectedRow : ""} ${episode.converted ? styles.convertedRow : ""}`}
                onClick={() => onSelect(episode)}
              >
                <div className={styles.historyHeader}>
                  <span className={styles.historyTitle}>
                    {episode.converted && <ConvertedCheck />}
                    {episode.code} · {episode.title}
                  </span>
                  <span className={styles.statusBadge}>
                    {episode.format.toUpperCase()}
                  </span>
                </div>
                <p className={styles.historyMeta}>
                  {episode.videoFile} · {formatBytes(episode.sizeBytes)}
                </p>
              </button>
            );
          })}
          </div>
        </>
      )}

      {multiSelect && (
        <div className={styles.queueBar}>
          <div className={styles.queueBarField}>
            <label className={styles.metaLabel} htmlFor="tv-batch-preset">
              Preset for queue
            </label>
            <select
              id="tv-batch-preset"
              className={styles.presetSelect}
              value={selectedPreset}
              disabled={queueBusy || presets.length === 0}
              onChange={(e) => onPresetChange(e.target.value)}
            >
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>
          <label className={styles.checkboxInline}>
            <input
              type="checkbox"
              checked={overwrite}
              disabled={queueBusy}
              onChange={(e) => onOverwriteChange(e.target.checked)}
            />
            Overwrite if output exists
          </label>
          <button
            type="button"
            className={styles.button}
            disabled={
              queueBusy ||
              !agentOnline ||
              selectedCount === 0 ||
              presets.length === 0
            }
            onClick={onQueueSelected}
          >
            {queueBusy
              ? "Queue running…"
              : `Queue ${selectedCount} episode${selectedCount === 1 ? "" : "s"}`}
          </button>
        </div>
      )}
    </div>
  );
}
