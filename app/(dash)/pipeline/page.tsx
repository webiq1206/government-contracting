import Link from "next/link";
import {
  pipelineOpportunities,
  PIPELINE_STAGES,
  opportunityTable,
  opportunityTableCount,
  oppPeek,
  OPP_SORTS,
} from "@/lib/data";
import { FilterToolbar } from "@/components/filter-toolbar";
import { ownersFor } from "@/lib/ownership";
import { tradeCoverageFor, type TradeCoverage } from "@/lib/data";
import type { Owner } from "@/lib/domain/ownership";
import { AgencyPath } from "@/components/agency-path";
import { OpportunityList } from "@/components/opportunity-list";
import {
  BlockerChip,
  ConfidenceChip,
  CoverageChip,
  OwnerChip,
} from "@/components/opportunity-facts";
import { currentUser } from "@/lib/auth";
import { OpportunitiesTable } from "@/components/opportunities-table";
import {
  parseFilters,
  parseSort,
  parsePaging,
  buildQuery,
  serializeSort,
  type FilterSpec,
} from "@/lib/domain/table-view";
import { ScoreBadge } from "@/components/badges";
import { PageFrame } from "@/components/page-frame";
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
import { focusSet } from "@/lib/domain/pipeline-focus";
import { CALL_STAGE } from "@/lib/domain/call-step";
import { SwipeRail } from "@/components/swipe-rail";
import { agentCadence } from "@/lib/agent-cadence";
import { RememberedView } from "@/components/remembered-view";
import { CardPreview } from "@/components/card-preview";
import type { AutomationRules } from "@/lib/domain/intake";
import type { Opportunity } from "@/lib/types";
import { OppPeek } from "@/components/opp-peek";

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

/**
 * Filters for the table view.
 *
 * The board answers "what is the state of this job"; these answer the
 * questions the board cannot: what is due this week, what have we got in
 * Texas, which scores rest on a value nobody published.
 */
const TABLE_SPECS: FilterSpec[] = [
  { key: "q", label: "Search", kind: "text", placeholder: "Title, number, or agency" },
  {
    key: "stage",
    label: "Stage",
    kind: "select",
    placeholder: "Any",
    options: PIPELINE_STAGES.map((s) => ({ value: s.key, label: s.label })),
  },
  {
    key: "tier",
    label: "Tier",
    kind: "select",
    placeholder: "Any",
    options: [
      { value: "pursue", label: "Pursue" },
      { value: "review", label: "Review" },
      { value: "dismiss", label: "Dismiss" },
    ],
  },
  { key: "state", label: "State", kind: "text", placeholder: "TX", upper: true },
  { key: "agency", label: "Agency", kind: "text", placeholder: "e.g. GSA" },
  { key: "naics", label: "NAICS", kind: "text", placeholder: "238210" },
  { key: "setAside", label: "Set-aside", kind: "text", placeholder: "e.g. SDVOSB" },
  {
    key: "due",
    label: "Due within (days)",
    kind: "min",
    min: 1,
    max: 365,
    hint: "Only opportunities with a deadline inside this window.",
  },
  { key: "minScore", label: "Min score", kind: "min", min: 0, max: 100 },
  {
    key: "value",
    label: "Contract value",
    kind: "select",
    placeholder: "Any",
    hint: "Most federal notices publish no value. Unknown is not zero.",
    options: [
      { value: "known", label: "Published" },
      { value: "unknown", label: "Not published" },
    ],
  },
  {
    key: "confidence",
    label: "Data confidence",
    kind: "select",
    placeholder: "Any",
    hint: "How much of the score rests on facts the notice actually stated. A 78 on a full solicitation and a 78 on a title are the same number and opposite instructions.",
    options: [
      { value: "high", label: "High" },
      { value: "medium", label: "Medium" },
      { value: "low", label: "Low" },
    ],
  },
  {
    key: "valueMin",
    label: "Value from",
    kind: "min",
    min: 0,
    hint: "Published values only. An unknown value is not a small one.",
  },
  { key: "valueMax", label: "Value to", kind: "min", min: 0 },
  {
    key: "readiness",
    label: "Submission readiness",
    kind: "select",
    placeholder: "Any",
    options: [
      { value: "ready", label: "Package validated" },
      { value: "not_ready", label: "Not validated" },
    ],
  },
  {
    key: "owner",
    label: "Owner",
    kind: "select",
    placeholder: "Anyone",
    options: [
      { value: "mine", label: "On me" },
      { value: "unassigned", label: "Unassigned" },
    ],
  },
  { key: "needsMe", label: "Waiting on me", kind: "boolean" },
  {
    key: "blocked",
    label: "Has a blocker",
    kind: "boolean",
    hint: "Automation stopped on these and named what it could not resolve.",
  },
  {
    key: "uncovered",
    label: "Uncovered trades",
    kind: "boolean",
    hint: "A required trade nobody has quoted yet.",
  },
  {
    key: "closed",
    label: "Include closed",
    kind: "boolean",
    hint: "Dismissed and archived records, hidden by default.",
  },
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

export default async function PipelinePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const rawView = typeof searchParams?.view === "string" ? searchParams.view : undefined;
  /*
   * Four views, and one of them is the default on a phone.
   *
   * The brief names three: a table for volume, a board for stage movement,
   * and a compact list that is what a phone gets. The fourth, lanes, is this
   * product's own grouping by whose turn it is, and it stays because it is
   * what the page opens on for somebody at a desk.
   *
   * "Which is the default" cannot be answered on the server, which does not
   * know the viewport. So the default renders as the compact list below the
   * board's breakpoint and as lanes above it, and an explicit choice is
   * honoured at every width.
   */
  const view =
    rawView === "stages"
      ? "stages"
      : rawView === "table"
        ? "table"
        : rawView === "list"
          ? "list"
          : "lanes";

  const [allOpps, rules] = await Promise.all([pipelineOpportunities(), getAutomationRules()]);

  /*
   * The table is fetched separately, filtered and paged in SQL, rather than
   * slicing the board's own five-hundred-row load. Past a hundred cards the
   * board is already the wrong tool; sending five hundred rows so the browser
   * can hide most of them would make the alternative no better.
   */
  const tableValues = view === "table" ? parseFilters(TABLE_SPECS, searchParams ?? {}) : {};
  const tableSort = parseSort(searchParams ?? {}, Object.keys(OPP_SORTS));
  const tableFilters = {
    q: tableValues.q,
    stage: tableValues.stage,
    tier: tableValues.tier,
    state: tableValues.state,
    agency: tableValues.agency,
    naics: tableValues.naics,
    setAside: tableValues.setAside,
    dueDays: tableValues.due != null ? Number(tableValues.due) : undefined,
    minScore: tableValues.minScore != null ? Number(tableValues.minScore) : undefined,
    value: tableValues.value as "known" | "unknown" | undefined,
    needsMe: tableValues.needsMe === "1",
    includeClosed: tableValues.closed === "1",
    confidence: tableValues.confidence as "high" | "medium" | "low" | undefined,
    valueMin: tableValues.valueMin != null ? Number(tableValues.valueMin) : undefined,
    valueMax: tableValues.valueMax != null ? Number(tableValues.valueMax) : undefined,
    blocked: tableValues.blocked === "1",
    uncovered: tableValues.uncovered === "1",
    readiness: tableValues.readiness as "ready" | "not_ready" | undefined,
    owner: tableValues.owner as "mine" | "unassigned" | undefined,
    /*
     * Read before the table is queried, because "on me" needs to know who is
     * looking. Without it the filter would match nothing and the page would
     * say this operator owns none of the pipeline.
     */
    viewerId: (await currentUser().catch(() => null))?.id,
  };
  const tableTotal = view === "table" ? await opportunityTableCount(tableFilters) : 0;

  /*
   * The peek is a query parameter for the same reasons the conversation
   * centre's selection is: back button, shareable link, and one place that
   * decides what is open. An id that is not this org's returns nothing and the
   * table renders without a drawer.
   */
  const peekId = typeof searchParams?.peek === "string" ? searchParams.peek : null;
  const peeked = peekId ? await oppPeek(peekId) : null;

  const peekQuery = (() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams ?? {})) {
      if (k === "peek" || v == null) continue;
      if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
      else p.set(k, v);
    }
    return p;
  })();
  const closePeekHref = peekQuery.toString()
    ? `/pipeline?${peekQuery.toString()}`
    : "/pipeline";
  const peekBase = peekQuery.toString()
    ? `/pipeline?${peekQuery.toString()}&`
    : "/pipeline?";
  const tablePaging = parsePaging(searchParams ?? {}, tableTotal);

  /*
   * What this page remembers between visits: the view somebody chose and, in
   * the table view, their filters, sort and page size.
   *
   * The filter bar cannot own this on its own, because it is only mounted in
   * one of the three views: an operator working in the table left, came back
   * through the sidebar, and landed in the lanes board with their filters
   * gone. Built from the parsed values rather than the address bar, so the
   * quick-look drawer is never stored and never reopened later.
   */
  const rememberedQuery = (() => {
    const p = new URLSearchParams(
      view === "table"
        ? buildQuery({
            filters: tableValues,
            sort: tableSort.key ? tableSort : undefined,
            page: tablePaging.page,
            perPage: tablePaging.perPage,
          })
        : ""
    );
    if (view !== "lanes") p.set("view", view);
    return p.toString();
  })();
  const tableRows =
    view === "table"
      ? await opportunityTable(tableFilters, {
          sort: tableSort.key ?? undefined,
          direction: tableSort.direction,
          limit: tablePaging.perPage,
          offset: tablePaging.offset,
        })
      : [];
  /*
   * Owners for the page in one query, and who is reading.
   *
   * Not per row: this table draws up to two hundred, and a lookup per row is
   * the shape that turns a fast page into a slow one without anybody changing
   * the page.
   */
  const [tableOwners, viewer] = await Promise.all([
    tableRows.length > 0
      ? ownersFor("opportunity", tableRows.map((r) => r.id)).catch(() => new Map())
      : Promise.resolve(new Map()),
    currentUser().catch(() => null),
  ]);
  /**
   * Counts elsewhere in the product are clickable, and they land here. The
   * slice comes either from a named set (the Today rail's "In pursuit") or a
   * single stage (its bar chart), and both filter to exactly what was
   * counted, because the stage lists live in one module.
   */
  const focus = focusSet(typeof searchParams?.focus === "string" ? searchParams.focus : undefined);
  const rawStage = typeof searchParams?.stage === "string" ? searchParams.stage : undefined;
  const focusStage =
    rawStage && PIPELINE_STAGES.some((s) => s.key === rawStage) ? rawStage : null;
  const focusStages = focus ? focus.stages : focusStage ? [focusStage] : null;
  const opps = focusStages ? allOpps.filter((o) => focusStages.includes(o.stage)) : allOpps;
  const focusLabel = focus
    ? focus.label
    : focusStage
      ? (PIPELINE_STAGES.find((s) => s.key === focusStage)?.label ?? focusStage)
      : null;
  const focusBlurb = focus?.blurb ?? null;
  // An email-only account has no call step, so the board does not draw a
  // column for it. The column comes back if any record is actually still in
  // that stage, because a board that hides a record is worse than a board
  // with an extra column.
  const stillCalling = opps.some((o) => o.stage === CALL_STAGE);
  const stages = PIPELINE_STAGES.filter(
    (s) => rules.calls_enabled || stillCalling || s.key !== CALL_STAGE
  );
  /*
   * Coverage and owners for the cards, in two queries for the whole board
   * rather than two per card. A board can be a hundred cards, and per-card
   * lookups are the shape that turns a fast page into a slow one without
   * anybody changing the page.
   */
  const [boardCoverage, boardOwners] = await Promise.all([
    opps.length > 0
      ? tradeCoverageFor(opps.map((o) => o.id)).catch(() => new Map<string, TradeCoverage>())
      : Promise.resolve(new Map<string, TradeCoverage>()),
    opps.length > 0
      ? ownersFor("opportunity", opps.map((o) => o.id)).catch(() => new Map<string, Owner>())
      : Promise.resolve(new Map<string, Owner>()),
  ]);

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
      <RememberedView
        storageKey="brostco.opportunities.views"
        pathname="/pipeline"
        query={rememberedQuery}
        label="Showing the view you left here."
      />
      <PageFrame
        help={PAGE_HELP["pipeline"]}
        title="Opportunities"
        status={
          focusLabel
            ? `${focusLabel}: ${opps.length}`
            : opps.length === 0
              ? "Empty"
              : `${opps.length} active · ${(byLane.get("you") ?? []).length} need you`
        }
        explanation={
          focusLabel
            ? (focusBlurb ??
              `Only opportunities at the ${focusLabel.toLowerCase()} stage.`)
            : view === "lanes"
              ? "Grouped by whose turn it is. Start with Needs you."
              : "Full stage board. Amber cards wait on you; the rest run automatically."
        }
        primaryAction={
          <>
        {focusLabel && (
          <Link href="/pipeline?view=lanes" className="btn-ghost text-xs">
            Show all ({allOpps.length})
          </Link>
        )}
        <div className="flex gap-1 rounded-md border border-border p-0.5">
          {/*
            * Explicit rather than the bare path: this page now puts back the
            * view you left, so a link to /pipeline would be restored to
            * whatever that was and choosing Simple would appear not to work.
            */}
          <Link
            href="/pipeline?view=lanes"
            className={`inline-flex min-h-11 items-center rounded px-3 py-2 text-xs lg:min-h-0 lg:px-2.5 lg:py-1 ${view === "lanes" ? "bg-accent-soft font-medium text-accent-strong" : "text-slate-500 hover:text-foreground"}`}
          >
            Simple
          </Link>
          <Link
            href="/pipeline?view=list"
            className={`inline-flex min-h-11 items-center rounded px-3 py-2 text-xs lg:min-h-0 lg:px-2.5 lg:py-1 ${view === "list" ? "bg-accent-soft font-medium text-accent-strong" : "text-slate-500 hover:text-foreground"}`}
          >
            List
          </Link>
          <Link
            href="/pipeline?view=stages"
            className={`inline-flex min-h-11 items-center rounded px-3 py-2 text-xs lg:min-h-0 lg:px-2.5 lg:py-1 ${view === "stages" ? "bg-accent-soft font-medium text-accent-strong" : "text-slate-500 hover:text-foreground"}`}
          >
            All stages
          </Link>
          <Link
            href="/pipeline?view=table"
            className={`inline-flex min-h-11 items-center rounded px-3 py-2 text-xs lg:min-h-0 lg:px-2.5 lg:py-1 ${view === "table" ? "bg-accent-soft font-medium text-accent-strong" : "text-slate-500 hover:text-foreground"}`}
          >
            Table
          </Link>
        </div>
          </>
        }
      />
      {view === "table" && (
        <>
          <FilterToolbar
            pathname="/pipeline"
            specs={TABLE_SPECS}
            values={{ ...tableValues, view: "table" }}
            sortParam={serializeSort(tableSort)}
            perPage={tablePaging.perPage}
            viewsKey="brostco.opportunities.views"
            /* The page remembers the view and the filters together, because
               the view outlives this bar: it is only mounted in the table. */
            remember={false}
            /* None is a count too. See the note on the Subcontractors page. */
            resultLabel={
              tableTotal > 0
                ? `Showing ${tablePaging.from}-${tablePaging.to} of ${tableTotal}`
                : Object.keys(tableValues).length > 0
                  ? "No opportunities match these filters"
                  : "No opportunities yet"
            }
          />
          <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="scroll-thin min-w-0 flex-1 overflow-auto p-4">
            <OpportunitiesTable
              peekBase={peekBase}
              owners={tableOwners}
              viewerId={viewer?.id}
              rows={tableRows}
              total={tableTotal}
              filters={tableValues}
              sort={tableSort}
              paging={tablePaging}
              rules={rules}
              emptyState={
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {Object.keys(tableValues).length > 0
                    ? "No opportunities match these filters."
                    : "No opportunities yet."}
                </p>
              }
            />
          </div>
          {peeked && <OppPeek data={peeked} closeHref={closePeekHref} />}
          </div>
        </>
      )}

      {view !== "table" && opps.length === 0 && <PipelineOnboarding />}

      {/* Simple view: four owner lanes. A grid from md up; on a phone the same
          four lanes stay side by side and are swiped between, because a lane
          is a place in the pipeline and stacking them loses that. */}
      {(view === "list" || view === "lanes") && opps.length > 0 && (
        <div
          className={
            view === "list"
              ? "scroll-thin min-h-0 flex-1 overflow-y-auto p-4"
              : // The default view's phone rendering. A compact list rather
                // than a swipe rail of columns: a rail asks somebody to
                // discover four horizontal panes to see their own work.
                "scroll-thin min-h-0 flex-1 overflow-y-auto p-4 md:hidden"
          }
        >
          <OpportunityList
            rows={opps}
            rules={rules}
            coverage={boardCoverage}
            owners={boardOwners}
            viewerId={viewer?.id}
            nextAction={NEXT_ACTION}
          />
        </div>
      )}

      {/*
        The lanes rail that used to live here is gone.
        On a phone the default view is the compact list above: a rail asks
        somebody to discover three more horizontal panes before they can see
        their own work, which is the information being present without being
        reachable. The stages board keeps its rail, because moving a card
        between stages is what that view is for and the columns are the point.
      */}
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
                      <PipelineCard
                      key={o.id}
                      o={o}
                      rules={rules}
                      coverage={boardCoverage.get(o.id)}
                      owner={boardOwners.get(o.id) ?? null}
                      viewerId={viewer?.id}
                    />
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
                      <PipelineCard
                        o={o}
                        rules={rules}
                        coverage={boardCoverage.get(o.id)}
                        owner={boardOwners.get(o.id) ?? null}
                        viewerId={viewer?.id}
                      />
                    </DraggableCard>
                  ))}
                  {cards.length === 0 && (
                    <p className="px-1 py-4 text-center text-xs text-slate-500">
                      Nothing at this stage.
                    </p>
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
                  <PipelineCard
                      key={o.id}
                      o={o}
                      rules={rules}
                      coverage={boardCoverage.get(o.id)}
                      owner={boardOwners.get(o.id) ?? null}
                      viewerId={viewer?.id}
                    />
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
          {/* h2, not h3: this is the first heading under the page title, and
              jumping a level is how a screen-reader user loses the outline
              they navigate by. */}
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
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
function PipelineCard({
  o,
  rules,
  coverage,
  owner,
  viewerId,
}: {
  o: Opportunity;
  rules?: AutomationRules;
  coverage?: TradeCoverage;
  owner?: Owner | null;
  viewerId?: string;
}) {
  return (
    <CardPreview opportunityId={o.id}>
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
      {o.agency && (
        <p className="mt-1 truncate text-xs text-slate-500">
          <AgencyPath agency={o.agency} subAgency={o.sub_agency} />
        </p>
      )}
      {/*
        The five facts that were not here. Each of them says whether the
        number above it can be trusted: a 78 scored from a title, a bid whose
        trades nobody has priced, and a record nobody has picked up all looked
        exactly like their opposites.
      */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <ConfidenceChip breakdown={o.score_breakdown} />
        <CoverageChip coverage={coverage} />
        <OwnerChip owner={owner} viewerId={viewerId} />
        <BlockerChip flags={o.risk_flags} />
      </div>
      <p className="mt-2 text-xs font-semibold text-accent-strong">
        {NEXT_ACTION[o.stage] ?? o.stage}
        <span className="ml-1 font-medium text-gold-text">Open ↗</span>
      </p>
    </Link>
    </CardPreview>
  );
}

/**
 * Empty-pipeline onboarding banner. A first-time operator lands on 11 blank
 * columns with no explanation, this replaces the em-dash silence with a
 * concrete "what to do next" tied to which integrations are missing.
 */
async function PipelineOnboarding() {
  await hydrateIntegrationEnv();
  // Read from the registry rather than typed into the sentence below, which
  // is how this paragraph came to promise a two-hourly poll for months after
  // the schedule moved to three.
  const cadence = agentCadence("opportunity-monitor");
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
        Opportunities flow in from the Opportunity Monitor (SAM.gov,{" "}
        {cadence ? cadence.toLowerCase() : "on a schedule"}) and are
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
