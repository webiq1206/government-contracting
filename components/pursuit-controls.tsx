"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ABORT_REASONS,
  ABORT_REASON_LABEL,
  RESTART_REVALIDATION,
  type AbortReason,
  type PursuitState,
} from "@/lib/domain/pursuit-state";

export interface PursuitImpactView {
  title: string | null;
  solicitationNumber: string | null;
  deadline: string | null;
  stage: string;
  stops: { label: string; count: number }[];
  stands: { label: string; count: number }[];
  retained: string[];
  confirmPhrase: string;
}

/**
 * Pausing, aborting and restarting a pursuit.
 *
 * These are four different decisions and the screen keeps them apart, because
 * the instruction is explicit that Skip, Pass, No response, Not interested,
 * Lost, Agency cancelled and Aborted must not become synonyms. Pausing keeps
 * everything and picks up where it stopped. Aborting is a decision that the
 * bid is not happening, and coming back from it is a restart rather than a
 * resume, because the solicitation may have been amended twice in between.
 *
 * The abort is deliberately not a browser confirm. `window.confirm` collects
 * agreement and records nothing, and the question it asks, "are you sure", is
 * not the question the operator has. Theirs is: what stops, what has already
 * gone out that I cannot take back, and what is kept. So the flow shows the
 * counts, takes a structured reason, and asks for the solicitation number to
 * be typed, which proves which record is being looked at in a way that typing
 * the word ABORT does not.
 */
export function PursuitControls({
  opportunityId,
  state,
  impact,
  canControl,
}: {
  opportunityId: string;
  state: PursuitState;
  impact: PursuitImpactView;
  /** Aborting is an outreach-level decision, not a viewing one. */
  canControl: boolean;
}) {
  const router = useRouter();
  const [flow, setFlow] = useState<"none" | "abort" | "restart">("none");
  const [reason, setReason] = useState<AbortReason>("strategic");
  const [note, setNote] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "pause" | "resume" | "abort" | "restart") {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/opportunities/${opportunityId}/pursuit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        action === "abort" ? { action, reason, note } : { action }
      ),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "That could not be recorded.");
      return;
    }
    setFlow("none");
    setTyped("");
    router.refresh();
  }

  if (!canControl) return null;

  const phraseMatches =
    typed.trim().toLowerCase() === impact.confirmPhrase.trim().toLowerCase();

  if (flow === "abort") {
    return (
      <div className="card border-risk/40">
        <h3 className="font-display text-xl font-normal text-foreground">Abort this pursuit</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {impact.title ?? "This opportunity"}
          {impact.solicitationNumber ? ` · ${impact.solicitationNumber}` : ""}
          {impact.deadline ? ` · closes ${new Date(impact.deadline).toLocaleString()}` : ""}
          {` · currently ${impact.stage.replace(/_/g, " ")}`}
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="label mb-1">What stops</p>
            {impact.stops.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing is queued or scheduled.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {impact.stops.map((s) => (
                  <li key={s.label} className="flex items-baseline justify-between gap-3">
                    <span className="text-foreground">{s.label}</span>
                    <span className="num text-muted-foreground">{s.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            {/* The half people forget. An email in somebody's inbox cannot be
                recalled, and a screen that lists only what stops implies it
                can. */}
            <p className="label mb-1">What has already happened</p>
            {impact.stands.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing has gone out yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {impact.stands.map((s) => (
                  <li key={s.label} className="flex items-baseline justify-between gap-3">
                    <span className="text-foreground">{s.label}</span>
                    <span className="num text-muted-foreground">{s.count}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              None of this can be taken back. Aborting stops what is next, not what is done.
            </p>
          </div>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Kept and readable afterwards: {impact.retained.join(", ")}.
        </p>

        <fieldset className="mt-4">
          <legend className="label">Why</legend>
          <div className="mt-1 grid gap-1 sm:grid-cols-2">
            {ABORT_REASONS.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="radio"
                  name="abort-reason"
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                />
                {ABORT_REASON_LABEL[r]}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="mt-3 block">
          <span className="label">
            Note {reason === "other" ? "(required)" : "(optional)"}
          </span>
          <textarea
            className="input w-full"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What a person reading this in six months needs to know"
          />
        </label>

        <label className="mt-3 block">
          <span className="label">
            Type <span className="num">{impact.confirmPhrase}</span> to confirm
          </span>
          <input
            className="input w-full"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            aria-describedby="abort-confirm-help"
          />
          {/* Typing the record's own number proves which one is on screen.
              Typing the word ABORT is muscle memory. */}
          <span id="abort-confirm-help" className="mt-1 block text-xs text-muted-foreground">
            This is the solicitation number for this bid, so the confirmation is about this
            record rather than about the button.
          </span>
        </label>

        {error && <p className="mt-2 text-sm text-risk">{error}</p>}

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            className="btn-danger"
            onClick={() => void act("abort")}
            disabled={
              busy || !phraseMatches || (reason === "other" && note.trim().length < 3)
            }
          >
            {busy ? "Aborting" : "Abort this pursuit"}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setFlow("none");
              setTyped("");
            }}
            disabled={busy}
          >
            Keep working on it
          </button>
        </div>
      </div>
    );
  }

  if (flow === "restart") {
    return (
      <div className="card border-accent">
        <h3 className="font-display text-xl font-normal text-foreground">Restart this pursuit</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Not a resume. The solicitation may have been amended since this stopped, so the
          record is rebuilt from current facts before anything goes out again.
        </p>
        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
          {RESTART_REVALIDATION.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {error && <p className="mt-2 text-sm text-risk">{error}</p>}
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            className="btn-primary"
            onClick={() => void act("restart")}
            disabled={busy}
          >
            {busy ? "Restarting" : "Restart and revalidate"}
          </button>
          <button type="button" className="btn-ghost" onClick={() => setFlow("none")} disabled={busy}>
            Leave it aborted
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {state === "active" && (
        <>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => void act("pause")}
            disabled={busy}
          >
            Pause this pursuit
          </button>
          <button
            type="button"
            className="btn-ghost text-xs text-risk"
            onClick={() => setFlow("abort")}
            disabled={busy}
          >
            Abort pursuit
          </button>
        </>
      )}
      {state === "paused" && (
        <>
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={() => void act("resume")}
            disabled={busy}
          >
            Resume
          </button>
          <button
            type="button"
            className="btn-ghost text-xs text-risk"
            onClick={() => setFlow("abort")}
            disabled={busy}
          >
            Abort pursuit
          </button>
        </>
      )}
      {state === "aborted" && (
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={() => setFlow("restart")}
          disabled={busy}
        >
          Restart pursuit
        </button>
      )}
      {error && <p className="text-xs text-risk">{error}</p>}
    </div>
  );
}
