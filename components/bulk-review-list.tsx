"use client";
import Link from "next/link";
import type { Opportunity } from "@/lib/types";
import { countdown, shortDate } from "@/lib/format";
import { flagLabel } from "@/lib/flag-labels";
import { RowActions } from "@/components/row-actions";
import { opportunityRowActions } from "@/lib/domain/row-actions";
import { BulkActionBar, BulkSelectAllCheckbox, BulkSelectCheckbox, BulkSelectionProvider } from "@/components/bulk-selection";

/** The list answers what to open next. Evidence and decisions live in the selected brief. */
export function BulkReviewList({ opps, selectedId = null, hrefBase, role }: {
  opps: Opportunity[]; selectedId?: string | null; role?: string | null; hrefBase?: string; peekHrefBase: string;
}) {
  return <BulkSelectionProvider ids={opps.map(o => o.id)}>
    <div className="mb-3 flex min-h-11 items-center justify-between gap-3 text-xs text-muted-foreground"><BulkSelectAllCheckbox label={`Select all ${opps.length}`} /><span>Earliest review deadline first</span></div>
    <ol className="overflow-hidden rounded-xl border border-border/60 bg-surface">
      {opps.map((o, index) => {
        const selected = String(o.id) === selectedId;
        const expiry = countdown(o.review_expires_at);
        const risk = o.risk_flags?.[0];
        return <li key={o.id} className={`border-b border-border/50 last:border-b-0 ${selected ? "bg-accent-soft ring-1 ring-inset ring-accent/40" : "hover:bg-surface-raised"}`}>
          <div className="flex items-start gap-2 p-3">
            <div className="pt-1"><BulkSelectCheckbox id={o.id} label={`Select ${o.title ?? "opportunity"}`} /></div>
            <Link href={hrefBase ? `${hrefBase}${o.id}` : `/opportunity/${o.id}`} scroll={false} aria-current={selected ? "true" : undefined} className="min-w-0 flex-1 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-medium text-muted-foreground">{String(index + 1).padStart(2, "0")}{selected ? " · Reviewing" : ""}</span><span className="font-semibold">{o.score == null ? "Not scored" : `Fit ${o.score}/100`}</span></div>
              <p className="line-clamp-3 text-sm font-semibold leading-relaxed" title={o.title ?? undefined}>{o.title ?? "Untitled opportunity"}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{o.agency ?? "Agency not stated"}</p>
              <div className="mt-3 space-y-1 text-xs"><p>Bid due: {o.deadline ? shortDate(String(o.deadline)) : "Not stated"}</p>{o.review_expires_at && <p className="font-medium text-review">{expiry === "overdue" ? "Review deadline passed" : `Review closes in ${expiry}`}</p>}</div>
              {risk && <p className="mt-2 line-clamp-2 text-xs text-risk">{flagLabel(risk)}</p>}
            </Link>
          </div>
          <div className="flex items-center justify-between gap-2 px-3 pb-2 pl-10"><span className="text-xs text-muted-foreground">{o.location_state ?? "Location not stated"}</span><RowActions actions={opportunityRowActions({id:o.id,title:o.title,stage:o.stage,status:o.status,snoozedUntil:o.snoozed_until??null,pursuitState:o.pursuit_state??null},{role})} recordLabel={o.title??"this opportunity"} /></div>
        </li>;
      })}
    </ol>
    <BulkActionBar noun="opportunity" actions={[{kind:"pursue",label:"Pursue"},{kind:"dismiss",label:"Pass",confirm:"Why are you passing on these opportunities? The same reason will be saved for each."},{kind:"snooze_opps"}]} />
  </BulkSelectionProvider>;
}
