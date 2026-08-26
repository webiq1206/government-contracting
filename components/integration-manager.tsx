"use client";

/**
 * The Integrations manager. Every credential the platform uses can be viewed
 * (masked), added, replaced, tested, and removed right here, no config files,
 * no database access. "Test" runs a real API call before anything is saved.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  stateTone,
  INTEGRATION_STATE_LABEL,
  INTEGRATION_STATE_MEANING,
  type IntegrationState,
} from "@/lib/domain/integration-state";

interface FieldState {
  env: string;
  label: string;
  secret: boolean;
  placeholder?: string;
  source: "ui" | "env" | "none";
  masked: string | null;
  /**
   * True for credentials that belong to the APPLICATION, not the customer
   * (OAuth client id/secret). When the platform supplies these as deployment
   * secrets, no customer should ever see or create them.
   */
  developer?: boolean;
  last_validated_at?: string | null;
  last_error?: string | null;
}

interface IntegrationGuide {
  cost?: string;
  steps: string[];
  links: { label: string; url: string }[];
}

interface IntegrationRow {
  id: string;
  name: string;
  what: string;
  without: string;
  where: string;
  testable: boolean;
  configured: boolean;
  gmailConnected?: boolean;
  /** Decided on the server, so the card and the header cannot disagree. */
  state: IntegrationState;
  stateReason: string;
  stateAction: string | null;
  last_error: string | null;
  last_validated_at: string | null;
  fields: FieldState[];
  guide?: IntegrationGuide;
}

const BADGE_TONE: Record<"red" | "amber" | "green" | "slate", string> = {
  red: "bg-risk/15 text-risk",
  amber: "bg-review/15 text-review",
  green: "bg-pursue/15 text-pursue",
  slate: "bg-slate-200 text-slate-600",
};

export function IntegrationManager({ initial }: { initial: IntegrationRow[] }) {
  const router = useRouter();
  const [items, setItems] = useState<IntegrationRow[]>(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  useEffect(() => setItems(initial), [initial]);

  const draftsFor = (def: IntegrationRow) => {
    const out: Record<string, string> = {};
    for (const f of def.fields) {
      const v = drafts[f.env]?.trim();
      if (v) out[f.env] = v;
    }
    return out;
  };

  async function test(def: IntegrationRow) {
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

  async function save(def: IntegrationRow) {
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

  async function removeKey(def: IntegrationRow, env: string) {
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
        // A credential the platform supplies for everyone. When it is present
        // the customer has no developer app to register, so the sign-up
        // instructions and the input boxes are noise: hide both.
        const platformManaged = def.fields.some((f) => f.developer && f.source === "env");
        const visibleFields = def.fields.filter((f) => !(f.developer && f.source === "env"));
        // Connecting only needs the OAuth app credentials, whoever supplied
        // them. The send-as address is set separately and must not gate this.
        const oauthReady =
          def.fields.some((f) => f.developer) &&
          def.fields.filter((f) => f.developer).every((f) => f.source !== "none");
        return (
          <div key={def.id} className="card flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-foreground">{def.name}</p>
                <p className="mt-0.5 text-sm text-slate-600">{def.what}</p>
              </div>
              {/*
                * Six states, decided on the server. This used to be three --
                * error, connected, not set up -- and the middle one was a
                * claim the page could not support: it meant a key was saved,
                * and it said so through a day when the provider was refusing
                * every request for want of credit.
                */}
              <span
                className={`badge shrink-0 ${BADGE_TONE[stateTone(def.state)]}`}
                title={INTEGRATION_STATE_MEANING[def.state]}
              >
                {INTEGRATION_STATE_LABEL[def.state]}
              </span>
            </div>

            {/* Why it is in that state, and the one thing to do about it. */}
            <p className="text-xs text-slate-600">{def.stateReason}</p>
            {def.stateAction && (
              <p className="text-xs text-foreground">
                <span className="font-medium">Next: </span>
                {def.stateAction}
              </p>
            )}
            {def.state !== "healthy" && def.without && (
              <p className="text-xs text-review">Right now: {def.without}</p>
            )}
            {/* Not always a failed test any more: this also carries a service
                that refused real work, where "Last check failed" would have
                read as a stale test result rather than as live breakage. */}
            {def.last_error && <p className="text-xs text-risk">Not working: {def.last_error}</p>}
            {def.last_validated_at && !def.last_error && (
              <p className="text-xs text-slate-500">
                Last verified {new Date(def.last_validated_at).toLocaleString()}
              </p>
            )}

            {def.guide && !platformManaged && (
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

            {platformManaged && (
              <p className="flex items-center gap-2 text-xs text-pursue">
                <span aria-hidden>✓</span>
                <span>Connection set up for you. Just sign in below.</span>
              </p>
            )}

            {visibleFields.map((f) =>
              // Platform-managed credential: the operator of this platform set
              // it once as a deployment secret, so every customer inherits it
              // and must never be asked to create their own developer app.
              // Show it as handled and render no input at all.
              f.source === "env" && f.developer ? (
                <div key={f.env} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span aria-hidden className="text-pursue">
                    ✓
                  </span>
                  <span>{f.label}: set up for you, nothing to enter.</span>
                </div>
              ) : (
              <div key={f.env}>
                <div className="flex items-center justify-between">
                  <label className="label">{f.label}</label>
                  {f.source !== "none" && (
                    <span className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="num">{f.masked}</span>
                      <span className="badge bg-muted text-muted-foreground">
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
                  // The visible <label> above is a plain element, not tied to
                  // this input, so a screen reader announced "password field"
                  // and nothing else. Naming the credential matters more here
                  // than most places: pasting a SAM key into the Anthropic
                  // field is a silent, confusing failure.
                  aria-label={f.label}
                  placeholder={
                    f.source === "none"
                      ? (f.placeholder ?? `Paste your ${f.label.toLowerCase()}`)
                      : "Paste a new value to replace the current one"
                  }
                  value={drafts[f.env] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [f.env]: e.target.value }))}
                />
              </div>
              )
            )}

            {def.id === "gmail" &&
              (oauthReady ? (
                <a href="/api/integrations/gmail/connect" className="btn-ghost w-fit text-xs">
                  {def.gmailConnected ? "Reconnect Gmail" : "Connect Gmail →"}
                </a>
              ) : (
                // Connecting before the client ID/secret are SAVED sends the
                // operator to a raw JSON error on a blank page. Pasting into
                // the boxes is not saving, so say so plainly and keep the
                // button inert until there is something to connect with.
                <div className="w-fit">
                  <button
                    type="button"
                    disabled
                    className="btn-ghost w-fit cursor-not-allowed text-xs opacity-50"
                    title="Save your client ID and secret first"
                  >
                    Connect Gmail →
                  </button>
                  <p className="mt-1 text-xs text-slate-500">
                    Paste the client ID and secret above, press{" "}
                    <span className="font-medium">Save</span>, then this button turns on.
                  </p>
                </div>
              ))}

            {result && (
              <p className={`text-sm ${result.ok ? "text-pursue" : "text-risk"}`}>
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
                {visibleFields.length > 0 && (
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
