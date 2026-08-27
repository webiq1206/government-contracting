"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Record a contract by hand.
 *
 * A contract could previously only exist as the output of a win, and the win
 * path hard-refuses an award with no bid record. So work signed before this
 * account existed, or awarded through a route the platform never saw, could
 * not be tracked at all: no milestones, no coordination log, no cap gauge.
 */
export function CreateContract() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [number, setNumber] = useState("");
  const [award, setAward] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract_number: number,
          award_amount: award,
          start_date: start || null,
          end_date: end || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; id?: string };
      if (!res.ok || !data.id) {
        setError(data.error ?? "That did not save.");
        return;
      }
      router.push(`/contracts/${data.id}`);
    } catch {
      setError("Could not reach the server. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn-ghost text-sm" onClick={() => setOpen(true)}>
        Record one by hand
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-surface-raised p-3 text-left">
      <p className="text-xs text-muted-foreground">
        For work already under contract that this account did not bid here. It is marked as
        entered by hand, and shows no expected profit, because there is no bid behind it to
        work one out from.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label mb-1 block">Contract number</span>
          <input className="input h-11 w-full lg:h-9" value={number}
            onChange={(e) => setNumber(e.target.value)} />
        </label>
        <label className="block">
          <span className="label mb-1 block">Award amount</span>
          <input className="input h-11 w-full lg:h-9" inputMode="decimal" value={award}
            onChange={(e) => setAward(e.target.value)} placeholder="Dollars" />
        </label>
        <label className="block">
          <span className="label mb-1 block">Starts</span>
          <input type="date" className="input h-11 w-full lg:h-9" value={start}
            onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="block">
          <span className="label mb-1 block">Ends</span>
          <input type="date" className="input h-11 w-full lg:h-9" value={end}
            onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      {error && <p role="status" className="text-xs text-risk">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" disabled={busy || !number.trim()} onClick={() => void save()}>
          {busy ? "Saving…" : "Record it"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
