"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface PlanRow {
  table: string;
  moving: number;
  colliding: number;
}

interface Plan {
  survivorName: string;
  mergedName: string;
  rows: PlanRow[];
  totalMoving: number;
  totalColliding: number;
  reversible: boolean;
  irreversibleReason: string | null;
  conflicts: { field: string; survivor: string | null; merged: string | null }[];
}

/** What each table holds, said the way an operator would say it. */
const TABLE_LABEL: Record<string, string> = {
  communications: "emails, calls and notes",
  quotes: "quotes",
  opportunity_subs: "bid pairings",
  call_cards: "call cards",
  subcontractor_documents: "documents",
  subcontractor_payments: "payments",
  subcontractor_performance_events: "performance records",
  subcontractor_reply_events: "reply records",
  outreach_suppressions: "outreach stops",
  reply_drafts: "reply drafts",
  unmatched_inbound: "unmatched inbound mail",
  agent_logs: "activity log lines",
  contracts: "contracts",
  trade_pricing_rows: "pricing rows",
};

function label(table: string): string {
  return TABLE_LABEL[table] ?? table.replace(/_/g, " ");
}

const FIELD_LABEL: Record<string, string> = {
  company_name: "Company name",
  owner_name: "Owner",
  email: "Email",
  phone: "Phone",
  website: "Website",
  address: "Address",
  city: "City",
  state: "State",
  license_number: "Licence number",
  license_status: "Licence status",
  notes: "Notes",
};

/**
 * Folding a duplicate record into this one, and putting a record aside.
 *
 * A roster built partly by hand and partly by a sourcing agent accumulates the
 * same firm twice, one row with the phone number and one with the email, half
 * the history on each. The only tool for that was deleting one, which takes
 * the emails, quotes, pairings and documents with it: the record of who was
 * approached for a federal bid.
 *
 * The plan is fetched before anything happens and shown in full, because the
 * arithmetic in the confirmation is the arithmetic the merge runs. A dialog
 * that says "moves 40 emails" and then moves 38 teaches somebody not to read
 * the dialog.
 */
export function SubMerge({
  subcontractorId,
  companyName,
  archivedReason,
  mergedIntoId,
  mergedIntoName,
  candidates,
  canAct,
}: {
  subcontractorId: string;
  companyName: string;
  /** Set when this record has been put aside. */
  archivedReason: string | null;
  /** Set when this record is a tombstone pointing at another. */
  mergedIntoId: string | null;
  mergedIntoName: string | null;
  /** Other records on the roster that could be the duplicate. */
  candidates: { id: string; name: string; detail: string }[];
  canAct: boolean;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [keep, setKeep] = useState<Record<string, "survivor" | "merged">>({});
  const [reason, setReason] = useState("");
  const [panel, setPanel] = useState<"merge" | "archive" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ bad: boolean; text: string } | null>(null);

  async function loadPlan(dupeId: string) {
    setBusy(true);
    setMessage(null);
    setPlan(null);
    try {
      const res = await fetch(
        `/api/subs/${dupeId}/merge?into=${encodeURIComponent(subcontractorId)}`
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string; plan?: Plan };
      if (!res.ok || !data.plan) {
        setMessage({ bad: true, text: data.error ?? "Could not work out what that would do." });
        return;
      }
      setPlan(data.plan);
      setKeep({});
    } catch {
      setMessage({ bad: true, text: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  async function post(url: string, body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setMessage({ bad: true, text: data.error ?? "That did not work." });
        return;
      }
      setPanel(null);
      setPlan(null);
      setPicked("");
      setReason("");
      setMessage({ bad: false, text: data.message ?? "Done." });
      router.refresh();
    } catch {
      setMessage({ bad: true, text: "Could not reach the server. Nothing changed." });
    } finally {
      setBusy(false);
    }
  }

  if (mergedIntoId) {
    return (
      <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
        <p className="text-sm text-foreground">
          This record was folded into{" "}
          <Link href={`/subs/${mergedIntoId}`} className="text-accent hover:underline">
            {mergedIntoName ?? "another record"}
          </Link>
          . Everything that was on it is there now.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {/*
            Kept rather than deleted so an old link still resolves and an id in
            somebody's notes still means something.
          */}
          It stays here as a pointer. Undo the merge from the surviving record to separate
          them again.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {archivedReason && (
        <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
          <p className="text-sm text-foreground">Put aside: {archivedReason}</p>
          {canAct && (
            <button
              type="button"
              className="tap mt-1 text-xs text-accent hover:underline"
              disabled={busy}
              onClick={() => void post(`/api/subs/${subcontractorId}/merge`, { action: "restore" })}
            >
              Bring back onto the roster
            </button>
          )}
        </div>
      )}

      {canAct && !archivedReason && (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="tap text-xs text-accent hover:underline"
            aria-expanded={panel === "merge"}
            onClick={() => setPanel(panel === "merge" ? null : "merge")}
          >
            Fold a duplicate into this one
          </button>
          <button
            type="button"
            className="tap text-xs text-accent hover:underline"
            aria-expanded={panel === "archive"}
            onClick={() => setPanel(panel === "archive" ? null : "archive")}
          >
            Put this one aside
          </button>
        </div>
      )}

      {panel === "archive" && (
        <div className="space-y-2 rounded-md border border-border bg-surface-raised p-3">
          <p className="text-xs text-muted-foreground">
            {/*
              Says what it is not. "We do not work with these any more" and "do
              not use, here is why" are different statements about a firm, and
              a roster that renders them identically is one where somebody
              eventually emails the wrong one.
            */}
            They come off the roster and out of sourcing. Nothing is deleted, and this is not
            the same as marking them do not use.
          </p>
          <input
            type="text"
            className="input h-11 w-full lg:h-9"
            placeholder="Why, so the next person is not left guessing"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn"
              disabled={busy || !reason.trim()}
              onClick={() =>
                void post(`/api/subs/${subcontractorId}/merge`, {
                  action: "archive",
                  reason: reason.trim(),
                })
              }
            >
              {busy ? "Saving…" : "Put aside"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setPanel(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {panel === "merge" && (
        <div className="space-y-3 rounded-md border border-border bg-surface-raised p-3">
          <label className="block">
            <span className="label mb-1 block">Which record is the duplicate?</span>
            <select
              className="input h-11 w-full lg:h-9"
              value={picked}
              onChange={(e) => {
                setPicked(e.target.value);
                if (e.target.value) void loadPlan(e.target.value);
                else setPlan(null);
              }}
            >
              <option value="">Choose one</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.detail ? ` — ${c.detail}` : ""}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            Everything on the record you choose moves onto {companyName}. That record stays as a
            pointer to this one, so old links still work.
          </p>

          {busy && !plan && <p className="text-xs text-muted-foreground">Working it out…</p>}

          {plan && (
            <div className="space-y-3">
              <div>
                <p className="label">What moves</p>
                {plan.rows.length === 0 ? (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Nothing. That record has no history of its own.
                  </p>
                ) : (
                  <ul className="mt-1 space-y-0.5 text-sm text-foreground">
                    {plan.rows.map((r) => (
                      <li key={r.table}>
                        <span className="num">{r.moving}</span> {label(r.table)}
                        {r.colliding > 0 && (
                          <span className="text-muted-foreground">
                            {" "}
                            ({r.colliding} stay behind, because {companyName} already has the
                            same one)
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {plan.conflicts.length > 0 && (
                <div>
                  <p className="label">Where they disagree</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {/*
                      The survivor's value is kept unless somebody chooses
                      otherwise. Preferring the newer record silently could
                      overwrite a number somebody corrected by hand.
                    */}
                    This record&rsquo;s value is kept unless you pick the other one.
                  </p>
                  <ul className="mt-1.5 space-y-2">
                    {plan.conflicts.map((c) => (
                      <li key={c.field}>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          {FIELD_LABEL[c.field] ?? c.field}
                        </p>
                        <div className="mt-0.5 flex flex-wrap gap-2">
                          <button
                            type="button"
                            aria-pressed={(keep[c.field] ?? "survivor") === "survivor"}
                            onClick={() => setKeep((k) => ({ ...k, [c.field]: "survivor" }))}
                            className={chip((keep[c.field] ?? "survivor") === "survivor")}
                          >
                            {c.survivor ?? "Nothing on file"}
                          </button>
                          <button
                            type="button"
                            aria-pressed={keep[c.field] === "merged"}
                            onClick={() => setKeep((k) => ({ ...k, [c.field]: "merged" }))}
                            className={chip(keep[c.field] === "merged")}
                          >
                            {c.merged ?? "Nothing on file"}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {plan.irreversibleReason && (
                <p className="rounded-md border border-review/40 bg-review/5 px-3 py-2 text-xs text-review">
                  {plan.irreversibleReason}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void post(`/api/subs/${picked}/merge`, {
                      action: "merge",
                      into: subcontractorId,
                      keep,
                    })
                  }
                >
                  {busy ? "Merging…" : `Fold ${plan.mergedName} into this one`}
                </button>
                <button type="button" className="btn-ghost" onClick={() => setPanel(null)}>
                  Cancel
                </button>
                <span className="text-xs text-muted-foreground">
                  {plan.reversible ? "This can be undone." : "This cannot be undone."}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {message && (
        <p role="status" className={`text-xs ${message.bad ? "text-risk" : "text-muted-foreground"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}

function chip(on: boolean): string {
  const base =
    "inline-flex min-h-11 max-w-full items-center truncate rounded-md border px-3 text-sm lg:min-h-0 lg:py-1.5";
  return on
    ? `${base} border-accent bg-accent-soft text-accent-strong`
    : `${base} border-border text-foreground hover:bg-surface`;
}
