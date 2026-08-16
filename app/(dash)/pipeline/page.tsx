import Link from "next/link";
import { pipelineOpportunities, PIPELINE_STAGES } from "@/lib/data";
import { PageHeader, ScoreBadge } from "@/components/badges";
import { PipelineCardMenu } from "@/components/pipeline-card-menu";
import { DraggableCard, StageDropColumn } from "@/components/pipeline-dnd";
import { stageMode } from "@/lib/stage-meta";
import { PAGE_HELP } from "@/lib/help-content";
import { integrationStatus } from "@/lib/config";
import { hydrateIntegrationEnv } from "@/lib/integration-settings";
import { DeadlineBadge } from "@/components/deadline-badge";
import { EstimatedValue } from "@/components/estimated-value";
import { getAutomationRules } from "@/lib/app-settings";
import { laneFor, type LaneKey } from "@/lib/domain/pipeline-lanes";
import { CALL_STAGE } from "@/lib/domain/call-step";
import { SwipeRail } from "@/components/swipe-rail";
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
  // An email-only account has no call step, so the board does not draw a
  // column for it. The column comes back if any record is actually still in
  // that stage, because a board that hides a record is worse than a board
  // with an extra column.
  const stillCalling = opps.some((o) => o.stage === CALL_STAGE);
  const stages = PIPELINE_STAGES.filter(
    (s) => rules.calls_enabled || stillCalling || s.key !== CALL_STAGE
  );
  const byStage = new Map<string, Opportunity[]>();
  for (const s of stages) byStage.set(s.key, []);
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

      {/* Simple view: four owner lanes. A grid from md up; on a phone the same
          four lanes stay side by side and are swiped between, because a lane
          is a place in the pipeline and stacking them loses that. */}
      {view === "lanes" && opps.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col md:hidden">
          <SwipeRail
            ariaLabel="Pipeline lanes"
            items={LANES.map((lane) => ({
              key: lane.key,
              label: lane.label,
              count: (byLane.get(lane.key) ?? []).length,
              attention: lane.key === "you",
            }))}
          >
            {LANES.map((lane) => {
              const cards = byLane.get(lane.key) ?? [];
              return (
                <MobileColumn
                  key={lane.key}
                  title={lane.label}
                  blurb={lane.blurb}
                  count={cards.length}
                >
                  {cards.map((o) => (
                    <PipelineCard key={o.id} o={o} rules={rules} />
                  ))}
                </MobileColumn>
              );
            })}
          </SwipeRail>
        </div>
      )}
      {view === "lanes" && opps.length > 0 && (
        <div className="scroll-thin hidden flex-1 overflow-y-auto p-4 md:block">
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
          {stages.map((stage) => {
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
                {/* Drop target wraps the scroll area so an empty column is
                    still droppable. Dragging is pointer-only; touch uses the
                    card menu's Move-to chips, one code path server-side. */}
                <StageDropColumn stage={stage.key}>
                <div className="scroll-thin flex-1 space-y-2 overflow-y-auto pr-1">
                  {cards.map((o) => (
                    <DraggableCard key={o.id} opportunityId={o.id}>
                      <PipelineCard o={o} rules={rules} />
                    </DraggableCard>
                  ))}
                  {cards.length === 0 && (
                    <p className="px-1 py-4 text-center text-xs text-slate-500">-</p>
                  )}
                </div>
                </StageDropColumn>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile: the same board, swiped rather than stacked. Every stage is
          kept, in order, so the pipeline still reads as a pipeline and the
          chip rail can jump to the far end in one tap. */}
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <SwipeRail
          ariaLabel="Pipeline"
          items={stages.map((stage) => ({
            key: stage.key,
            label: stage.label,
            count: (byStage.get(stage.key) ?? []).length,
            attention: stageMode(stage.key) === "you",
          }))}
        >
          {stages.map((stage) => {
            const cards = byStage.get(stage.key) ?? [];
            return (
              <MobileColumn
                key={stage.key}
                title={stage.label}
                blurb={NEXT_ACTION[stage.key]}
                count={cards.length}
                badge={
                  stageMode(stage.key) === "you"
                    ? "bg-review/15 text-review"
                    : "bg-muted text-muted-foreground"
                }
                badgeLabel={stageMode(stage.key) === "you" ? "Needs you" : "Automatic"}
              >
                {cards.map((o) => (
                  <PipelineCard key={o.id} o={o} rules={rules} />
                ))}
              </MobileColumn>
            );
          })}
        </SwipeRail>
      </div>
      </>
      )}
    </div>
  );
}

/**
 * One column of the mobile rail.
 *
 * The heading sits outside the scrolling list rather than inside it, so the
 * stage stays named while its cards scroll, and the cards scroll within the
 * column instead of growing the page. An empty stage still gets a column: a
 * gap in the pipeline is information, and hiding it would make the swipe order
 * differ from the board's.
 */
function MobileColumn({
  title,
  blurb,
  count,
  badge,
  badgeLabel,
  children,
}: {
  title: string;
  blurb?: string;
  count: number;
  badge?: string;
  badgeLabel?: string;
  children: React.ReactNode;
}) {
  return (
    // One element, not a fragment. SwipeRail pairs children to stages by
    // index, and Children.toArray flattens a fragment into its parts, which
    // turned every column into two: a full-width header column and a separate
    // card column, each clipped at the snap edge.
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 shrink-0 pb-1">
        <div className="flex items-baseline gap-2">
          <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
          <span className="num text-xs text-muted-foreground">{count}</span>
          {badgeLabel && <span className={`badge ml-auto ${badge}`}>{badgeLabel}</span>}
        </div>
        {blurb && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{blurb}</p>
        )}
      </div>
      <div className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto pb-2">
        {count === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            Nothing here right now.
          </p>
        ) : (
          children
        )}
      </div>
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
