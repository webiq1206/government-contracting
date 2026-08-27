"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  PERFORMANCE_HINT,
  PERFORMANCE_KINDS,
  PERFORMANCE_LABEL,
  type PerformanceKind,
} from "@/lib/domain/sub-performance";

export interface PerformanceRow {
  id: string;
  kind: PerformanceKind;
  note: string | null;
  recordedBy: string | null;
  at: string;
  opportunityId: string | null;
  opportunityTitle: string | null;
  retractedAt: string | null;
  retractedReason: string | null;
}

/**
 * How the work went, written down by the person who saw it.
 *
 * The reliability score measured whether a firm answers email and whether they
 * have ever given a price. Both are real signals and neither is what anybody
 * means by reliable. The question an operator actually asks before putting a
 * firm on a bid is whether the last job went well, and until now there was
 * nowhere to record the answer, so the score could not include it and the next
 * person had to ask around.
 *
 * It cannot be inferred. A contract closing says the paperwork finished, not
 * that the crew turned up. So it is typed in, and the record says who typed it
 * and when, because a mark against a firm has to be something they could be
 * shown.
 */
export function SubPerformance({
  subcontractorId,
  events,
  canRecord,
}: {
  subcontractorId: string;
  events: PerformanceRow[];
  /** Recording changes which firms get approached on every future bid. */
  canRecord: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<PerformanceKind | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ bad: boolean; text: string } | null>(null);
  const [retracting, setRetracting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const noteRequired = kind !== "" && kind !== "completed";

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/subs/${subcontractorId}/performance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setMessage({ bad: true, text: data.error ?? "That did not save." });
        return;
      }
      setKind("");
      setNote("");
      setRetracting(null);
      setReason("");
      setMessage({ bad: false, text: data.message ?? "Saved." });
      router.refresh();
    } catch {
      setMessage({ bad: true, text: "Could not reach the server. Nothing was saved." });
    } finally {
      setBusy(false);
    }
  }

  const live = events.filter((e) => !e.retractedAt);

  return (
    <div className="space-y-3">
      <div>
        <p className="label">How the work went</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {/*
            Says where it goes and what it is for. A note somebody thinks is
            private, that turns out to steer sourcing, is a note they would
            have worded differently.
          */}
          Recorded by hand, because nothing else knows. This is a quarter of the reliability
          score and it decides who gets approached first on the next bid.
        </p>
      </div>

      {canRecord && (
        <div className="space-y-2 rounded-md border border-border bg-surface-raised p-3">
          <div className="flex flex-wrap gap-2">
            {PERFORMANCE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(kind === k ? "" : k)}
                className={`inline-flex min-h-11 items-center rounded-md border px-3 text-sm lg:min-h-0 lg:py-1.5 ${
                  kind === k
                    ? "border-accent bg-accent-soft text-accent-strong"
                    : "border-border text-foreground hover:bg-surface"
                }`}
              >
                {PERFORMANCE_LABEL[k]}
              </button>
            ))}
          </div>
          {kind && (
            <>
              <p className="text-xs text-muted-foreground">{PERFORMANCE_HINT[kind]}</p>
              <textarea
                className="input min-h-[4rem] w-full text-sm"
                placeholder={
                  kind === "completed"
                    ? "Anything worth remembering (optional)"
                    : "What happened, so somebody reading this in a year can judge it"
                }
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn"
                  disabled={busy || (noteRequired && !note.trim())}
                  onClick={() => void post({ kind, note: note.trim() })}
                >
                  {busy ? "Saving…" : "Record it"}
                </button>
                <button type="button" className="btn-ghost" onClick={() => setKind("")}>
                  Cancel
                </button>
                {noteRequired && !note.trim() && (
                  <span className="text-xs text-muted-foreground">
                    Say what happened. A mark with no reason is one nobody can check or lift.
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {message && (
        <p role="status" className={`text-xs ${message.bad ? "text-risk" : "text-muted-foreground"}`}>
          {message.text}
        </p>
      )}

      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {/*
            Nothing recorded is not "they have never let you down". The score
            says so too, by leaving the performance dimension unmeasured.
          */}
          Nothing recorded. That means nobody has written anything down, not that every job
          went well.
        </p>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => (
            <li
              key={e.id}
              className={`rounded-md border px-3 py-2 ${
                e.retractedAt
                  ? "border-border bg-surface-raised"
                  : e.kind === "completed"
                    ? "border-border bg-surface"
                    : "border-risk/40 bg-risk/5"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span
                  className={`text-sm font-medium ${
                    e.retractedAt ? "text-muted-foreground line-through" : "text-foreground"
                  }`}
                >
                  {PERFORMANCE_LABEL[e.kind]}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDay(e.at)}
                  {e.recordedBy ? ` · ${e.recordedBy}` : ""}
                </span>
              </div>
              {e.note && (
                <p className="mt-0.5 text-sm text-muted-foreground">{e.note}</p>
              )}
              {e.opportunityId && (
                <Link
                  href={`/opportunity/${e.opportunityId}`}
                  className="mt-0.5 inline-block text-xs text-accent hover:underline"
                >
                  {e.opportunityTitle ?? "On this job"}
                </Link>
              )}
              {e.retractedAt ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Withdrawn {formatDay(e.retractedAt)}: {e.retractedReason}
                </p>
              ) : (
                canRecord && (
                  <div className="mt-1">
                    {retracting === e.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          className="input h-11 flex-1 text-sm lg:h-9"
                          placeholder="Why it is being withdrawn"
                          value={reason}
                          onChange={(ev) => setReason(ev.target.value)}
                        />
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          disabled={busy || !reason.trim()}
                          onClick={() =>
                            void post({ action: "retract", event_id: e.id, reason: reason.trim() })
                          }
                        >
                          Withdraw
                        </button>
                        <button
                          type="button"
                          className="btn-ghost text-xs"
                          onClick={() => setRetracting(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="tap text-xs text-accent hover:underline"
                        onClick={() => {
                          setReason("");
                          setRetracting(e.id);
                        }}
                        title="The record stays, marked, with your reason on it"
                      >
                        Withdraw this
                      </button>
                    )}
                  </div>
                )
              )}
            </li>
          ))}
        </ul>
      )}

      {live.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {live.length} {live.length === 1 ? "record" : "records"} standing
          {events.length > live.length
            ? `, ${events.length - live.length} withdrawn and kept`
            : ""}
          .
        </p>
      )}
    </div>
  );
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "at an unrecorded time"
    : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
