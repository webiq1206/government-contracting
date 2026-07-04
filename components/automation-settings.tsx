"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AutomationSettings({
  pursueScore,
  reviewFloor,
  blockPrimeOnly,
}: {
  pursueScore: number;
  reviewFloor: number;
  blockPrimeOnly: boolean;
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

  return (
    <div className="card">
      <p className="eyebrow">Automation</p>
      <h2 className="mt-1 font-serif text-xl font-semibold text-foreground">Auto-pursue</h2>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
        Any opportunity scoring at or above this number is pursued automatically —
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
            Review band: {review}–{Math.max(score - 1, review)}. Dismiss below {review}.
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
            Pause prime-only past-performance bids for my review
          </span>
          <span className="mt-0.5 block text-slate-500">
            When off (default), high-scoring opportunities auto-pursue even when past
            performance must be the prime&rsquo;s own. When on, those stop for your OK first.
          </span>
        </span>
      </label>

      <div className="mt-5 flex items-center gap-3">
        <button className="btn-primary" onClick={save} disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save automation"}
        </button>
        {msg && <span className="text-sm text-accent">{msg}</span>}
        {err && <span className="text-sm text-risk">{err}</span>}
      </div>
    </div>
  );
}
