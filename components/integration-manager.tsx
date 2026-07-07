"use client";

/**
 * The Integrations manager. Every credential the platform uses can be viewed
 * (masked), added, replaced, tested, and removed right here, no config files,
 * no database access. "Test" runs a real API call before anything is saved.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface FieldState {
  env: string;
  label: string;
  secret: boolean;
  placeholder?: string;
  source: "ui" | "env" | "none";
  masked: string | null;
  last_validated_at?: string | null;
  last_error?: string | null;
}

interface IntegrationGuide {
  cost?: string;
  steps: string[];
  links: { label: string; url: string }[];
}

interface IntegrationState {
  id: string;
  name: string;
  what: string;
  without: string;
  where: string;
  testable: boolean;
  configured: boolean;
  gmailConnected?: boolean;
  last_error: string | null;
  last_validated_at: string | null;
  fields: FieldState[];
  guide?: IntegrationGuide;
}

export function IntegrationManager({ initial }: { initial: IntegrationState[] }) {
  const router = useRouter();
  const [items, setItems] = useState<IntegrationState[]>(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  useEffect(() => setItems(initial), [initial]);

  const draftsFor = (def: IntegrationState) => {
    const out: Record<string, string> = {};
    for (const f of def.fields) {
      const v = drafts[f.env]?.trim();
      if (v) out[f.env] = v;
    }
    return out;
  };

  async function test(def: IntegrationState) {
    setBusy(`test:${def.id}`);
    setResults((r) => ({ ...r, [def.id]: { ok: true, message: "Testing…" } }));
    try {
      const res = await fetch("/api/integrations/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integration: def.id, values: draftsFor(def) }),
      });
      const data = await res.json();
      setResults((r) => ({
        ...r,
        [def.id]: res.ok ? data : { ok: false, message: data.error ?? "Test failed." },
      }));
    } catch (e) {
      setResults((r) => ({ ...r, [def.id]: { ok: false, message: (e as Error).message } }));
    } finally {
      setBusy(null);
    }
  }

  async function save(def: IntegrationState) {
    const values = draftsFor(def);
    if (Object.keys(values).length === 0) {
      setResults((r) => ({
        ...r,
        [def.id]: { ok: false, message: "Type a new value first, then press Save." },
      }));
      return;
    }
    setBusy(`save:${def.id}`);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResults((r) => ({ ...r, [def.id]: { ok: false, message: data.error ?? "Save failed." } }));
        return;
      }
      setItems(data.integrations);
      setDrafts((d) => {
        const next = { ...d };
        for (const k of Object.keys(values)) delete next[k];
        return next;
      });
      setResults((r) => ({
        ...r,
        [def.id]: { ok: true, message: "Saved. The platform is using the new value now." },
      }));
      router.refresh();
      // Immediately verify what was saved so status reflects reality.
      if (def.testable) void test({ ...def, fields: def.fields });
    } catch (e) {
      setResults((r) => ({ ...r, [def.id]: { ok: false, message: (e as Error).message } }));
    } finally {
      setBusy(null);
    }
  }

  async function removeKey(def: IntegrationState, env: string) {
    if (!window.confirm(`Remove the saved ${def.name} value? The platform falls back to the environment variable if one is set, otherwise the integration turns off.`))
      return;
    setBusy(`remove:${def.id}`);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remove: [env] }),
      });
      const data = await res.json();
      if (res.ok) {
        setItems(data.integrations);
        setResults((r) => ({ ...r, [def.id]: { ok: true, message: "Removed." } }));
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {items.map((def) => {
        const result = results[def.id];
        return (
          <div key={def.id} className="card flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-foreground">{def.name}</p>
                <p className="mt-0.5 text-sm text-slate-600">{def.what}</p>
              </div>
              <span
                className={`badge shrink-0 ${
                  def.last_error
                    ? "bg-risk/15 text-risk"
                    : def.configured
                      ? "bg-pursue/15 text-pursue"
                      : "bg-slate-200 text-slate-600"
                }`}
              >
                {def.last_error ? "Error" : def.configured ? "Connected" : "Not set up"}
              </span>
            </div>

            {!def.configured && def.without && (
              <p className="text-xs text-review">Right now: {def.without}</p>
            )}
            {def.last_error && (
              <p className="text-xs text-risk">Last check failed: {def.last_error}</p>
            )}
            {def.last_validated_at && !def.last_error && (
              <p className="text-xs text-slate-500">
                Last verified {new Date(def.last_validated_at).toLocaleString()}
              </p>
            )}

            {def.guide && (
              <details className="group rounded-md border border-accent/30 bg-accent-soft/60 open:pb-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-accent-strong [&::-webkit-details-marker]:hidden">
                  <span>How do I get this?</span>
                  <span
                    aria-hidden
                    className="text-xs text-accent transition-transform group-open:rotate-180"
                  >
                    ▾
                  </span>
                </summary>
                <div className="space-y-3 px-3">
                  {def.guide.cost && (
                    <p className="text-xs font-medium text-accent-strong">{def.guide.cost}</p>
                  )}
                  <ol className="list-decimal space-y-1.5 pl-4 text-sm text-slate-700">
                    {def.guide.steps.map((s, i) => (
                      <li key={i} className="leading-relaxed">
                        {s}
                      </li>
                    ))}
                  </ol>
                  <div className="flex flex-wrap gap-2">
                    {def.guide.links.map((l) => (
                      <a
                        key={l.url}
                        href={l.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="btn-ghost text-xs"
                      >
                        {l.label} ↗
                      </a>
                    ))}
                  </div>
                </div>
              </details>
            )}

            {def.fields.map((f) => (
              <div key={f.env}>
                <div className="flex items-center justify-between">
                  <label className="label">{f.label}</label>
                  {f.source !== "none" && (
                    <span className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="num">{f.masked}</span>
                      <span className="badge bg-slate-100 text-slate-500">
                        {f.source === "ui" ? "saved here" : "from environment"}
                      </span>
                      {f.source === "ui" && (
                        <button
                          className="text-risk hover:underline"
                          onClick={() => removeKey(def, f.env)}
                          disabled={busy != null}
                        >
                          Remove
                        </button>
                      )}
                    </span>
                  )}
                </div>
                <input
                  className="input mt-1"
                  type={f.secret ? "password" : "text"}
                  autoComplete="off"
                  placeholder={
                    f.source === "none"
                      ? (f.placeholder ?? `Paste your ${f.label.toLowerCase()}`)
                      : "Paste a new value to replace the current one"
                  }
                  value={drafts[f.env] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [f.env]: e.target.value }))}
                />
              </div>
            ))}

            {def.id === "gmail" && (
              <a
                href="/api/integrations/gmail/connect"
                className={`btn-ghost w-fit text-xs ${def.gmailConnected ? "" : ""}`}
              >
                {def.gmailConnected ? "Reconnect Gmail" : "Connect Gmail →"}
              </a>
            )}

            {result && (
              <p className={`text-sm ${result.ok ? "text-accent" : "text-risk"}`}>
                {result.message}
              </p>
            )}

            <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
              <p className="text-xs text-slate-500">{def.where}</p>
              <div className="flex shrink-0 gap-2">
                {def.testable && (
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => test(def)}
                    disabled={busy != null}
                  >
                    {busy === `test:${def.id}` ? "Testing…" : "Test connection"}
                  </button>
                )}
                {def.fields.length > 0 && (
                  <button
                    className="btn-primary text-xs"
                    onClick={() => save(def)}
                    disabled={busy != null}
                  >
                    {busy === `save:${def.id}` ? "Saving…" : "Save"}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
