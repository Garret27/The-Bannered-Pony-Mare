"use client";

import { useCallback, useEffect, useState } from "react";
import type { MovieNightSettings, SettingsSection } from "@/lib/settings-types";
import { SECRET_MASK } from "@/lib/settings-types";
import { Toast } from "./Toast";
import styles from "./SettingsPage.module.css";

type SettingsResponse = {
  settings: MovieNightSettings;
  configured: Record<SettingsSection, boolean>;
};

type AgentStateResponse = {
  reachable?: boolean;
  enabled?: boolean;
  ok?: boolean;
  nvencAvailable?: boolean;
  disabledReason?: string | null;
  error?: string;
  fedoraSshOk?: boolean;
  fedoraSshDetail?: string;
  workRoot?: string;
  workRootWritable?: boolean;
  remoteBridgeConfigured?: boolean;
  remoteBridgeDetail?: string;
};

type StatusKind = "online" | "disabled" | "offline" | "gpu";

type ToastState = {
  message: string;
  type: "success" | "error";
} | null;

const SECTION_META: Array<{
  id: SettingsSection;
  title: string;
  description: string;
}> = [
  { id: "tmdb", title: "TMDB", description: "Poster search and movie metadata" },
  {
    id: "vrchat",
    title: "VRChat",
    description: "Invites, friends, and Movie Picture photos",
  },
  {
    id: "smb",
    title: "SMB / Samba",
    description: "Credentials for E/J/H drive mounts (requires Docker restart)",
  },
  {
    id: "movies",
    title: "Movies & Jellyfin",
    description: "Library catalog and E/J/H path mapping",
  },
  {
    id: "opensubtitles",
    title: "OpenSubtitles",
    description: "Subtitle search and downloads",
  },
  { id: "bunny", title: "Bunny CDN", description: "Storage zone and CDN uploads" },
  {
    id: "converter",
    title: "Converter",
    description: "HandBrake agent URL and encoder defaults",
  },
  {
    id: "discord",
    title: "Discord",
    description: "Announcement webhooks and schedule",
  },
  {
    id: "github",
    title: "GitHub publish",
    description: "Auto-push posters and subtitles to the public repo",
  },
];

const SECRET_FIELDS: Record<string, string[]> = {
  tmdb: ["apiKey"],
  vrchat: ["authCookie"],
  smb: ["pass"],
  movies: ["jellyfinApiKey"],
  opensubtitles: ["apiKey", "password"],
  bunny: ["storagePassword"],
  discord: ["webhookMain", "webhookHspc"],
  github: ["token"],
};

function deriveAgentStatus(data: AgentStateResponse | null): StatusKind {
  if (!data?.reachable) return "offline";
  if (!data.enabled) return "disabled";
  if (data.ok) return "online";
  if (data.nvencAvailable === false) return "gpu";
  return "offline";
}

function agentStatusLabel(kind: StatusKind): string {
  switch (kind) {
    case "online":
      return "Online";
    case "disabled":
      return "Disabled";
    case "gpu":
      return "GPU unavailable";
    default:
      return "Offline";
  }
}

function PasswordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const isMasked = value === SECRET_MASK;

  return (
    <label>
      {label}
      <div className={styles.passwordRow}>
        <input
          type={visible && !isMasked ? "text" : "password"}
          value={isMasked ? "" : value}
          placeholder={isMasked ? "Saved — paste a new key to replace" : undefined}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => {
            // Don't leave SECRET_MASK in the controlled value on edit — saving
            // the mask keeps the old secret and looks like a successful update.
            if (isMasked) {
              onChange("");
              setVisible(true);
            }
          }}
          autoComplete="off"
        />
        <button
          type="button"
          className={styles.toggleSecret}
          onClick={() => {
            if (isMasked) {
              onChange("");
              setVisible(true);
              return;
            }
            setVisible((current) => !current);
          }}
        >
          {isMasked ? "Replace" : visible ? "Hide" : "Show"}
        </button>
      </div>
    </label>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState<MovieNightSettings | null>(null);
  const [configured, setConfigured] = useState<Record<
    SettingsSection,
    boolean
  > | null>(null);
  const [openSections, setOpenSections] = useState<Set<SettingsSection>>(
    () => new Set(["converter"]),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [requiresRestart, setRequiresRestart] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [agentState, setAgentState] = useState<AgentStateResponse | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const loadSettings = useCallback(async () => {
    const response = await fetch("/api/settings");
    if (!response.ok) {
      throw new Error("Failed to load settings");
    }
    const data = (await response.json()) as SettingsResponse;
    setSettings(data.settings);
    setConfigured(data.configured);
  }, []);

  const loadAgentState = useCallback(async () => {
    try {
      const response = await fetch("/api/agent/state");
      const data = (await response.json()) as AgentStateResponse;
      setAgentState({ ...data, reachable: response.ok || data.reachable === true });
    } catch {
      setAgentState({ reachable: false, ok: false, enabled: false });
    }
  }, []);

  useEffect(() => {
    loadSettings()
      .catch(() => showToast("Failed to load settings", "error"))
      .finally(() => setLoading(false));
    void loadAgentState();
    const interval = window.setInterval(() => void loadAgentState(), 15_000);
    return () => window.clearInterval(interval);
  }, [loadSettings, loadAgentState, showToast]);

  const toggleSection = (section: SettingsSection) => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const setField = (section: SettingsSection, field: string, value: string) => {
    setSettings((current) => {
      if (!current) return current;
      const group = current[section] as Record<string, string>;
      return {
        ...current,
        [section]: {
          ...group,
          [field]: value,
        },
      };
    });
  };

  const saveSettings = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const data = (await response.json()) as SettingsResponse & {
        error?: string;
        requiresRestart?: boolean;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to save settings");
      }
      setSettings(data.settings);
      setConfigured(data.configured);
      setRequiresRestart(Boolean(data.requiresRestart));
      showToast(data.message ?? "Settings saved", "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to save settings",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const runAgentAction = async (action: "enable" | "disable" | "reset") => {
    if (action === "reset") {
      const confirmed = window.confirm(
        "Reset the converter agent? This cancels any active job and clears session history.",
      );
      if (!confirmed) return;
    }

    setAgentLoading(true);
    try {
      const response = await fetch("/api/agent/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json()) as AgentStateResponse;
      if (!response.ok) {
        throw new Error(data.error ?? "Agent control failed");
      }
      setAgentState({ ...data, reachable: true });
      showToast(`Agent ${action} succeeded`, "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Agent control failed",
        "error",
      );
      await loadAgentState();
    } finally {
      setAgentLoading(false);
    }
  };

  if (loading || !settings || !configured) {
    return <p className={styles.loading}>Loading settings…</p>;
  }

  const agentStatus = deriveAgentStatus(agentState);
  const agentStatusText = agentStatusLabel(agentStatus);

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <h1>Settings</h1>
        <p>
          Configuration is stored in{" "}
          <code>movie-night-settings.json</code> at the project data root. SMB
          credentials are also synced to <code>web/.env</code> for Docker volume
          mounts.
        </p>
      </header>

      {requiresRestart && (
        <div className={styles.banner}>
          Some changes require a Docker restart. Run{" "}
          <code>docker compose up -d</code> from the <code>web/</code> folder.
        </div>
      )}

      <div className={styles.form}>
        <section className={styles.section}>
          <button
            type="button"
            className={styles.sectionHeader}
            onClick={() => toggleSection("converter")}
            aria-expanded={openSections.has("converter")}
          >
            <span>
              <span className={styles.sectionTitle}>Converter agent</span>
              <span className={styles.sectionDesc}>
                Live status and enable/disable controls
              </span>
            </span>
            <span className={`${styles.badge} ${styles.badgeOk}`}>
              {agentStatusText}
            </span>
            <span className={styles.chevron}>
              {openSections.has("converter") ? "▾" : "▸"}
            </span>
          </button>

          {openSections.has("converter") && (
            <div className={styles.sectionBody}>
              <div className={styles.agentStatus}>
                <span
                  className={`${styles.statusDot} ${styles[`status_${agentStatus}`]}`}
                  aria-hidden="true"
                />
                <span>{agentStatusText}</span>
              </div>

              {agentState?.disabledReason && !agentState.ok && (
                <p className={styles.agentDetail}>{agentState.disabledReason}</p>
              )}
              {agentState?.reachable && (
                <p className={styles.agentDetail}>
                  Fedora SSH:{" "}
                  {agentState.fedoraSshOk
                    ? agentState.fedoraSshDetail || "ok"
                    : agentState.fedoraSshDetail || "unreachable"}
                  {" · "}
                  Work: {agentState.workRoot || "/work"}
                  {agentState.workRootWritable === false ? " (not writable)" : ""}
                </p>
              )}
              {!agentState?.reachable && (
                <p className={styles.agentDetail}>
                  Agent container unreachable. Check Docker logs for
                  converter-agent.
                </p>
              )}

              <div className={styles.agentActions}>
                <button
                  type="button"
                  className={styles.agentButton}
                  disabled={agentLoading || agentState?.enabled === true}
                  onClick={() => void runAgentAction("enable")}
                >
                  Turn on
                </button>
                <button
                  type="button"
                  className={styles.agentButton}
                  disabled={agentLoading || agentState?.enabled === false}
                  onClick={() => void runAgentAction("disable")}
                >
                  Turn off
                </button>
                <button
                  type="button"
                  className={`${styles.agentButton} ${styles.agentDanger}`}
                  disabled={agentLoading}
                  onClick={() => void runAgentAction("reset")}
                >
                  Reset
                </button>
              </div>

              <label>
                Agent URL
                <input
                  type="url"
                  value={settings.converter.agentUrl}
                  onChange={(event) =>
                    setField("converter", "agentUrl", event.target.value)
                  }
                />
              </label>
              <label>
                HandBrake encoder
                <select
                  value={settings.converter.handbrakeEncoder}
                  onChange={(event) =>
                    setField("converter", "handbrakeEncoder", event.target.value)
                  }
                >
                  <option value="nvenc_h264">nvenc_h264 (GPU)</option>
                  <option value="nvenc_h265">nvenc_h265 (GPU HEVC)</option>
                  <option value="x264">x264 (CPU fallback)</option>
                </select>
              </label>
              <label>
                Jellyfin output label
                <input
                  type="text"
                  value={settings.converter.jellyfinOutputLabel}
                  onChange={(event) =>
                    setField(
                      "converter",
                      "jellyfinOutputLabel",
                      event.target.value,
                    )
                  }
                />
              </label>
              <label>
                TV Jellyfin output label
                <input
                  type="text"
                  value={settings.converter.tvJellyfinOutputLabel}
                  onChange={(event) =>
                    setField(
                      "converter",
                      "tvJellyfinOutputLabel",
                      event.target.value,
                    )
                  }
                />
              </label>
            </div>
          )}
        </section>

        {SECTION_META.filter((section) => section.id !== "converter").map(
          (section) => {
            const isOpen = openSections.has(section.id);
            const sectionData = settings[section.id] as Record<string, string>;
            const secretFields = SECRET_FIELDS[section.id] ?? [];

            return (
              <section key={section.id} className={styles.section}>
                <button
                  type="button"
                  className={styles.sectionHeader}
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={isOpen}
                >
                  <span>
                    <span className={styles.sectionTitle}>{section.title}</span>
                    <span className={styles.sectionDesc}>
                      {section.description}
                    </span>
                  </span>
                  <span
                    className={`${styles.badge} ${
                      configured[section.id] ? styles.badgeOk : styles.badgeMissing
                    }`}
                  >
                    {configured[section.id] ? "Configured" : "Not set"}
                  </span>
                  <span className={styles.chevron}>{isOpen ? "▾" : "▸"}</span>
                </button>

                {isOpen && (
                  <div className={styles.sectionBody}>
                    {Object.entries(sectionData).map(([field, value]) => {
                      const label = field
                        .replace(/([A-Z])/g, " $1")
                        .replace(/^./, (char) => char.toUpperCase());

                      if (secretFields.includes(field)) {
                        return (
                          <PasswordField
                            key={field}
                            label={label}
                            value={value}
                            onChange={(next) => setField(section.id, field, next)}
                          />
                        );
                      }

                      if (
                        field === "announceTimeMain" ||
                        field === "announceTimeHspc"
                      ) {
                        return (
                          <label key={field}>
                            {label}
                            <input
                              type="time"
                              value={value}
                              onChange={(event) =>
                                setField(section.id, field, event.target.value)
                              }
                            />
                          </label>
                        );
                      }

                      return (
                        <label key={field}>
                          {label}
                          <input
                            type="text"
                            value={value}
                            onChange={(event) =>
                              setField(section.id, field, event.target.value)
                            }
                          />
                        </label>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          },
        )}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.saveButton}
            disabled={saving}
            onClick={() => void saveSettings()}
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </div>

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
