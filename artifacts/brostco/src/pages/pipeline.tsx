import { Link } from "wouter";
import { useGetOpportunities } from "@workspace/api-client-react";
import { PageHeader, ScoreBadge } from "@/components/badges";
import { currency, countdown } from "@/lib/format";
import type { Opportunity } from "@/lib/types";

const PIPELINE_STAGES = [
  { key: "monitoring", label: "Monitoring" },
  { key: "scoring", label: "Scoring" },
  { key: "analysis", label: "Analysis" },
  { key: "sub_research", label: "Sub Research" },
  { key: "outreach", label: "Outreach" },
  { key: "call_queue", label: "Call Queue" },
  { key: "quote_entry", label: "Quote Entry" },
  { key: "bid_building", label: "Bid Building" },
  { key: "submitted", label: "Submitted" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
];

const NEXT_ACTION: Record<string, string> = {
  monitoring: "Awaiting scoring",
  scoring: "Scoring in progress",
  analysis: "Analyst + Pricing running",
  sub_research: "Finding subs",
  outreach: "Outreach in flight",
  call_queue: "Call the sub",
  quote_entry: "Enter quote",
  bid_building: "Review & submit bid",
  submitted: "Awaiting award",
  won: "Set up contract",
  lost: "Archived",
};

export default function PipelinePage() {
  const { data: opps = [], isLoading } = useGetOpportunities();

  const byStage = new Map<string, Opportunity[]>();
  for (const s of PIPELINE_STAGES) byStage.set(s.key, []);
  for (const o of opps as Opportunity[]) {
    if (!byStage.has(o.stage)) byStage.set(o.stage, []);
    byStage.get(o.stage)!.push(o);
  }

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title="Pipeline"
        subtitle={isLoading ? "Loading..." : `${opps.length} active opportunities. Human-action items in amber.`}
      />
      <div className="scroll-thin flex-1 overflow-x-auto p-4">
        <div className="flex h-full gap-3" style={{ minWidth: "max-content" }}>
          {PIPELINE_STAGES.map((stage) => {
            const cards = byStage.get(stage.key) ?? [];
            return (
              <div key={stage.key} className="flex w-72 flex-col">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-sm font-semibold text-slate-200">{stage.label}</span>
                  <span className="badge bg-ink-700 text-slate-400">{cards.length}</span>
                </div>
                <div className="scroll-thin flex-1 space-y-2 overflow-y-auto pr-1">
                  {cards.map((o) => {
                    const exp = countdown(o.deadline);
                    return (
                      <Link
                        key={o.id}
                        href={`/opportunity/${o.id}`}
                        className={`card card-hover block ${o.human_action_required ? "border-review/60 bg-review/5" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="line-clamp-2 text-sm font-medium text-slate-100">{o.title ?? "Untitled"}</p>
                          <ScoreBadge score={o.score} />
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                          <span>{currency(o.value_estimated)}</span>
                          <span className={exp === "overdue" ? "text-risk" : ""}>⏱ {exp}</span>
                        </div>
                        {o.agency && <p className="mt-1 truncate text-xs text-slate-500">{o.agency}</p>}
                        {o.bid_quote_count != null && o.bid_quote_count > 0 && o.bid_min_quote != null && (
                          <p className="mt-1 text-xs font-medium text-emerald-400">
                            Best quote: {currency(o.bid_min_quote)} ({o.bid_quote_count} sub{o.bid_quote_count === 1 ? "" : "s"})
                          </p>
                        )}
                        <p className="mt-2 text-xs font-medium text-brand-400">{NEXT_ACTION[o.stage] ?? o.stage}</p>
                      </Link>
                    );
                  })}
                  {cards.length === 0 && <p className="px-1 py-4 text-center text-xs text-slate-600">—</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
