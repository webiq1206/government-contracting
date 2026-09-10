"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UnsavedGuard } from "./unsaved-guard";
import { ConfirmDialog } from "./confirm-dialog";

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
  const requestPending = useRef(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [number, setNumber] = useState("");
  const [award, setAward] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  async function save() {
    if (requestPending.current) return;
    requestPending.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/contracts", {
        method: "POST",
        signal: AbortSignal.timeout(20_000),
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
      setNumber(""); setAward(""); setStart(""); setEnd("");
      setOpen(false);
      router.push(`/contracts/${data.id}`);
    } catch {
      setError("The save was not confirmed. Check your contracts before trying again. Your entries are still here.");
    } finally {
      requestPending.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <UnsavedGuard when={number.trim() !== "" || award !== "" || start !== "" || end !== ""} />
      <button type="button" className="btn-ghost text-sm" onClick={() => setOpen(true)}>
        Record one by hand
      </button>
      <ConfirmDialog
        open={open}
        title="Record a contract"
        confirmLabel="Record it"
        busy={busy}
        confirmDisabled={!number.trim()}
        onConfirm={() => void save()}
        onCancel={() => setOpen(false)}
        body={<div className="space-y-3 text-left">
      <p className="text-xs text-muted-foreground">
        For work already under contract that this account did not bid here. It is marked as
        entered by hand, and shows no expected profit, because there is no bid behind it to
        work one out from.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label mb-1 block">Contract number</span>
          <input className="input h-9 w-full coarse:h-11" value={number}
            onChange={(e) => setNumber(e.target.value)} />
        </label>
        <label className="block">
          <span className="label mb-1 block">Award amount</span>
          <input className="input h-9 w-full coarse:h-11" inputMode="decimal" value={award}
            onChange={(e) => setAward(e.target.value)} placeholder="Dollars" />
        </label>
        <label className="block">
          <span className="label mb-1 block">Starts</span>
          <input type="date" className="input h-9 w-full coarse:h-11" value={start}
            onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="block">
          <span className="label mb-1 block">Ends</span>
          <input type="date" className="input h-9 w-full coarse:h-11" value={end}
            onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      {error && <p role="alert" className="text-xs text-risk">{error}</p>}
        </div>}
      />
    </>
  );
}
