"use client";

/**
 * Replies the platform refused to guess at.
 *
 * Each row shows why it was held and the subcontractor's own words, because
 * the whole point is that the machine's reading was not trustworthy. The
 * operator reads the message and says what it meant; that answer is applied to
 * this solicitation only.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export interface ReplyReviewRow {
  id: string;
  subcontractor_id: string;
  company_name: string | null;
  opportunity_id: string | null;
  opportunity_title: string | null;
  trade: string | null;
  intent: string;
  reason: string | null;
  review_reason: string | null;
  original_message: string | null;
  confidence: string;
  created_at: string;
}

/** The answers an operator can give, in the order they occur in real life. */
const CHOICES: { outcome: string; label: string; hint: string }[] = [
  { outcome: "quoted", label: "They gave a price", hint: "Records a quote for this trade" },
  { outcome: "interested", label: "They're interested", hint: "Still needs a price" },
  {
    outcome: "unavailable",
    label: "Busy this time",
    hint: "Keeps them in the running for future work",
  },
  {
    outcome: "not_a_fit",
    label: "Wrong scope for them",
    hint: "Only for this scope, not future jobs",
  },
  { outcome: "declined", label: "They said no", hint: "Passed on this solicitation" },
  { outcome: "none", label: "Nothing to do", hint: "Dismiss without changing anything" },
];

export function ReplyReviewList({ rows }: { rows: ReplyReviewRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(id: string, outcome: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/replies/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not save that.");
        return;
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-foreground/45">
        The system read these but was not sure enough to act, so nothing was changed. Read
        what they wrote and tell it what they meant. Your answer applies to this job only.
      </p>
      {error && <p className="text-sm text-risk">{error}</p>}

      {rows.map((r) => {
        const expanded = open === r.id;
        return (
          <div key={r.id} className="panel-inset p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {r.company_name ?? "A subcontractor"}
                  {r.trade ? (
                    <span className="text-foreground/45"> · {r.trade}</span>
                  ) : null}
                </p>
                {r.opportunity_id ? (
                  <Link
                    href={`/opportunity/${r.opportunity_id}`}
                    className="text-xs text-accent hover:underline"
                  >
                    {r.opportunity_title ?? "Open the solicitation"}
                  </Link>
                ) : (
                  <span className="text-xs text-foreground/45">No solicitation linked</span>
                )}
                {/* The row shows an excerpt and asks what they meant. Answering
                    them is a different job, and it lives on their page with the
                    rest of the thread, so link there instead of making the
                    operator hunt for the conversation by name. */}
                <Link
                  href={`/subs/${r.subcontractor_id}#conversations`}
                  className="mt-0.5 block text-xs text-accent hover:underline"
                >
                  Read the thread and reply
                </Link>
              </div>
              <span className="badge shrink-0 bg-review/15 text-review">Needs your read</span>
            </div>

            {r.review_reason && (
              <p className="mt-2 text-sm text-review">{r.review_reason}</p>
            )}

            {r.original_message && (
              <>
                <blockquote className="mt-2 border-l-2 border-border pl-3 text-sm text-foreground/70">
                  {expanded
                    ? r.original_message
                    : `${r.original_message.slice(0, 240)}${r.original_message.length > 240 ? "…" : ""}`}
                </blockquote>
                {r.original_message.length > 240 && (
                  <button
                    type="button"
                    className="mt-1 text-xs text-accent hover:underline"
                    onClick={() => setOpen(expanded ? null : r.id)}
                  >
                    {expanded ? "Show less" : "Read the whole message"}
                  </button>
                )}
              </>
            )}

            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
              {CHOICES.map((c) => (
                <button
                  key={c.outcome}
                  type="button"
                  className="btn-ghost text-xs"
                  title={c.hint}
                  disabled={busy != null}
                  onClick={() => resolve(r.id, c.outcome)}
                >
                  {busy === r.id ? "Saving…" : c.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
