"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "./confirm-dialog";
import { WORK_MODE_HINT, WORK_MODE_LABEL, type WorkMode } from "@/lib/domain/work-mode";

type Info = {
  mode: WorkMode;
  inherited: boolean;
  orgDefault: WorkMode;
  selfPerformedTrades: string[];
  outreachAllowed: boolean;
  impact: string[];
  counts: { pendingCalls: number; followUpsDue: number; sentMessages: number; subsPaired: number };
};

/**
 * Who does the work on this opportunity.
 *
 * Reads the record's mode on open, shows what turning outreach off would
 * stop before asking for confirmation, and never sends anything when it is
 * turned back on: sourcing starts only when somebody asks for subcontractors.
 */
export function WorkModeControl({
  opportunityId,
  requiredTrades,
  canControl,
  initialMode,
  initialInherited,
}: {
  opportunityId: string;
  requiredTrades: string[];
  canControl: boolean;
  initialMode: WorkMode;
  initialInherited: boolean;
}) {
  const router = useRouter();
  const [info, setInfo] = useState<Info | null>(null);
  const [choice, setChoice] = useState<WorkMode | "inherit">(initialInherited ? "inherit" : initialMode);
  const [trades, setTrades] = useState<string[]>([]);
  const [customTrade, setCustomTrade] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/opportunities/${opportunityId}/work-mode`, { signal: AbortSignal.timeout(15_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Info | null) => {
        if (cancelled || !data) return;
        setInfo(data);
        setTrades(data.selfPerformedTrades ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("The current setting could not be read. Reload before changing it.");
      });
    return () => {
      cancelled = true;
    };
  }, [opportunityId]);

  const resolved: WorkMode = choice === "inherit" ? (info?.orgDefault ?? initialMode) : choice;
  const turningOff = Boolean(info?.outreachAllowed) && resolved === "self";
  const turningOn = info ? !info.outreachAllowed && resolved !== "self" : false;
  const dirty = info
    ? choice !== (info.inherited ? "inherit" : info.mode) ||
      (resolved === "mixed" && JSON.stringify([...trades].sort()) !== JSON.stringify([...(info.selfPerformedTrades ?? [])].sort()))
    : false;

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/work-mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: choice === "inherit" ? null : choice, selfPerformedTrades: resolved === "mixed" ? trades : [] }),
        signal: AbortSignal.timeout(20_000),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; mode?: Info; stopped?: { followUpsStopped: number; callsCleared: number } | null };
      if (!res.ok || !data.mode) {
        setError(data.error ?? "That did not save.");
        return;
      }
      setInfo((prev) => (prev ? { ...prev, ...data.mode! } : prev));
      setSaved(
        data.stopped
          ? `Saved. ${data.stopped.followUpsStopped} follow-up${data.stopped.followUpsStopped === 1 ? "" : "s"} unscheduled and ${data.stopped.callsCleared} call${data.stopped.callsCleared === 1 ? "" : "s"} cleared. Messages already sent are kept.`
          : turningOn
            ? "Saved. Nothing was sent. Use Find subcontractors on the Subs and outreach tab when you are ready."
            : "Saved."
      );
      setConfirmOpen(false);
      router.refresh();
    } catch {
      setError("The change was not confirmed. Reload to see the current setting.");
    } finally {
      setBusy(false);
    }
  }

  const tradeOptions = [...new Set([...requiredTrades, ...trades])];

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Choice
          checked={choice === "inherit"}
          onChange={() => setChoice("inherit")}
          label={`Company default (${WORK_MODE_LABEL[info?.orgDefault ?? initialMode].toLowerCase()})`}
          hint="Follows Rules & limits. Change it there to change every opportunity that has no setting of its own."
          disabled={!canControl}
        />
        {(["sub", "self", "mixed"] as WorkMode[]).map((m) => (
          <Choice key={m} checked={choice === m} onChange={() => setChoice(m)} label={WORK_MODE_LABEL[m]} hint={WORK_MODE_HINT[m]} disabled={!canControl} />
        ))}
      </div>

      {resolved === "mixed" && (
        <div className="rounded-md border border-border p-3">
          <p className="label">Scopes you perform yourself</p>
          <p className="mt-1 text-xs text-muted-foreground">Everything not ticked gets subcontractor outreach.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {tradeOptions.map((t) => {
              const on = trades.some((x) => x.toLowerCase() === t.toLowerCase());
              return (
                <label key={t} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm ${on ? "border-accent bg-accent-soft/30" : "border-border"}`}>
                  <input type="checkbox" checked={on} disabled={!canControl} onChange={() => setTrades(on ? trades.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...trades, t])} />
                  {t}
                </label>
              );
            })}
          </div>
          <div className="search-row mt-2">
            <label className="sr-only" htmlFor={`custom-trade-${opportunityId}`}>Add a scope</label>
            <input id={`custom-trade-${opportunityId}`} className="input" placeholder="Add a scope not listed" value={customTrade} onChange={(e) => setCustomTrade(e.target.value)} disabled={!canControl} />
            <button
              type="button"
              className="btn-ghost min-h-11 shrink-0"
              disabled={!customTrade.trim() || !canControl}
              onClick={() => {
                if (!trades.some((x) => x.toLowerCase() === customTrade.trim().toLowerCase())) setTrades([...trades, customTrade.trim()]);
                setCustomTrade("");
              }}
            >
              Add
            </button>
          </div>
        </div>
      )}

      {turningOn && (
        <p className="text-sm text-muted-foreground">
          Turning outreach on sends nothing by itself. Sourcing starts when you press Find subcontractors on the Subs and outreach tab.
        </p>
      )}
      {error && <p role="alert" className="text-sm text-risk">{error}</p>}
      {saved && <p role="status" className="text-sm text-pursue-strong">{saved}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-primary min-h-11"
          disabled={!canControl || !info || !dirty || busy}
          onClick={() => (turningOff ? setConfirmOpen(true) : void save())}
        >
          {busy ? "Saving" : "Save who does the work"}
        </button>
        {!canControl && <span className="text-xs text-muted-foreground">Changing this needs the outreach permission.</span>}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Turn subcontractor outreach off for this opportunity?"
        confirmLabel="Turn it off"
        busy={busy}
        onConfirm={() => void save()}
        onCancel={() => setConfirmOpen(false)}
        body={
          <ul className="list-disc space-y-1 pl-5 text-left text-sm">
            {(info?.impact ?? []).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        }
      />
    </div>
  );
}

function Choice({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: () => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <label className={`flex cursor-pointer gap-3 rounded-md border p-3 ${checked ? "border-accent bg-accent-soft/30" : "border-border/55"} ${disabled ? "opacity-70" : ""}`}>
      <input type="radio" className="mt-1 h-4 w-4 shrink-0 accent-accent" checked={checked} onChange={onChange} disabled={disabled} />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}
