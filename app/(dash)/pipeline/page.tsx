import Link from "next/link";
import { pipelineOpportunities, PIPELINE_STAGES } from "@/lib/data";
import { PageHeader, ScoreBadge } from "@/components/badges";
import { PipelineCardMenu } from "@/components/pipeline-card-menu";
import { stageMode } from "@/lib/stage-meta";
import { PAGE_HELP } from "@/lib/help-content";
import { integrationStatus } from "@/lib/config";
import { hydrateIntegrationEnv } from "@/lib/integration-settings";
import { DeadlineBadge } from "@/components/deadline-badge";
import { EstimatedValue } from "@/components/estimated-value";
import { getAutomationRules } from "@/lib/app-settings";
import { laneFor, type LaneKey } from "@/lib/domain/pipeline-lanes";
import type { AutomationRules } from "@/lib/domain/intake";
import type { Opportunity } from "@/lib/types";

/**
 * The simple (default) pipeline view groups by who the ball is with rather
 * than by internal stage: three lanes an operator actually thinks in, plus
 * recently decided. The full 11-stage board stays one click away.
 */
const LANES: { key: LaneKey; label: string; blurb: string; badge: string }[] = [
  {
    key: "you",
    label: "Needs you",
    blurb: "Decisions, calls, quotes, and sign-offs only a person can do.",
    badge: "bg-review/15 text-review",
  },
  {
    key: "system",
    label: "Brost Co is working",
    blurb: "Scoring, analysis, and research running on their own.",
    badge: "bg-slate-200 text-slate-600",
  },
  {
    key: "waiting",
    label: "Waiting on others",
    blurb: "Subcontractor replies and agency award decisions.",
    badge: "bg-slate-200 text-slate-600",
  },
  {
    key: "decided",
    label: "Recently decided",
    blurb: "Won and lost. Wins move on to Contracts.",
    badge: "bg-pursue/10 text-pursue",
  },
];

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

export default async function PipelinePage({
  searchParams,
}: {
  searchParams?: { view?: string };
}) {
  const [opps, rules] = await Promise.all([pipelineOpportunities(), getAutomationRules()]);
  const view = searchParams?.view === "stages" ? "stages" : "lanes";
  const byStage = new Map<string, Opportunity[]>();
  for (const s of PIPELINE_STAGES) byStage.set(s.key, []);
  for (const o of opps) {
    if (!byStage.has(o.stage)) byStage.set(o.stage, []);
    byStage.get(o.stage)!.push(o);
  }
  const byLane = new Map<LaneKey, Opportunity[]>(LANES.map((l) => [l.key, []]));
  for (const o of opps) byLane.get(laneFor(o))!.push(o);

  return (
    <div className="flex page-shell">
      <PageHeader
        help={PAGE_HELP["pipeline"]}
        title="Opportunities"
        status={
          opps.length === 0
            ? "Empty"
            : `${opps.length} active · ${(byLane.get("you") ?? []).length} need you`
        }
        subtitle={
          view === "lanes"
            ? "Grouped by whose turn it is. Start with Needs you."
            : "Full stage board. Amber cards wait on you; the rest run automatically."
        }
      >
        <div className="flex gap-1 rounded-md border border-border p-0.5">
          <Link
            href="/pipeline"
            className={`inline-flex min-h-10 items-center rounded px-3 py-2 text-xs md:min-h-0 md:px-2.5 md:py-1 ${view === "lanes" ? "bg-accent-soft font-medium text-accent-strong" : "text-slate-500 hover:text-foreground"}`}
          >
            Simple
          </Link>
          <Link
            href="/pipeline?view=stages"
            className={`inline-flex min-h-10 items-center rounded px-3 py-2 text-xs md:min-h-0 md:px-2.5 md:py-1 ${view === "stages" ? "bg-accent-soft font-medium text-accent-strong" : "text-slate-500 hover:text-foreground"}`}
          >
            All stages
          </Link>
        </div>
      </PageHeader>
      {opps.length === 0 && <PipelineOnboarding />}

      {/* Simple view: four owner lanes, no horizontal scrolling on desktop. */}
      {view === "lanes" && opps.length > 0 && (
        <div className="scroll-thin flex-1 overflow-y-auto p-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {LANES.map((lane) => {
              const cards = byLane.get(lane.key) ?? [];
              return (
                <section key={lane.key} className="min-w-0">
                  <div className="mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`badge ${lane.badge}`}>{lane.label}</span>
                      <span className="num text-xs text-slate-500">{cards.length}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{lane.blurb}</p>
                  </div>
                  <div className="space-y-2">
                    {cards.map((o) => (
                      <PipelineCard key={o.id} o={o} rules={rules} />
                    ))}
                    {cards.length === 0 && (
                      <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-slate-500">
                        Nothing here right now.
                      </p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {view === "stages" && (
      <>

      {/* Desktop: horizontal kanban across all stages. */}
      <div className="scroll-thin hidden flex-1 overflow-x-auto p-4 lg:block">
        <div className="flex h-full gap-3" style={{ minWidth: "max-content" }}>
          {PIPELINE_STAGES.map((stage) => {
            const cards = byStage.get(stage.key) ?? [];
            return (
              <div key={stage.key} className="flex w-72 flex-col">
                <div className="mb-2 px-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-800">{stage.label}</span>
                    <span className="badge bg-slate-200 text-slate-600">{cards.length}</span>
                  </div>
                  {stageMode(stage.key) === "you" ? (
                    <span className="badge mt-1 bg-review/15 text-review">Needs you</span>
                  ) : (
                                        <span className="badge mt-1 bg-muted text-muted-foreground">Automatic</span>
                  )}
                </div>
                <div className="scroll-thin flex-1 space-y-2 overflow-y-auto pr-1">
                  {cards.map((o) => (
                    <PipelineCard key={o.id} o={o} rules={rules} />
                  ))}
                  {cards.length === 0 && (
                    <p className="px-1 py-4 text-center text-xs text-slate-500">-</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile: one simple vertical list, grouped by stage, empty stages hidden.
          No sideways scrolling, tap a card to open it, tap its menu to move it. */}
      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto p-4 lg:hidden">
        {PIPELINE_STAGES.filter((s) => (byStage.get(s.key)?.length ?? 0) > 0).map((stage) => {
          const cards = byStage.get(stage.key) ?? [];
          return (
            <section key={stage.key}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-800">{stage.label}</span>
                <span className="badge bg-slate-200 text-slate-600">{cards.length}</span>
                {stageMode(stage.key) === "you" ? (
                  <span className="badge bg-review/15 text-review">Needs you</span>
                ) : (
                  <span className="badge bg-muted text-muted-foreground">Automatic</span>
                )}
              </div>
              <div className="space-y-3">
                {cards.map((o) => (
                  <PipelineCard key={o.id} o={o} rules={rules} />
                ))}
              </div>
            </section>
          );
        })}
        {opps.length > 0 && (
          <p className="pt-2 text-center text-xs text-slate-500">
            That&rsquo;s every active opportunity.
          </p>
        )}
      </div>
      </>
      )}
    </div>
  );
}

/** One opportunity card, shared by the desktop kanban and the mobile list. */
function PipelineCard({ o, rules }: { o: Opportunity; rules?: AutomationRules }) {
  return (
    <Link
      href={`/opportunity/${o.id}`}
      className={`card card-hover block ${
        o.human_action_required ? "focus-rail border-gold/40 bg-gold/[0.04]" : ""
      }`}
    >
      {/* Gold eyebrow label for mobile list cards */}
      <p className="eyebrow mb-2 md:hidden">{NEXT_ACTION[o.stage] ?? o.stage}</p>
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm font-medium text-slate-900">
          {o.title ?? "Untitled"}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <ScoreBadge score={o.score} />
          {o.stage !== "won" && o.stage !== "lost" && (
            <PipelineCardMenu opportunityId={o.id} stage={o.stage} />
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-600">
        <EstimatedValue value={o.value_estimated} source={o.value_estimated_source} />
        <DeadlineBadge deadline={o.deadline} rules={rules} />
      </div>
      {o.agency && <p className="mt-1 truncate text-xs text-slate-500">{o.agency}</p>}
      <p className="mt-2 text-xs font-semibold text-accent-strong">
        {NEXT_ACTION[o.stage] ?? o.stage}
        <span className="ml-1 font-medium text-gold">Open ↗</span>
      </p>
    </Link>
  );
}

/**
 * Empty-pipeline onboarding banner. A first-time operator lands on 11 blank
 * columns with no explanation, this replaces the em-dash silence with a
 * concrete "what to do next" tied to which integrations are missing.
 */
async function PipelineOnboarding() {
  await hydrateIntegrationEnv();
  const st = integrationStatus();
  const missing: string[] = [];
  if (!st.sam) missing.push("SAM.gov (opportunity ingestion)");
  if (!st.claude) missing.push("Anthropic (scoring + bid briefs)");
  if (!st.googleMaps) missing.push("Google Maps (subcontractor discovery)");
  if (!st.gmail) {
    missing.push("Google Inbox (sending outreach and reading replies)");
  }

  return (
    <div className="mx-6 mt-4 rounded-md border border-accent/40 bg-accent-soft p-5">
      <p className="eyebrow mb-1 text-accent-strong">Get started</p>
      <h2 className="font-display text-xl font-semibold text-foreground">
        No opportunities yet. That is expected on a fresh setup.
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500">
        Opportunities flow in from the Opportunity Monitor (SAM.gov, every 2 hours) and are
        scored, briefed, and routed through the 11 stages you see here automatically. Add the
        integration keys below in your deployment secrets, then the pipeline will start filling
        itself.
      </p>
      {missing.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm">
          {missing.map((m) => (
            <li key={m} className="flex items-start gap-2 text-slate-700">
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
