"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CHANNELS, CHANNEL_LABEL, type Channel } from "@/lib/domain/suppression";

/**
 * Stopping outreach to one subcontractor, having first been told what that
 * cancels.
 *
 * The preview is the control. The same button, on the same screen, can mean
 * "cancel one follow-up" or "cancel eleven queued messages and leave two
 * trades with nobody quoting them", and nothing in the label distinguishes
 * them. So the numbers are fetched before the confirmation is offered, and the
 * operator agrees to what will happen rather than to a word.
 *
 * The line that changes minds is the last one: which trades this leaves with
 * nobody responding. An operator stopping a firm that has already quoted loses
 * nothing; one stopping the only firm still answering on a trade has just put
 * a hole in the bid, and nothing else on the screen would say so.
 */
export function StopOutreach({
  subcontractorId,
  companyName,
  opportunityId,
  trade,
}: {
  subcontractorId: string;
  companyName: string;
  /** Null stops them across every bid on this account. */
  opportunityId?: string | null;
  trade?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"this_bid" | "everywhere">(
    opportunityId ? "this_bid" : "everywhere"
  );
  const [channel, setChannel] = useState<Channel>("all");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);

  const effectiveOpp = scope === "this_bid" ? opportunityId ?? null : null;

  async function preview() {
    setBusy(true);
    setError(null);
    setLines(null);
    const q = new URLSearchParams({ channel });
    if (effectiveOpp) q.set("opportunityId", effectiveOpp);
    const res = await fetch(
      `/api/subcontractors/${subcontractorId}/stop-outreach?${q.toString()}`
    );
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "What this would cancel could not be worked out.");
      return;
    }
    setLines(Array.isArray(data.lines) ? data.lines : []);
  }

  async function commit() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/subcontractors/${subcontractorId}/stop-outreach`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        opportunityId: effectiveOpp,
        trade: scope === "this_bid" ? trade ?? null : null,
        channel,
        reason,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "That could not be recorded.");
      return;
    }
    setStopped(true);
    router.refresh();
  }

  if (stopped) {
    return (
      <p className="text-xs text-muted-foreground">
        Outreach to {companyName} is stopped. Messages already sent, replies, quotes and
        history are all kept. Lift it from their record when you want to start again.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn-ghost text-xs"
        onClick={() => {
          setOpen(true);
          void preview();
        }}
      >
        Stop outreach for this subcontractor
      </button>
    );
  }

  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <p className="text-sm font-medium text-foreground">Stop outreach to {companyName}</p>

      <fieldset className="mt-3">
        <legend className="label">Where</legend>
        <div className="mt-1 grid gap-1 text-sm">
          {opportunityId && (
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`stop-scope-${subcontractorId}`}
                checked={scope === "this_bid"}
                onChange={() => {
                  setScope("this_bid");
                  setLines(null);
                }}
              />
              This bid{trade ? `, ${trade}` : ""}
            </label>
          )}
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`stop-scope-${subcontractorId}`}
              checked={scope === "everywhere"}
              onChange={() => {
                setScope("everywhere");
                setLines(null);
              }}
            />
            Every bid this firm is on
          </label>
        </div>
      </fieldset>

      <fieldset className="mt-3">
        <legend className="label">What to stop</legend>
        <div className="mt-1 grid gap-1 text-sm">
          {CHANNELS.map((c) => (
            <label key={c} className="flex items-center gap-2">
              <input
                type="radio"
                name={`stop-channel-${subcontractorId}`}
                checked={channel === c}
                onChange={() => {
                  setChannel(c);
                  setLines(null);
                }}
              />
              {CHANNEL_LABEL[c]}
            </label>
          ))}
        </div>
        {/* Said because it is not obvious, and because getting it wrong closes
            a channel the operator never meant to close. */}
        <p className="mt-1 text-xs text-muted-foreground">
          A firm that will not take phone calls will often still answer email.
        </p>
      </fieldset>

      <label className="mt-3 block">
        <span className="label">Why</span>
        <input
          className="input w-full"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="They asked us to stop, or we have someone else on this scope"
        />
      </label>

      <div className="mt-3">
        {busy && !lines && <p className="text-xs text-muted-foreground">Working out what this cancels.</p>}
        {lines && (
          <ul className="space-y-1 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {lines.map((l, i) => (
              <li key={i} className={i === lines.length - 1 && /nobody responding/.test(l) ? "text-risk" : ""}>
                {l}
              </li>
            ))}
          </ul>
        )}
        {!lines && !busy && (
          <button type="button" className="text-xs underline underline-offset-2" onClick={() => void preview()}>
            Show what this cancels
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-risk">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="btn-danger text-xs"
          onClick={() => void commit()}
          // Not confirmable until the operator has seen the numbers and given
          // a reason. The preview is the whole point of the control.
          disabled={busy || !reason.trim() || lines == null}
        >
          {busy ? "Stopping" : "Stop outreach"}
        </button>
        <button type="button" className="btn-ghost text-xs" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
