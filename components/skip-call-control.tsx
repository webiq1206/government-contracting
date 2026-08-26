"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  SCOPE_LABEL,
  SKIP_REASONS,
  SKIP_REASON_LABEL,
  SUPPRESSION_SCOPES,
  type SkipReason,
  type SuppressionScope,
} from "@/lib/domain/suppression";

/**
 * Declining a call, and saying how far the decision goes.
 *
 * The control this replaces was one click. It set the card to skipped and
 * wrote a sentence nobody chose, and the next Call Prep run built the card
 * again, so the decision survived exactly as long as the row.
 *
 * Two things had to be asked, and neither could be guessed from the click.
 *
 * Why, from a fixed list, because these get counted. "They already replied by
 * email" turning up on half a call queue is a scheduling defect worth fixing,
 * and the same fact spread over forty differently worded notes is invisible.
 *
 * And how far. "Not this one call" and "never ring this firm again" are
 * different instructions, and a product that treats them alike will do one of
 * them wrong. The default is the narrowest, because a one-time skip that
 * quietly created a standing rule is how somebody stops speaking to a
 * subcontractor for good on the strength of a busy Tuesday.
 *
 * What it never does is say anything about the subcontractor. Skipping a call
 * is not a decline, is not unresponsiveness, and is not a lost lead.
 */
export function SkipCallControl({
  callCardId,
  companyName,
  trade,
  /** True when the operator has already dialled and is giving up mid-attempt. */
  dialed = false,
  className = "btn-ghost text-xs",
  onDone,
}: {
  callCardId: string;
  companyName: string;
  trade?: string | null;
  dialed?: boolean;
  className?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<SkipReason>("call_not_necessary");
  const [note, setNote] = useState("");
  const [scope, setScope] = useState<SuppressionScope>("once");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function send(undo = false) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/call-cards/${callCardId}/skip`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        undo ? { undo: true } : { reason, note, scope, dialed }
      ),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "That could not be recorded.");
      return;
    }
    setDone(!undo);
    if (undo) setOpen(false);
    router.refresh();
    onDone?.();
  }

  if (done) {
    return (
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        Skipped.
        {/*
          Undo is offered only for a one-time skip. Offering it for a standing
          rule would suggest the rule can be taken back with the same click
          that made it, and it cannot: lifting a suppression is its own
          decision with its own audit line.
        */}
        {scope === "once" ? (
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => void send(true)}
            disabled={busy}
          >
            Undo
          </button>
        ) : (
          <span>Lift it from the subcontractor record.</span>
        )}
      </span>
    );
  }

  if (!open) {
    return (
      <button type="button" className={className} onClick={() => setOpen(true)}>
        Skip this call
      </button>
    );
  }

  return (
    <div className="w-full rounded-md border border-border bg-surface p-3 text-left">
      <p className="text-sm font-medium text-foreground">
        Not calling {companyName}
        {trade ? ` about ${trade}` : ""}?
      </p>
      {/* Said out loud because the old control implied otherwise by saying
          nothing at all. */}
      <p className="mt-1 text-xs text-muted-foreground">
        This closes the task. It does not record them as declining, unresponsive, or not
        interested.
      </p>

      <fieldset className="mt-3">
        <legend className="label">Why</legend>
        <div className="mt-1 grid gap-1">
          {SKIP_REASONS.map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="radio"
                name={`skip-reason-${callCardId}`}
                value={r}
                checked={reason === r}
                onChange={() => setReason(r)}
              />
              {SKIP_REASON_LABEL[r]}
            </label>
          ))}
        </div>
      </fieldset>

      {reason === "other" && (
        <label className="mt-2 block">
          <span className="label">In your words</span>
          <input
            className="input w-full"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why this call is not happening"
          />
        </label>
      )}

      <fieldset className="mt-3">
        <legend className="label">How far does this go</legend>
        <div className="mt-1 grid gap-1">
          {SUPPRESSION_SCOPES.map((sc) => (
            <label key={sc} className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="radio"
                name={`skip-scope-${callCardId}`}
                value={sc}
                checked={scope === sc}
                onChange={() => setScope(sc)}
              />
              {sc === "opportunity_trade" && trade
                ? `${trade} on this bid`
                : SCOPE_LABEL[sc]}
            </label>
          ))}
        </div>
        {scope === "subcontractor" && (
          <p className="mt-1 text-xs text-risk">
            No future call task will be created for {companyName} on any bid until somebody
            lifts it. Emails and follow-ups carry on.
          </p>
        )}
      </fieldset>

      {error && <p className="mt-2 text-xs text-risk">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="btn-primary text-xs"
          onClick={() => void send()}
          disabled={busy || (reason === "other" && !note.trim())}
        >
          {busy ? "Recording" : "Skip this call"}
        </button>
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
