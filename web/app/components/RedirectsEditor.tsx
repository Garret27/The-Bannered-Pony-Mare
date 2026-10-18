"use client";

import { useEffect, useState } from "react";
import type { RedirectsConfig } from "@/lib/redirects";
import styles from "./RedirectsEditor.module.css";

type RedirectsEditorProps = {
  redirects: RedirectsConfig;
  onSave: (config: RedirectsConfig) => Promise<void>;
  saving: boolean;
};

export function RedirectsEditor({
  redirects,
  onSave,
  saving,
}: RedirectsEditorProps) {
  const [mainUrl, setMainUrl] = useState(redirects.main.url);
  const [mainStatus, setMainStatus] = useState(redirects.main.status);
  const [hspcUrl, setHspcUrl] = useState(redirects.hspc.url);
  const [hspcStatus, setHspcStatus] = useState(redirects.hspc.status);

  useEffect(() => {
    setMainUrl(redirects.main.url);
    setMainStatus(redirects.main.status);
    setHspcUrl(redirects.hspc.url);
    setHspcStatus(redirects.hspc.status);
  }, [redirects]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void onSave({
      main: { path: "/main", url: mainUrl.trim(), status: mainStatus },
      hspc: { path: "/hspc", url: hspcUrl.trim(), status: hspcStatus },
    });
  };

  return (
    <section className={styles.panel}>
      <header>
        <h2>Redirects</h2>
        <p>Edits <code>_redirects</code> at the project root (Netlify format).</p>
      </header>

      <form onSubmit={handleSubmit} className={styles.form}>
        <fieldset>
          <legend>/main</legend>
          <label>
            URL
            <input
              type="url"
              value={mainUrl}
              onChange={(e) => setMainUrl(e.target.value)}
              placeholder="https://example.com/movie.mp4"
              required
            />
          </label>
          <label>
            Status
            <select
              value={mainStatus}
              onChange={(e) => setMainStatus(Number(e.target.value))}
            >
              <option value={200}>200 — Proxy</option>
              <option value={301}>301 — Permanent redirect</option>
              <option value={302}>302 — Temporary redirect</option>
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>/hspc</legend>
          <label>
            URL
            <input
              type="url"
              value={hspcUrl}
              onChange={(e) => setHspcUrl(e.target.value)}
              placeholder="https://example.com/movie.mp4"
              required
            />
          </label>
          <label>
            Status
            <select
              value={hspcStatus}
              onChange={(e) => setHspcStatus(Number(e.target.value))}
            >
              <option value={200}>200 — Proxy</option>
              <option value={301}>301 — Permanent redirect</option>
              <option value={302}>302 — Temporary redirect</option>
            </select>
          </label>
        </fieldset>

        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save redirects"}
        </button>
      </form>
    </section>
  );
}
