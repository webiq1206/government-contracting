import type { GuideScoreExplain } from "@/lib/domain/page-guide";
import { SAVED_SCORE_NOTICE } from "@/lib/domain/guide-score-context";

export function GuideScoreDetails({ scoreLine, explanation }: { scoreLine?: string; explanation: GuideScoreExplain }) {
  return <div className="space-y-3">
    <p className="text-sm font-semibold text-foreground">{scoreLine ?? "Current score unavailable"}</p>
    <p className="text-sm text-muted-foreground">{explanation.freshnessNote ?? SAVED_SCORE_NOTICE}</p>
    <details className="rounded-md border border-border p-3">
      <summary className="min-h-11 cursor-pointer text-sm font-medium text-foreground">
        Saved scoring analysis{Number.isFinite(explanation.total) ? ` (recorded total ${Math.round(explanation.total)})` : ""}
      </summary>
      <p className="mt-2 text-sm text-slate-600">{explanation.summary}</p>
      <ul className="mt-3 space-y-2">
        {explanation.factors.map(f => <li key={f.label} className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
          <div className="flex justify-between gap-2 font-medium text-foreground"><span>{f.label}</span><span className="num text-slate-500">{f.points}/{f.max}</span></div>
          {f.reasoning && <p className="mt-1 text-xs text-slate-600">{f.reasoning}</p>}
        </li>)}
      </ul>
    </details>
  </div>;
}
