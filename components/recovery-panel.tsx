"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface OpenIncident {
  id: string;
  state: string;
  stateLabel: string;
  nextAction: string;
  cause: string;
  startedAt: string;
  failedCount: number;
  requeuedCount: number;
  remainingCount: number;
  recommendedAction: string | null;
  repairAttempts: number;
  recoveryOwner: string | null;
  testRanAt: string | null;
  testPassed: boolean | null;
  recoveryNote: string | null;
  history: { to: string; label: string; actor: string; detail: string | null; at: string }[];
}

/**
 * The open incident, where it is in its recovery, and the one button that
 * moves it.
 *
 * The panel above this says what is wrong and how to fix it at the provider.
 * This says what happens after that, which is the part nobody had: an operator
 * who has just topped up an account has no way to find out whether it worked
 * except by waiting to see if the red goes away.
 *
 * So the button does not say "retry". It runs a real request, reports what
 * came back, and puts back only the work that is still worth doing.
 */
export function RecoveryPanel({ incidents }: { incidents: OpenIncident[] }) {
  if (incidents.length === 0) return null;
  return (
    <div className="space-y-3">
      {incidents.map((i) => (
        <IncidentCard key={i.id} incident={i} />
      ))}
    </div>
  );
}

function elapsed(fromIso: string): string {
  const ms = Date.now() - new Date(fromIso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "under an hour";
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${Math.floor(hours / 24)} days`;
}

function IncidentCard({ incident }: { incident: OpenIncident }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/automation/recovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ incidentId: incident.id }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        plan?: string;
      };
      if (!res.ok) {
        setError(body.error ?? "The recovery check could not run.");
        return;
      }
      setResult([body.message, body.plan].filter(Boolean).join(" "));
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card border-risk/40 bg-risk/5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{incident.stateLabel}</p>
        <p className="text-xs text-muted-foreground">
          Going on for {elapsed(incident.startedAt)}
          {incident.repairAttempts > 0 &&
            ` · ${incident.repairAttempts} recovery attempt${incident.repairAttempts === 1 ? "" : "s"}`}
        </p>
      </div>

      <p className="mt-1 text-sm text-slate-700">{incident.nextAction}</p>
      {incident.recommendedAction && (
        <p className="mt-1 text-sm text-muted-foreground">{incident.recommendedAction}</p>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
        <div>
          <dt>Failed</dt>
          <dd className="num text-foreground">{incident.failedCount}</dd>
        </div>
        <div>
          <dt>Requeued</dt>
          <dd className="num text-foreground">{incident.requeuedCount}</dd>
        </div>
        <div>
          <dt>Still waiting</dt>
          <dd className="num text-foreground">{incident.remainingCount}</dd>
        </div>
        <div>
          <dt>Test request</dt>
          {/*
            Three states, not two. A test that has not run is not a test that
            failed, and telling somebody their provider is broken when nothing
            has asked it anything is its own kind of wrong.
          */}
          <dd className={incident.testPassed === false ? "text-risk" : "text-foreground"}>
            {incident.testRanAt === null
              ? "Not run yet"
              : incident.testPassed
                ? "Answered"
                : "Refused"}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={run}>
          {busy ? "Checking the provider" : "Run recovery check"}
        </button>
        {incident.history.length > 0 && (
          <button
            type="button"
            className="text-xs underline underline-offset-2"
            onClick={() => setShowHistory((v) => !v)}
            aria-expanded={showHistory}
          >
            {showHistory ? "Hide history" : `History (${incident.history.length})`}
          </button>
        )}
      </div>

      {/*
        What the button did, in the words the API used. Not re-worded here:
        one sentence written once is one sentence to keep true.
      */}
      {result && <p className="mt-2 text-sm text-slate-700">{result}</p>}
      {error && <p className="mt-2 text-sm text-risk">{error}</p>}
      {incident.recoveryNote && !result && (
        <p className="mt-2 text-xs text-muted-foreground">{incident.recoveryNote}</p>
      )}

      {showHistory && (
        <ol className="mt-3 space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
          {incident.history.map((h, i) => (
            <li key={i}>
              <span className="text-foreground">{h.label}</span>
              {" · "}
              {h.actor}
              {" · "}
              {new Date(h.at).toLocaleString()}
              {h.detail && <span className="block pl-2">{h.detail}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
