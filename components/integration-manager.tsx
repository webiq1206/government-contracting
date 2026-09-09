"use client";

/**
 * The Integrations manager. Every credential the platform uses can be viewed
 * (masked), added, replaced, tested, and removed right here, no config files,
 * no database access. Testing is explicit because provider checks may cost credits.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { actionError } from "@/lib/client/action-request";
import { integrationRequest, connectionFailure } from "@/lib/client/integration-request";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  integrationState,
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
  source: "ui" | "env" | "platform" | "none";
  masked: string | null;
  /**
   * True for credentials that belong to the APPLICATION, not the customer
   * (OAuth client id/secret). When the platform supplies these as deployment
   * secrets, no customer should ever see or create them.
   */
  developer?: boolean;
  last_validated_at?: string | null;
  last_error?: string | null;
  last_success_at?: string | null;
  last_tested_at?: string | null;
  quota_note?: string | null;
  expires_at?: string | null;
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
  /** When a real call to the provider last worked. */
  last_success_at: string | null;
  /** When somebody last pressed Test. A different question, so a different line. */
  last_tested_at: string | null;
  /** What the provider says about quota or credit, in their words. */
  quota_note: string | null;
  /** When the credential lapses, where the provider tells us. */
  expires_at: string | null;
  fields: FieldState[];
  guide?: IntegrationGuide;
}

const BADGE_TONE: Record<"red" | "amber" | "green" | "slate", string> = {
  red: "bg-risk/15 text-risk",
  amber: "bg-review/15 text-review",
  green: "bg-pursue/15 text-pursue",
  slate: "bg-slate-200 text-slate-600",
};

type ClientFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type RemoveKeyResult =
  | { ok: true; integrations: IntegrationRow[] }
  | { ok: false; message: string };

/**
 * A removal is applied to local state only after the API explicitly confirms
 * it and returns the replacement list. An interrupted response is ambiguous:
 * the server may have received it, so the safe next step is to refresh before
 * repeating the destructive action.
 */
export async function removeIntegrationKeyRequest(
  env: string,
  request: ClientFetch = fetch
): Promise<RemoveKeyResult> {
  let response: Response;
  let data: unknown;
  try {
    const result = await integrationRequest("/api/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remove: [env] }),
    }, request);
    response = result.response;
    data = result.data;
  } catch {
    return {
      ok: false,
      message:
        "The removal could not be confirmed because the response was interrupted or could not be read. The current value remains shown; refresh this page before trying again.",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      message: `${actionError(response.status)} The current value remains shown; refresh this page before trying again.`,
    };
  }

  if (
    !data ||
    typeof data !== "object" ||
    (data as { ok?: unknown }).ok !== true ||
    !Array.isArray((data as { integrations?: unknown }).integrations)
  ) {
    return {
      ok: false,
      message:
        "The server did not return updated integration status, so the removal could not be confirmed. The current value remains shown; refresh this page before trying again.",
    };
  }

  return {
    ok: true,
    integrations: (data as { integrations: IntegrationRow[] }).integrations,
  };
}

export function IntegrationManager({ initial }: { initial: IntegrationRow[] }) {
  const router = useRouter();
  const [items, setItems] = useState<IntegrationRow[]>(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const inFlight = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [removing, setRemoving] = useState<{ def: IntegrationRow; env: string } | null>(null);

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
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(`test:${def.id}`);
    setResults((r) => ({ ...r, [def.id]: { ok: true, message: "Checking the connection…" } }));
    try {
      const { response, data } = await integrationRequest("/api/integrations/test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integration: def.id, values: draftsFor(def) }),
      });
      const ok = response.ok && data?.ok === true;
      setResults((r) => ({ ...r, [def.id]: {
        ok,
        message: ok ? "The connection check passed. Unsaved changes still need to be saved."
          : !response.ok ? actionError(response.status) : connectionFailure(data?.message),
      } }));
      if (response.ok) router.refresh();
    } catch {
      setResults((r) => ({ ...r, [def.id]: { ok: false, message: "The connection check could not finish. Work using this service is still unverified. Wait a moment, then choose Test connection again." } }));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  // Mutation responses include all integrations, while each tab contains only
  // its own cards. Keep that scope and rebuild status from returned facts.
  function applyUpdatedRows(updated: IntegrationRow[]) {
    setItems(current => current.map(row => {
      const next = updated.find(item => item.id === row.id);
      if (!next) return row;
      const verdict = integrationState({ configured: next.configured, lastError: next.last_error,
        lastValidatedAt: next.last_tested_at ?? next.last_validated_at,
        lastSuccessAt: next.last_success_at,
        connectionLive: next.id === "gmail" ? next.gmailConnected : undefined });
      return { ...row, ...next, state: verdict.state, stateReason: verdict.reason, stateAction: verdict.nextAction };
    }));
  }

  async function save(def: IntegrationRow) {
    if (inFlight.current) return;
    const values = draftsFor(def);
    if (Object.keys(values).length === 0) {
      setResults((r) => ({
        ...r,
        [def.id]: { ok: false, message: "Type a new value first, then press Save." },
      }));
      return;
    }
    inFlight.current = true;
    setBusy(`save:${def.id}`);
    try {
      const { response: res, data } = await integrationRequest("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      if (!res.ok || data?.ok !== true || !Array.isArray(data.integrations)) {
        setResults((r) => ({ ...r, [def.id]: { ok: false, message: actionError(res.status) } }));
        return;
      }
      applyUpdatedRows(data.integrations as IntegrationRow[]);
      setDrafts((d) => {
        const next = { ...d };
        for (const k of Object.keys(values)) if (next[k]?.trim() === values[k]) delete next[k];
        return next;
      });
      setResults((r) => ({
        ...r,
        [def.id]: { ok: true, message: def.testable ? "Saved. Choose Test connection to check whether the service accepts these details." : "Saved. Complete any remaining connection setup below." },
      }));
      router.refresh();
      // A provider test may cost credits. Saving never starts one implicitly.
    } catch {
      setResults((r) => ({ ...r, [def.id]: { ok: false, message: "The save could not be confirmed. Your entries are still here. Refresh status to check what was saved before trying again." } }));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  async function removeKey(def: IntegrationRow, env: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setRemoving(null);
    setBusy(`remove:${def.id}`);
    try {
      const result = await removeIntegrationKeyRequest(env);
      if (!result.ok) {
        setResults((r) => ({
          ...r,
          [def.id]: { ok: false, message: result.message },
        }));
        return;
      }
      applyUpdatedRows(result.integrations);
      setResults((r) => ({ ...r, [def.id]: { ok: true, message: "Removed." } }));
      router.refresh();
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  return (
    <>
      <ConfirmDialog
        open={removing != null}
        title={removing ? `Remove the saved ${removing.def.name} value?` : ""}
        body="The platform falls back to the environment variable if one is set, and otherwise the integration turns off."
        confirmLabel="Remove it"
        danger
        busy={busy != null}
        onConfirm={() => removing && void removeKey(removing.def, removing.env)}
        onCancel={() => setRemoving(null)}
      />
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
          <div key={def.id} id={def.id} className="card scroll-mt-4 flex flex-col gap-3">
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
            {def.state === "not_configured" && def.without && (
              <p className="text-xs text-review">Without this: {def.without}</p>
            )}
            {/* Not always a failed test any more: this also carries a service
                that refused real work, where "Last check failed" would have
                read as a stale test result rather than as live breakage. */}
            {def.last_error && <p className="text-xs text-risk">{connectionFailure(def.last_error)}</p>}
            {/*
              Two facts, not one. The page used to print a single "last
              verified" written only by the Test button, while telling the
              operator it showed when the service was last used successfully.
              An integration doing real work hourly read as verified six weeks
              ago, and one tested this morning that had refused every call
              since read as verified today.
            */}
            {(def.last_success_at || def.last_tested_at) && (
              <p className="text-xs text-slate-500">
                {def.last_success_at && (
                  <>Last did real work {new Date(def.last_success_at).toLocaleString()}</>
                )}
                {def.last_success_at && def.last_tested_at && " · "}
                {def.last_tested_at && (
                  <>Last tested {new Date(def.last_tested_at).toLocaleString()}</>
                )}
              </p>
            )}
            {def.state === "configured" && !def.last_success_at && !def.last_tested_at && (
              <p className="text-xs text-slate-500">
                Saved, and not used or tested yet.
              </p>
            )}
            {def.quota_note && (
              <p className="text-xs text-review">{connectionFailure(def.quota_note)}</p>
            )}
            {def.expires_at && (
              <p className="text-xs text-review">
                Expires {new Date(def.expires_at).toLocaleDateString()}
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {/* Tied to the field. A secret typed into a box a screen
                      reader announces as blank is the worst place to leave
                      this undone. */}
                  <label className="label" htmlFor={`integration-${f.env}`}>
                    {f.label}
                  </label>
                  {f.source !== "none" && (
                    <span className="flex min-w-0 flex-wrap items-center justify-end gap-2 text-xs text-slate-500">
                      <span className="num break-all">{f.masked}</span>
                      <span className="badge bg-muted text-muted-foreground">
                        {f.source === "ui" ? "saved here" : f.source === "platform" ? "Platform API: usage added to your bill" : "from environment"}
                      </span>
                      {f.source === "ui" && (
                        <button
                          type="button"
                          className="inline-flex coarse:min-h-11 items-center text-risk hover:underline"
                          onClick={() => setRemoving({ def, env: f.env })}
                          disabled={busy != null}
                        >
                          Remove
                        </button>
                      )}
                    </span>
                  )}
                </div>
                <input
                  id={`integration-${f.env}`}
                  className="input mt-1"
                  type={f.secret ? "password" : "text"}
                  autoComplete="off"
                  // Named by the visible label above rather than by an
                  // aria-label duplicating it. The aria-label was added when
                  // that label was tied to nothing and a screen reader
                  // announced "password field" and no more; now the label
                  // itself carries the name, and clicking it focuses the
                  // field, which an aria-label never did.
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
              <p
                role={result.ok ? "status" : "alert"}
                className={`text-sm ${result.ok ? "text-pursue" : "text-risk"}`}
              >
                {result.message}
                {!result.ok && <button type="button" className="btn-ghost ml-2 text-xs" disabled={busy != null}
                  onClick={() => router.refresh()}>Refresh status</button>}
              </p>
            )}

            <div className="mt-auto flex flex-col items-stretch gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-500">{def.where}</p>
              <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end">
                {def.testable && (
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={() => test(def)}
                    disabled={busy != null}
                  >
                    {busy === `test:${def.id}` ? "Testing…" : "Test connection"}
                  </button>
                )}
                {visibleFields.length > 0 && (
                  <button
                    type="button"
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
    </>
  );
}
