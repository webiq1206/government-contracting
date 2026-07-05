import Link from "next/link";
import { pipelineOpportunities, PIPELINE_STAGES } from "@/lib/data";
import { PageHeader, ScoreBadge } from "@/components/badges";
import { currency, countdown } from "@/lib/format";
import { integrationStatus } from "@/lib/config";
import type { Opportunity } from "@/lib/types";

export const dynamic = "force-dynamic";

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

export default async function PipelinePage() {
  const opps = await pipelineOpportunities();
  const byStage = new Map<string, Opportunity[]>();
  for (const s of PIPELINE_STAGES) byStage.set(s.key, []);
  for (const o of opps) {
    if (!byStage.has(o.stage)) byStage.set(o.stage, []);
    byStage.get(o.stage)!.push(o);
  }

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title="Pipeline"
        subtitle={`${opps.length} active opportunities. Human-action items in amber.`}
      />
      {opps.length === 0 && <PipelineOnboarding />}
      <div className="scroll-thin flex-1 overflow-x-auto p-4">
        <div className="flex h-full gap-3" style={{ minWidth: "max-content" }}>
          {PIPELINE_STAGES.map((stage) => {
            const cards = byStage.get(stage.key) ?? [];
            return (
              <div key={stage.key} className="flex w-72 flex-col">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-sm font-semibold text-slate-800">{stage.label}</span>
                  <span className="badge bg-slate-200 text-slate-600">{cards.length}</span>
                </div>
                <div className="scroll-thin flex-1 space-y-2 overflow-y-auto pr-1">
                  {cards.map((o) => (
                    <Link
                      key={o.id}
                      href={`/opportunity/${o.id}`}
                      className={`card card-hover block ${
                        o.human_action_required ? "border-review/60 bg-review/5" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-2 text-sm font-medium text-slate-900">
                          {o.title ?? "Untitled"}
                        </p>
                        <ScoreBadge score={o.score} />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
                        <span>{currency(o.value_estimated)}</span>
                        <span className={countdown(o.deadline) === "overdue" ? "text-risk" : ""}>
                          ⏱ {countdown(o.deadline)}
                        </span>
                      </div>
                      {o.agency && (
                        <p className="mt-1 truncate text-xs text-slate-500">{o.agency}</p>
                      )}
                      <p className="mt-2 text-xs font-medium text-accent">
                        {NEXT_ACTION[o.stage] ?? o.stage}
                      </p>
                    </Link>
                  ))}
                  {cards.length === 0 && (
                    <p className="px-1 py-4 text-center text-xs text-slate-400">—</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Empty-pipeline onboarding banner. A first-time operator lands on 11 blank
 * columns with no explanation — this replaces the em-dash silence with a
 * concrete "what to do next" tied to which integrations are missing.
 */
function PipelineOnboarding() {
  const st = integrationStatus();
  const missing: string[] = [];
  if (!st.sam) missing.push("SAM.gov (opportunity ingestion)");
  if (!st.claude) missing.push("Anthropic (scoring + bid briefs)");
  if (!st.googleMaps) missing.push("Google Maps (subcontractor discovery)");
  if (!st.gmail) missing.push("Gmail (outreach + reply tracking)");

  return (
    <div className="mx-6 mt-4 rounded-md border border-accent/40 bg-accent-soft p-5">
      <p className="eyebrow mb-1 text-accent-strong">Get started</p>
      <h2 className="font-serif text-xl font-semibold text-foreground">
        Your pipeline is empty — that&rsquo;s expected on a fresh setup.
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
        Opportunities flow in from the Opportunity Monitor (SAM.gov, every 2 hours) and are
        scored, briefed, and routed through the 11 stages you see here automatically. Add the
        integration keys below in your deployment secrets, then the pipeline will start filling
        itself.
      </p>
      {missing.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm">
          {missing.map((m) => (
            <li key={m} className="flex items-start gap-2 text-slate-300">
              <span className="mt-0.5 text-accent">•</span>
              <span>{m}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <Link href="/settings/integrations" className="btn-primary">
          Review integrations
        </Link>
        <Link href="/settings/profile" className="btn-ghost">
          Adjust automation settings
        </Link>
      </div>
    </div>
  );
}
