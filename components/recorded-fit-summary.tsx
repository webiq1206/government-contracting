import { currentScoreLine } from "@/lib/domain/guide-score-context";

export const SAVED_FIT_NOTICE = "Saved fit analysis is historical. It has not been verified against the current score, decision or deadline.";

export function RecordedFitSummary({ score, tier, closed = false, researchOnly = false, recommendation, summary, badges = [] }: {
  score: number | null; tier: string | null; closed?: boolean; researchOnly?: boolean;
  recommendation?: string | null; summary?: string | null;
  badges?: { label: string; tone: "neutral" | "risk" }[];
}) {
  const savedRecommendation = recommendation?.trim();
  const savedSummary = summary?.trim();
  return <section aria-label={researchOnly ? "Notice purpose" : "Recorded fit assessment"}>
    <h2 className="font-display text-lg font-semibold leading-tight text-foreground sm:text-xl">
      {researchOnly ? "Notice purpose" : "Current recorded fit"}
    </h2>
    <p className="mt-2 font-display text-2xl font-semibold leading-snug text-foreground sm:text-3xl">
      {researchOnly ? "Sources Sought: market research, not a bid opportunity." : currentScoreLine(score, tier, closed)}
    </p>
    {!researchOnly && <>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{SAVED_FIT_NOTICE}</p>
      {savedRecommendation || savedSummary ? <details className="mt-3 rounded-lg border border-border p-3">
        <summary className="min-h-11 cursor-pointer text-sm font-medium">Saved fit analysis</summary>
        {savedRecommendation && <div className="mt-2"><p className="text-xs font-medium text-muted-foreground">Saved recommendation</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{savedRecommendation}</p></div>}
        {savedSummary && savedSummary !== savedRecommendation && <div className="mt-3"><p className="text-xs font-medium text-muted-foreground">Saved scoring summary</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{savedSummary}</p></div>}
      </details> : <p className="mt-3 text-sm text-muted-foreground">No saved fit explanation is available.</p>}
      {badges.length > 0 && <div className="mt-5">
        <p className="text-xs text-muted-foreground">Recorded scoring factors and warnings. Verify their current relevance.</p>
        <div className="mt-2 flex flex-wrap gap-2">{badges.map(b => <span key={b.label} className={b.tone === "risk" ? "badge bg-review/15 text-review" : "badge bg-muted text-muted-foreground"}>{b.tone === "risk" ? "!! " : ""}{b.label}</span>)}</div>
      </div>}
    </>}
  </section>;
}
