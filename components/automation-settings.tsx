"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  thresholdImpact,
  thresholdProblems,
  describeImpact,
} from "@/lib/domain/scoring-impact";

export function AutomationSettings({
  pursueScore,
  reviewFloor,
  blockPrimeOnly,
  histogram,
}: {
  pursueScore: number;
  reviewFloor: number;
  blockPrimeOnly: boolean;
  /**
   * Opportunities per score, 0 to 100, so the effect of a change is computed
   * here rather than fetched. The audit asks scoring changes to preview how
   * many opportunities would change recommendation, and the honest place to
   * answer that is beside the field being typed in, not after the save.
   */
  histogram: number[];
}) {
  const router = useRouter();
  const [score, setScore] = useState(pursueScore);
  const [review, setReview] = useState(reviewFloor);
  const [block, setBlock] = useState(blockPrimeOnly);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMsg(null);
    setErr(null);
    const res = await fetch("/api/profile/automation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pursue_min_score: score,
        review_min_score: review,
        block_prime_only: block,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg(`Saved (profile v${data.version}). Auto-pursue at ${data.pursue_min_score}+.`);
      router.refresh();
    } else {
      setErr(data.error ?? "Could not save.");
    }
    setSaving(false);
  }

  const dirty = score !== pursueScore || review !== reviewFloor || block !== blockPrimeOnly;

  const proposed = { pursue_min_score: score, review_min_score: review };
  const problems = useMemo(() => thresholdProblems(proposed), [score, review]);
  const blocking = problems.some((p) => p.severity === "error");
  // Only computed against a valid pair. Previewing the effect of thresholds
  // that cannot be saved would describe a state that will never exist.
  const impact = useMemo(
    () =>
      blocking
        ? null
        : thresholdImpact(
            histogram,
            { pursue_min_score: pursueScore, review_min_score: reviewFloor },
            proposed
          ),
    [histogram, pursueScore, reviewFloor, score, review, blocking]
  );

  return (
    <div className="card">
      <p className="eyebrow">Automation</p>
      <h2 className="mt-1 font-display text-xl font-semibold text-foreground">Auto-pursue</h2>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
        Any opportunity scoring at or above this number is pursued automatically:
        analysis, pricing, sub-finding, and outreach run with no human step. Scores in the
        review band land in the Review Queue; anything below is dismissed. A human still
        reviews and submits every bid.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label className="label">Auto-pursue at score</label>
          <div className="mt-1 flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={100}
              className="input w-24 num text-lg"
              value={score}
              onChange={(e) => setScore(Number(e.target.value))}
            />
            <span className="text-sm text-slate-500">/ 100</span>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            Review band: {review}-{Math.max(score - 1, review)}. Dismiss below {review}.
          </p>
        </div>

        <div>
          <label className="label">Review floor</label>
          <div className="mt-1 flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={score - 1}
              className="input w-24 num text-lg"
              value={review}
              onChange={(e) => setReview(Number(e.target.value))}
            />
            <span className="text-sm text-slate-500">and up = review</span>
          </div>
        </div>
      </div>

      <label className="mt-5 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-accent"
          checked={block}
          onChange={(e) => setBlock(e.target.checked)}
        />
        <span className="text-sm">
          <span className="font-medium text-foreground">
            Pause bids that require our own past performance
          </span>
          <span className="mt-0.5 block text-slate-500">
            Some agencies require proof that your company itself (not your subs)
            has done similar work before. When this is on, those opportunities
            stop and wait for your OK. When off, high scorers proceed automatically.
          </span>
        </span>
      </label>

      {/*
        * What the change would do, before it does it.
        *
        * This is the only control on the platform that starts outbound email
        * without a further human step, and it used to move with no indication
        * of the effect. An opportunity crossing into pursue is analysed,
        * priced and mailed to subcontractors automatically, so the sentence
        * says that in those words rather than reporting a tier count.
        */}
      {problems.length > 0 && (
        <ul className="mt-5 space-y-1.5">
          {problems.map((p, i) => (
            <li
              key={i}
              role={p.severity === "error" ? "alert" : undefined}
              className={`rounded-md border px-3 py-2 text-sm leading-relaxed ${
                p.severity === "error"
                  ? "border-risk/40 bg-risk/5 text-risk"
                  : "border-review/40 bg-review/5 text-review"
              }`}
            >
              {p.message}
            </li>
          ))}
        </ul>
      )}

      {dirty && impact && (
        <div className="mt-5 rounded-md border border-border bg-surface px-3 py-3">
          <p className="label">If you save this</p>
          <p className="mt-1 text-sm leading-relaxed text-foreground">{describeImpact(impact)}</p>
          {impact.total > 0 && (
            <dl className="mt-3 grid grid-cols-3 gap-3 text-xs">
              <Move label="Pursued automatically" from={impact.before.pursue} to={impact.after.pursue} />
              <Move label="Waiting for you" from={impact.before.review} to={impact.after.review} />
              <Move label="Not offered" from={impact.before.dismiss} to={impact.after.dismiss} />
            </dl>
          )}
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Counted over scored opportunities that have not started running yet. Anything
            already in progress carries on regardless, and everything scored from now on
            uses the new numbers.
          </p>
        </div>
      )}

      <div className="mt-5 flex items-center gap-3">
        <button className="btn-primary" onClick={save} disabled={saving || !dirty || blocking}>
          {saving ? "Saving…" : "Save automation"}
        </button>
        {msg && <span className="text-sm text-accent">{msg}</span>}
        {err && <span className="text-sm text-risk">{err}</span>}
      </div>
    </div>
  );
}

/**
 * One tier, before and after. The arrow is drawn only when the number moves,
 * so an unchanged row does not read as a change of nought.
 */
function Move({ label, from, to }: { label: string; from: number; to: number }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
      <dd className="num mt-0.5 text-sm text-foreground">
        {from === to ? (
          <span className="text-muted-foreground">{from}, unchanged</span>
        ) : (
          <>
            {from} <span aria-hidden>&rarr;</span>
            <span className="sr-only">becomes</span> <strong className="font-semibold">{to}</strong>
          </>
        )}
      </dd>
    </div>
  );
}
