"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Moving a call to a time the operator picked.
 *
 * A different decision from skipping, and kept visibly different. Skipping
 * says the call is not happening; this says it is happening later, and the
 * card stays pending so it comes back on its own rather than needing to be
 * remembered.
 *
 * Exactly one future task, which is why this moves the existing card rather
 * than creating a second one. A control that scheduled a new call and left the
 * old one pending would produce two tasks for one conversation, and the
 * operator would find out by ringing somebody twice.
 *
 * The picker is a plain `datetime-local`, so the time typed is the operator's
 * own wall clock and the browser converts it. Asking for a timezone here would
 * be asking somebody to state where they are standing.
 */
export function CallLater({
  callCardId,
  companyName,
  className = "btn-ghost text-xs",
}: {
  callCardId: string;
  companyName: string;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(() => defaultWhen());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const when = new Date(at);
    if (Number.isNaN(when.getTime())) {
      setError("Pick a date and time.");
      setBusy(false);
      return;
    }
    const res = await fetch("/api/snooze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "call_card", id: callCardId, at: when.toISOString() }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "That could not be recorded.");
      return;
    }
    setMoved(when.toLocaleString());
    setOpen(false);
    router.refresh();
  }

  if (moved) {
    return (
      <span className="text-xs text-muted-foreground">
        Back in the queue on {moved}. Nothing about {companyName} changed.
      </span>
    );
  }

  if (!open) {
    return (
      <button type="button" className={className} onClick={() => setOpen(true)}>
        Call later
      </button>
    );
  }

  return (
    <div className="w-full rounded-md border border-border bg-surface p-3 text-left">
      <p className="text-sm font-medium text-foreground">When should this come back?</p>
      <p className="mt-1 text-xs text-muted-foreground">
        The card stays pending and returns then. This is not a skip: nothing is recorded about
        {` ${companyName}`}.
      </p>
      <label className="mt-2 block">
        <span className="label">Date and time</span>
        <input
          type="datetime-local"
          className="input w-full"
          value={at}
          onChange={(e) => setAt(e.target.value)}
        />
        <span className="mt-1 block text-xs text-muted-foreground">
          Your own clock. No timezone to pick.
        </span>
      </label>
      {error && <p className="mt-2 text-xs text-risk">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn-primary text-xs" onClick={() => void save()} disabled={busy}>
          {busy ? "Moving" : "Move this call"}
        </button>
        <button type="button" className="btn-ghost text-xs" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Tomorrow morning, which is what "later" usually means on a call queue. */
function defaultWhen(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}
