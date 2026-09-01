import Link from "next/link";
import { actionCenter, dailyDigest, type ActionOppRow } from "@/lib/data";
import { readPipelinePulse } from "@/lib/pipeline-pulse";
import { PipelinePulse } from "@/components/pipeline-pulse";
import { PipelineStrip } from "@/components/pipeline-strip";
import { AutomationPausedBanner } from "@/components/automation-control";
import { getAutomationState, getAutomationRules } from "@/lib/app-settings";
import { automationHealth } from "@/lib/automation-status";
import { AutomationBlockerBanner } from "@/components/automation-incidents";
import { SetupChecklist } from "@/components/setup-checklist";
import { workQueue, completedToday, completedTodayItems } from "@/lib/data";
import { parseOwnerFilter, type OwnerFilter } from "@/lib/domain/ownership";
import { PAGE_HELP } from "@/lib/help-content";
import { HelpPopover } from "@/components/help-popover";
import { getActiveProfile } from "@/lib/ai/companyProfile";
import { accountSetup } from "@/lib/setup-facts";
import { flagSummary } from "@/lib/flag-labels";
import { buildWorkLedger, ledgerHeadline, ledgerBreakdown } from "@/lib/domain/work-ledger";
import { stageParty, PARTY_LABEL, STAGE_LABEL } from "@/lib/domain/journey";
import { outreachLabel } from "@/lib/domain/sub-contact";
import { DOC_LABEL } from "@/lib/domain/sub-compliance";
import { DeadlineBadge } from "@/components/deadline-badge";
import { ActionButton } from "@/components/action-button";
import { PassButton } from "@/components/pass-button";
import { SnoozeButton } from "@/components/snooze-button";
import { StopClickPropagation } from "@/components/stop-click-propagation";
import { TodayLive } from "@/components/today-live";
import { TodayGreeting } from "@/components/today-greeting";
import { WorkQueue } from "@/components/work-queue";
import { focusCount } from "@/lib/domain/pipeline-focus";
import { EmptyState } from "@/components/empty-state";
import { SystemStatusPanel } from "@/components/system-status-panel";
import {
  automationStatusItem,
  inboxStatusItem,
  samStatusItem,
} from "@/lib/domain/system-status";
import { gmail } from "@/lib/integrations/gmail";
import { orgHasKey } from "@/lib/integration-keys";
import type { AutomationRules } from "@/lib/domain/intake";
import { currency, shortDate, timeAgo } from "@/lib/format";
import { withGuideQuery } from "@/lib/guide-links";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { TodayBulkCalls } from "@/components/today-bulk-calls";
import { TodayBulkTriage } from "@/components/today-bulk-triage";
import { ReplyReviewList } from "@/components/reply-review-list";
import { TodayCounters, CompletedList, CompletedTodayPanel } from "@/components/today-counters";
import { QueueFilters } from "@/components/queue-filters";
import {
  queueCounts,
  filterWorkItems,
  isCompletedFilter,
  parseQueueFilter,
  parseKindFilter,
  KIND_FILTER_LABEL,
  type WorkKind,
  type QueueFilter,
} from "@/lib/domain/work-queue";

export const dynamic = "force-dynamic";

/**
 * "Today", the guided home page. Answers one question the moment the
 * operator logs in: what should I do next, and why? Everything here is a
 * deep link into the exact place the work happens, ordered by urgency.
 */

const ROW =
  "group flex flex-col gap-3 border-b border-border/55 px-1 py-4 transition-colors hover:bg-muted/40 dark:border-white/10 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-3 sm:gap-y-1.5";

function CtaArrow({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors group-hover:text-gold-text">
      {label}
      <span aria-hidden className="text-gold-text">
        ↗
      </span>
    </span>
  );
}

function OppActionRow({
  o,
  action,
  detail,
  rules,
  inlineTriage = false,
  guideStep,
  category,
  focused = false,
  index,
}: {
  o: ActionOppRow;
  action: string;
  detail?: string;
  rules?: AutomationRules;
  /** Render Pursue/Dismiss right on the row so the decision happens here. */
  inlineTriage?: boolean;
  /** Opens Guide Me focused on this Today bucket when the opportunity loads. */
  guideStep?: string;
  category: string;
  focused?: boolean;
  /** 1-based index for editorial task numbering. */
  index?: number;
}) {
  const party = stageParty(o.stage, { hasBid: o.has_bid });
  const meta = [
    o.value_estimated != null ? currency(o.value_estimated) : null,
    o.agency,
    detail,
  ]
    .filter(Boolean)
    .join(" · ");
  const n = index != null ? String(index).padStart(2, "0") : null;

  return (
    <Link
      href={withGuideQuery(`/opportunity/${o.id}`, {
        step: guideStep,
        focus: "next-step",
      })}
      className={`${ROW} ${focused ? "focus-rail pl-3" : ""}`}
    >
      {n && (
        <span className="font-mono text-[9px] tracking-[0.08em] text-muted-foreground sm:w-8">
          {n}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-gold-text">
          {category}
        </p>
        <p className="mt-1 text-sm font-medium text-foreground sm:truncate">
          {o.title ?? "Untitled opportunity"}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground sm:truncate">{meta}</p>
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end sm:gap-3">
        {party && !inlineTriage && (
          <span
            className={`badge ${
              party === "you"
                ? "bg-pursue/20 text-pursue"
                : "bg-muted text-muted-foreground"
            }`}
          >
            waiting on {PARTY_LABEL[party]}
          </span>
        )}
        <DeadlineBadge deadline={o.deadline} rules={rules} />
        {!inlineTriage && (
          <StopClickPropagation className="inline-flex">
            <SnoozeButton
              kind="opportunity"
              id={o.id}
              className="shell-ghost min-h-11 text-xs lg:min-h-0"
            />
          </StopClickPropagation>
        )}
        {inlineTriage ? (
          <StopClickPropagation className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <SnoozeButton
              kind="opportunity"
              id={o.id}
              className="shell-ghost min-h-11 text-xs lg:min-h-0"
            />
            <ActionButton
              endpoint={`/api/opportunities/${o.id}/action`}
              body={{ action: "pursue" }}
              className="btn-success min-h-11 flex-1 text-xs sm:min-h-0 sm:flex-none"
              toast={{
                message: "Pursued. Analysis and pricing are running.",
              }}
            >
              Pursue opportunity
            </ActionButton>
            <PassButton opportunityId={o.id} title={o.title}>
              Pass on this opportunity
            </PassButton>
            <span className="text-xs font-medium text-gold-text sm:ml-1">Open brief</span>
          </StopClickPropagation>
        ) : (
          <CtaArrow label={action} />
        )}
      </div>
    </Link>
  );
}

function Section({
  id,
  eyebrow,
  title,
  count,
  children,
  defaultOpen = false,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  count?: number;
  children: React.ReactNode;
  /** Only the top-priority section should start open. */
  defaultOpen?: boolean;
}) {
  return (
    /* A section is a surface, not a heading with content loose underneath it.
       These used to render straight onto the page background, so a list of
       calls and the page it sat on were the same colour and the section had
       no edges at all. */
    <details id={id} open={defaultOpen} className="panel group scroll-mt-12 px-4 py-3 sm:px-5 sm:py-4">
      <summary className="flex cursor-pointer list-none items-end justify-between gap-3 border-b border-border/55 dark:border-white/15 pb-3 [&::-webkit-details-marker]:hidden">
        <div>
          <p className="eyebrow-gold">{eyebrow}</p>
          <h2 className="mt-1 font-display text-2xl font-normal text-foreground">
            {title}
            {typeof count === "number" && (
              <span className="num ml-2 text-base font-normal text-muted-foreground">
                ({count} {count === 1 ? "item" : "items"})
              </span>
            )}
          </h2>
        </div>
        <span
          aria-hidden
          className="mb-1 select-none text-lg text-gold-text transition-transform group-open:rotate-45"
        >
          +
        </span>
      </summary>
      <div className="mt-1">{children}</div>
    </details>
  );
}

/**
 * One count in the health rail. A number nobody can act on is decoration, so
 * every row that has anything behind it opens the place that holds it. Zero
 * stays plain text: a link to an empty board teaches the operator that the
 * links lie.
 */
function StatRow({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href: string;
}) {
  if (value <= 0) {
    return (
      <li className="flex justify-between py-2.5">
        <span>{label}</span>
        <span className="num text-foreground">{value}</span>
      </li>
    );
  }
  return (
    <li>
      <Link
        href={href}
        className="group flex min-h-11 items-center justify-between py-2.5 transition-colors hover:text-foreground lg:min-h-0"
      >
        <span className="group-hover:underline group-hover:decoration-gold group-hover:underline-offset-4">
          {label}
        </span>
        <span className="num text-foreground group-hover:text-gold-text">{value}</span>
      </Link>
    </li>
  );
}

function PipelineHealthRail({
  stageCounts,
  totalActions,
  actionHeadline,
  actionBreakdown,
  digestParts,
  callsEnabled,
}: {
  stageCounts: { stage: string; count: number }[];
  totalActions: number;
  /** The ledger's own wording, so this rail cannot phrase the count its own way. */
  actionHeadline: string;
  actionBreakdown: string;
  digestParts: string[];
  /** False on an email-only account: the call stage is not part of the path. */
  callsEnabled: boolean;
}) {
  const byStage = Object.fromEntries(stageCounts.map((s) => [s.stage, s.count]));
  const active = stageCounts.reduce((n, s) => n + s.count, 0);
  // Counted from the same stage lists the board filters on, so clicking a
  // number lands on exactly that number of cards.
  const strongFits = focusCount("in_capture", byStage);
  const inPursuit = focusCount("in_pursuit", byStage);
  const packagesReady = focusCount("packages_ready", byStage);
  /**
   * Real stage distribution, not decoration.
   *
   * These bars were a hardcoded [35, 48, 42, 62, 55, 78, 70] with a cosmetic
   * jitter, sitting under a "Live" badge. On a brand-new account with nothing
   * in the pipeline they drew a healthy upward trend, which is the one thing a
   * dashboard must never do. Now each bar is a real stage, scaled to the
   * busiest one, and an empty pipeline draws nothing.
   */
  const BAR_STAGES: { key: string; label: string }[] = [
    { key: "scoring", label: "Scoring" },
    { key: "analysis", label: "Analysis" },
    { key: "sub_research", label: "Finding subs" },
    { key: "outreach", label: "Outreach" },
    ...(callsEnabled ? [{ key: "call_queue", label: "Calls" }] : []),
    { key: "quote_entry", label: "Quotes" },
    { key: "bid_building", label: "Bid building" },
  ];
  const peak = Math.max(1, ...BAR_STAGES.map((st) => byStage[st.key] ?? 0));
  const bars = BAR_STAGES.map((st) => {
    const count = byStage[st.key] ?? 0;
    return { ...st, count, h: count === 0 ? 0 : Math.max(8, (count / peak) * 100) };
  });

  return (
    <aside className="hidden w-72 shrink-0 lg:block">
      <div className="sticky top-6 space-y-6">
        <div className="shell-panel p-5">
          <div className="flex items-center justify-between">
            <p className="eyebrow-gold">Pipeline health</p>
            <span className="border border-pursue/45 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-pursue">
              Live
            </span>
          </div>
          {/* Every number here is a door. A count you cannot act on is a
              poster; these each open the board filtered to exactly what was
              counted. */}
          <Link href="/pipeline" className="group mt-4 block">
            <p className="font-display text-5xl text-foreground transition-colors group-hover:text-gold-text">
              <span className="num">{active}</span>
            </p>
            <p className="mt-1 text-sm text-foreground/45 group-hover:text-foreground/70">
              active opportunities
            </p>
          </Link>

          {active > 0 ? (
            <div className="mt-6 flex h-24 items-end gap-1.5">
              {bars.map((b) =>
                b.count > 0 ? (
                  <Link
                    key={b.key}
                    href={`/pipeline?stage=${b.key}`}
                    aria-label={`${b.label}: ${b.count}`}
                    title={`${b.label}: ${b.count}`}
                    className="flex-1 rounded-sm bg-gradient-to-t from-gold/25 to-gold/85 transition-opacity hover:opacity-80"
                    style={{ height: `${b.h}%` }}
                  />
                ) : (
                  // Nothing at this stage: a link would lead to an empty board.
                  <div
                    key={b.key}
                    className="flex-1 rounded-sm bg-gradient-to-t from-gold/25 to-gold/85"
                    style={{ height: `${b.h}%` }}
                    title={`${b.label}: 0`}
                  />
                )
              )}
            </div>
          ) : (
            <p className="mt-6 border border-dashed border-border/55 px-3 py-4 text-center text-xs leading-relaxed text-muted-foreground">
              Nothing in the pipeline yet. Opportunities appear here once SAM.gov is
              connected and the first search runs.
            </p>
          )}

          <ul className="mt-6 divide-y divide-border/55 text-sm text-muted-foreground dark:divide-white/10">
            {/* "Needs you" is the action-centre count, which is this page's
                own queue, so it goes to the queue rather than the board. */}
            <StatRow label="Needs you" value={totalActions} href="#queue" />
            <StatRow
              label="In capture"
              value={strongFits}
              href="/pipeline?focus=in_capture"
            />
            <StatRow
              label="In pursuit"
              value={inPursuit}
              href="/pipeline?focus=in_pursuit"
            />
            <StatRow
              label="Packages ready"
              value={packagesReady}
              href="/pipeline?focus=packages_ready"
            />
          </ul>
        </div>

        {totalActions > 0 ? (
          <Link
            href="#queue"
            className="block border border-gold/28 bg-surface-raised px-4 py-3 transition-colors hover:border-gold/60"
          >
            <p className="font-mono text-[8px] uppercase tracking-[0.1em] text-muted-foreground">
              Automation activity
            </p>
            <p className="mt-1 text-sm font-medium text-gold-text">{actionHeadline}</p>
            {/* The number alone invites the question this answers: what ARE
                they? Naming the biggest few costs one line and removes a
                click. */}
            {actionBreakdown && (
              <p className="mt-0.5 text-xs text-muted-foreground">{actionBreakdown}</p>
            )}
          </Link>
        ) : (
          <div className="border border-gold/28 bg-surface-raised px-4 py-3">
            <p className="font-mono text-[8px] uppercase tracking-[0.1em] text-muted-foreground">
              Automation activity
            </p>
            <p className="mt-1 text-sm font-medium text-gold-text">Queue clear</p>
          </div>
        )}

        {digestParts.length > 0 && (
          <Link
            href="/agents"
            className="block shell-panel p-4 text-sm text-foreground/65 transition-colors hover:border-gold/40"
          >
            <p className="eyebrow-gold">Recent activity</p>
            <p className="mt-2 leading-relaxed">{digestParts.join(" · ")}</p>
          </Link>
        )}
      </div>
    </aside>
  );
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const rules = await getAutomationRules();
  const [data, profile, automation, digest, queueItems, pulse, health, done, inbox, samConfigured] = await Promise.all([
    actionCenter({ urgentDays: rules.urgent_days }),
    getActiveProfile(),
    getAutomationState(),
    dailyDigest(),
    /*
     * Still tolerant, but no longer silent. This exact catch hid a query
     * referencing a column that has never existed (`cc.trade`), so the work
     * queue -- the one list of everything waiting on a person, and the point
     * of this page -- rendered as absent rather than as broken, with nothing
     * anywhere saying why.
     */
    workQueue().catch((e) => {
      console.error("[today] work queue failed to load:", e);
      return [];
    }),
    readPipelinePulse().catch(() => []),
    automationHealth().catch(() => null),
    /*
     * Not tolerant of a silent failure either, but a broken count is worth
     * less than a broken queue: a zero here reads as "nothing done yet",
     * which is a real state, so it is logged and the page still renders.
     */
    completedToday().catch((e) => {
      console.error("[today] completed-today count failed:", e);
      return { calls: 0, quotes: 0, bidsSubmitted: 0, decisions: 0, complianceResolved: 0, total: 0 };
    }),
    gmail.connection().catch(() => ({
      connected: false,
      email: null,
      status: "none",
      lastError: null,
    })),
    orgHasKey("SAM_API_KEY").catch(() => false),
  ]);

  /*
   * The filters, read from the URL. Counts are always over the whole queue,
   * never over the filtered view: a counter that changes when a filter is
   * applied is describing the filter.
   */
  const queueQ = (() => {
    const raw = searchParams?.q;
    return (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  })();
  const queueBucket: QueueFilter = parseQueueFilter(searchParams?.due);
  /*
   * Whose work to show.
   *
   * "On me" is the read an operator on a team wants first thing, and until
   * this existed the page could only answer "what is on this company", which
   * on a five-person account is a list where each person's own eight items are
   * mixed into forty.
   */
  const queueOwner: OwnerFilter = parseOwnerFilter(searchParams?.owner);
  /*
   * Who is looking. Needed before the queue is filtered, because "on me" has
   * no meaning without it, and read once here rather than twice: the setup
   * checklist below wants the same person.
   */
  const { currentUser } = await import("@/lib/auth");
  const viewer = await currentUser().catch(() => null);
  const queueKind: WorkKind | null = parseKindFilter(searchParams?.kind);
  const counts = queueCounts(queueItems);
  const kindCounts = (Object.keys(KIND_FILTER_LABEL) as WorkKind[]).reduce(
    (acc, k) => {
      acc[k] = queueItems.filter((i) => i.kind === k).length;
      return acc;
    },
    {} as Record<WorkKind, number>
  );
  /*
   * The one filter served from somewhere else.
   *
   * Completed today is a cut of the same list from the operator's side, and
   * the queue cannot answer it: the queue is what is left. So it comes from
   * the ledger of what happened, and filterWorkItems refuses it outright
   * rather than returning an empty array that would read as a day on which
   * nothing was finished.
   */
  const showingCompleted = isCompletedFilter(queueBucket);
  const completedItems = showingCompleted
    ? await completedTodayItems().catch((e) => {
        console.error("[today] completed-today list failed:", e);
        return null;
      })
    : [];
  const shownQueue = showingCompleted
    ? []
    : filterWorkItems(queueItems, {
        bucket: queueBucket,
        kind: queueKind,
        q: queueQ,
        owner: queueOwner,
        viewerId: viewer?.id,
      });
  const queueFiltered = queueBucket !== "all" || queueKind != null || queueQ !== "";

  function queueHref(
    opts: { bucket?: QueueFilter; kind?: WorkKind | null; q?: string; owner?: OwnerFilter } = {}
  ): string {
    const p = new URLSearchParams();
    const bucket = opts.bucket ?? queueBucket;
    const kind = opts.kind === undefined ? queueKind : opts.kind;
    const q = opts.q ?? queueQ;
    const owner = opts.owner ?? queueOwner;
    if (owner !== "anyone") p.set("owner", owner);
    if (bucket !== "all") p.set("due", bucket);
    if (kind) p.set("kind", kind);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `/today?${s}#queue` : "/today#queue";
  }
  const digestParts = [
    digest.found > 0 && `${digest.found} new opportunit${digest.found === 1 ? "y" : "ies"} found`,
    digest.autoPursued > 0 && `${digest.autoPursued} auto-pursued`,
    digest.replies > 0 && `${digest.replies} sub repl${digest.replies === 1 ? "y" : "ies"} received`,
    digest.callsLogged > 0 && `${digest.callsLogged} call${digest.callsLogged === 1 ? "" : "s"} logged`,
    digest.bidsPriced > 0 && `${digest.bidsPriced} bid${digest.bidsPriced === 1 ? "" : "s"} priced`,
    digest.expiredArchived > 0 && `${digest.expiredArchived} expired archived`,
  ].filter(Boolean) as string[];
  // accountSetup holds the per-organization and trial reasoning that used to
  // live here, so the Guide Me panel and its badge answer this the same way
  // rather than from the deployment's own environment.
  const setup = await accountSetup(profile?.profile_json ?? null, viewer);

  const urgentIds = new Set(data.urgent.map((o) => o.id));
  const bidWork = data.bidWork.filter((o) => !urgentIds.has(o.id));
  const flagged = data.flagged.filter((o) => !urgentIds.has(o.id));

  // Compliance alerts are their own ledger bucket now, so the ledger must not
  // also receive them here or every renewal is counted twice in the one
  // number. The section below still SHOWS them together, so it keeps its own
  // count of what it renders.
  const canSeeAuthority = isPlatformAdmin(viewer?.email);
  const approvalCount =
    data.proposedWeights.length +
    (canSeeAuthority && data.backlinkApprovals > 0 ? 1 : 0);
  const approvalSectionCount = approvalCount + data.complianceAlerts.length;
  /*
   * One ledger, shared with the Guide Me panel.
   *
   * This used to be eleven `.length`s added up here, while the guide added up
   * a different eight of its own, and the work queue below listed a third
   * set. One account was told it had 56 things to do, then 46, then shown a
   * list of neither length -- on one screen. Two of those numbers were also
   * counting query caps rather than work, and one was counting submitted bids
   * that need nobody. buildWorkLedger is now the only place that decides.
   */
  const ledger = buildWorkLedger({
    urgent: data.totals.urgent,
    replyReviews: data.totals.replyReviews,
    triage: data.totals.triage,
    calls: data.calls.count,
    bidWork: data.totals.bidWork,
    quoteReviews: data.totals.quoteReviews,
    subFollowUps: data.totals.subFollowUps,
    // totals.compliance, not complianceAlerts.length: that list is `limit 8`
    // because it also renders a preview strip, so its length reports the cap.
    compliance: data.totals.compliance,
    // awardCompliance is genuinely uncapped (loadAwardCompliance has no limit)
    // and needsAttentionOnWonWork is a JS predicate over a computed
    // assessment, so its length IS the count. Writing the predicate a second
    // time in SQL to get a "proper" total would create the second source of
    // truth this ledger exists to remove.
    awardCompliance: data.awardCompliance.length,
    flagged: data.totals.flagged,
    approvals: approvalCount,
  });
  const totalActions = ledger.total;

  const firstOpen =
    data.urgent.length > 0
      ? "urgent"
      : data.replyReviews.length > 0
        ? "reply-reviews"
        : data.triage.length > 0
          ? "triage"
          : data.calls.count > 0
            ? "calls"
            : "other";

  const clear = totalActions === 0 && setup.complete;

  return (
    <div className="flex page-shell bg-background text-foreground">
      <TodayLive />
      <div className="scroll-thin flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
          <div className="mb-2 flex justify-end">
            <HelpPopover help={PAGE_HELP["today"]} />
          </div>

          {/*
            Above the greeting on purpose. A day's work planned against a
            system that is not running is a day wasted, so this is the one
            thing that outranks "here is what needs you": the queue below is
            not going to move until it is fixed.
          */}
          {health && <AutomationBlockerBanner health={health} />}

          <TodayGreeting
            clear={clear}
            actionCount={totalActions}
            setupRemaining={setup.total - setup.done}
          />

          <div className="mt-8 flex gap-10">
            <div className="min-w-0 flex-1 space-y-10">
              <AutomationPausedBanner state={automation} />

              {!automation.paused && <PipelinePulse findings={pulse} />}

              {!setup.complete && (
                <div className="rounded-md border border-border/55 bg-surface p-4 dark:border-white/10">
                  <SetupChecklist checklist={setup} />
                </div>
              )}

              {data.awardCompliance.length > 0 && (
                <Section
                  id="award-compliance"
                  eyebrow="Urgent problems"
                  title="Subs on the job without complete paperwork"
                  count={data.awardCompliance.length}
                >
                  {data.awardCompliance.map((row) => {
                    const a = row.assessment;
                    const lapsed = a.expired.length > 0;
                    return (
                      <Link
                        key={`${row.contractId}-${row.subcontractorId}`}
                        href={`/subs/${row.subcontractorId}#compliance`}
                        className={ROW}
                      >
                        <div className="min-w-[14rem] flex-1">
                          <p className="eyebrow-gold">
                            {row.namedOnContract ? "On the contract" : "Quoted, not designated"}
                          </p>
                          <p className="mt-1 truncate text-sm font-medium text-foreground">
                            {row.companyName}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {row.opportunityTitle ?? "Won work"}
                            {" · "}
                            {a.blockReason
                              ? a.blockReason.replace(/^Cannot send work: /, "")
                              : a.expiringSoon
                                  .map(
                                    (e) =>
                                      `${DOC_LABEL[e.docType]} expires ${shortDate(e.expiresAt)}`
                                  )
                                  .join("; ")}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span
                            className={`badge ${lapsed ? "bg-risk/15 text-risk" : "bg-review/15 text-review"}`}
                          >
                            {lapsed ? "Not covered" : "Needs chasing"}
                          </span>
                          <CtaArrow label="Open paperwork" />
                        </div>
                      </Link>
                    );
                  })}
                </Section>
              )}

              {/* The one list of everything waiting on a person, above the
                  themed sections. The sections stay for context; this answers
                  "what should I do next" before any of them are opened. */}
              {/*
                Shown when there is work left OR when there was work done.
                Gating on the queue alone meant an operator who cleared the
                whole list lost the counters, the Completed today filter and
                any record that the day had happened at all: "nothing to do"
                and "everything done" rendered identically, which is the one
                pair this page exists to tell apart.
              */}
              {(queueItems.length > 0 || done.total > 0 || showingCompleted) && (
                <div id="queue" className="scroll-mt-6 space-y-4">
                  <TodayCounters
                    counts={counts}
                    done={done}
                    active={queueBucket}
                    hrefFor={(f) => queueHref({ bucket: f })}
                    completedHref={queueHref({ bucket: "completed_today" })}
                  />
                  <QueueFilters
                    q={queueQ}
                    bucket={queueBucket}
                    kind={queueKind}
                    kindCounts={kindCounts}
                    owner={queueOwner}
                    ownerHrefFor={(o) => queueHref({ owner: o })}
                    hrefFor={(o) => queueHref(o)}
                    clearHref="/today#queue"
                  />
                  {showingCompleted ? (
                    <CompletedList items={completedItems} />
                  ) : shownQueue.length > 0 ? (
                    <WorkQueue items={shownQueue} limit={5} viewerId={viewer?.id} />
                  ) : (
                    <EmptyState
                      tone="success"
                      title="Nothing in the queue matches that"
                      description="The counters above are for the whole queue. Clear the filter to see the rest."
                      action={
                        <Link href="/today#queue" className="shell-ghost text-sm">
                          Show everything
                        </Link>
                      }
                    />
                  )}
                </div>
              )}

              {clear && (
                <EmptyState
                  tone="success"
                  title="You are clear for now"
                  description={`${data.stageCounts.reduce((n, s) => n + s.count, 0).toLocaleString()} opportunities are being worked automatically. Anything that needs a person will show up here.`}
                  action={
                    <Link href="/pipeline" className="shell-ghost text-sm">
                      Browse opportunities
                    </Link>
                  }
                />
              )}

              {data.urgent.length > 0 && (
                <Section
                  id="urgent"
                  eyebrow="Do this first"
                  title={`Deadlines in the next ${rules.urgent_days} day${rules.urgent_days === 1 ? "" : "s"}`}
                  count={data.urgent.length}
                  defaultOpen={firstOpen === "urgent"}
                >
                  {data.urgent.map((o, i) => (
                    <OppActionRow
                      key={o.id}
                      o={o}
                      index={i + 1}
                      category="Deadline"
                      focused={i === 0}
                      action={o.has_bid ? "Review & submit" : "Open"}
                      detail={`still ${STAGE_LABEL[o.stage]?.toLowerCase() ?? o.stage.replace(/_/g, " ")}`}
                      rules={rules}
                    />
                  ))}
                </Section>
              )}

              {data.replyReviews.length > 0 && (
                <Section
                  id="reply-reviews"
                  eyebrow="Needs your read"
                  title="Replies the system wasn't sure about"
                  count={data.replyReviews.length}
                  defaultOpen={firstOpen === "reply-reviews"}
                >
                  <ReplyReviewList rows={data.replyReviews} />
                </Section>
              )}

              {data.triage.length > 0 && (
                <Section
                  id="triage"
                  eyebrow="Needs your decision"
                  title="Decide: pursue or pass"
                  count={data.triage.length}
                  defaultOpen={firstOpen === "triage"}
                >
                  <p className="mb-2 text-sm text-foreground/45">
                    These scored in the borderline band, so the system wants your judgment.
                    Decide right here, select several to pursue or pass together, or click a
                    row to read the full brief first. Unactioned items auto-dismiss when their
                    timer runs out.
                  </p>
                  <TodayBulkTriage
                    rows={data.triage}
                    rules={rules}
                    focusedFirst={firstOpen === "triage"}
                  />
                </Section>
              )}

              {data.calls.count > 0 && (
                <Section
                  id="calls"
                  eyebrow="Keep things moving"
                  title="Calls to make"
                  count={data.calls.count}
                  defaultOpen={firstOpen === "calls"}
                >
                  <p className="mb-2 text-sm text-foreground/45">
                    Each row opens that call&rsquo;s guided workspace. Select several to skip
                    or snooze together. Skip removes a call from the queue; Snooze hides it for
                    a bit.
                  </p>
                  <TodayBulkCalls
                    calls={data.calls.rows}
                    totalCount={data.calls.count}
                    rules={rules}
                    focusedFirst={firstOpen === "calls"}
                  />
                </Section>
              )}

              {data.subFollowUps.length > 0 && (
                <Section
                  id="follow-ups"
                  eyebrow="Subcontractor outreach"
                  title="Follow up with subcontractors"
                  count={data.subFollowUps.length}
                  defaultOpen={firstOpen === "other"}
                >
                  <p className="mb-2 text-sm text-foreground/45">
                    Automated email and follow-up already went out.{" "}
                    {rules.calls_enabled
                      ? "These still need a person, usually a quick call, before pricing can land."
                      : "These have not answered yet. Open the opportunity to email them again or line up another sub for the trade."}
                  </p>
                  {data.subFollowUps.map((s) => (
                    <Link
                      key={`${s.opportunity_id}-${s.subcontractor_id}`}
                      href={withGuideQuery(`/opportunity/${s.opportunity_id}#subs`, {
                        step: "today-followups",
                        focus: "subs",
                      })}
                      className={ROW}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="eyebrow-gold">Coverage follow-up</p>
                        <p className="mt-1 truncate text-sm font-medium text-foreground">
                          {rules.calls_enabled ? "Call" : "Follow up with"} {s.company_name}
                          {s.trade ? ` about ${s.trade.toLowerCase()} pricing` : ""}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {[
                            s.opportunity_title,
                            outreachLabel(s.outreach_state),
                            s.last_contacted ? `last touch ${timeAgo(s.last_contacted)}` : null,
                            `${s.emails_sent} email${s.emails_sent === 1 ? "" : "s"}`,
                            s.calls_logged > 0
                              ? `${s.calls_logged} call${s.calls_logged === 1 ? "" : "s"}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {s.work_summary && (
                          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                            <span className="font-medium text-muted-foreground">Work: </span>
                            {s.work_summary}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <DeadlineBadge deadline={s.deadline} rules={rules} />
                        <CtaArrow label="Open opportunity" />
                      </div>
                    </Link>
                  ))}
                </Section>
              )}

              {data.quoteReviews.length > 0 && (
                <Section
                  id="quotes"
                  eyebrow="Pricing check"
                  title="Quotes that need a look"
                  count={data.quoteReviews.length}
                >
                  <p className="mb-2 text-sm text-foreground/45">
                    These prices look unusually high or low versus comps. Confirm or replace
                    them before the bid package is finalized.
                  </p>
                  {data.quoteReviews.map((q) => (
                    <Link
                      key={q.quote_id}
                      href={withGuideQuery(`/opportunity/${q.opportunity_id}#quotes`, {
                        step: "today-quotes",
                        focus: "quotes",
                      })}
                      className={ROW}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="eyebrow-gold">Quote review</p>
                        <p className="mt-1 truncate text-sm font-medium text-foreground">
                          Review {q.quote_amount != null ? currency(q.quote_amount) : "a quote"}
                          {q.trade ? ` for ${q.trade}` : ""}
                          {q.company_name ? ` from ${q.company_name}` : ""}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {q.opportunity_title ?? "Opportunity"} · outside expected range
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <DeadlineBadge deadline={q.deadline} rules={rules} />
                        <CtaArrow label="Review quote" />
                      </div>
                    </Link>
                  ))}
                </Section>
              )}

              {bidWork.length > 0 && (
                <Section
                  eyebrow="Keep things moving"
                  title="Quotes & bids in progress"
                  count={bidWork.length}
                >
                  {bidWork.map((o, i) => (
                    <OppActionRow
                      key={o.id}
                      o={o}
                      index={i + 1}
                      category={
                        o.has_bid && !o.bid_submitted ? "Final approval" : "Bid work"
                      }
                      action={
                        o.has_bid && !o.bid_submitted
                          ? "Approve package"
                          : o.quote_count > 0
                            ? "Check quotes"
                            : "Enter quotes"
                      }
                      detail={
                        o.has_bid && !o.bid_submitted
                          ? "bid is priced and waiting for your sign-off"
                          : `${o.quote_count} quote${o.quote_count === 1 ? "" : "s"} entered so far`
                      }
                      rules={rules}
                    />
                  ))}
                </Section>
              )}

              {data.awaitingOutcome.length > 0 && (
                <Section
                  eyebrow="Waiting on the government"
                  title="Submitted, awaiting a decision"
                  count={data.awaitingOutcome.length}
                >
                  <p className="mb-2 text-sm text-foreground/45">
                    When the agency announces, record the result so the platform can set up
                    the contract (win) or learn from the loss.
                  </p>
                  {data.awaitingOutcome.map((o, i) => (
                    <OppActionRow
                      key={o.id}
                      o={o}
                      index={i + 1}
                      category="Outcome"
                      action="Record result"
                      rules={rules}
                    />
                  ))}
                </Section>
              )}

              {flagged.length > 0 && (
                <Section
                  eyebrow="Needs a look"
                  title="Flagged by the system"
                  count={flagged.length}
                >
                  {flagged.map((o, i) => (
                    <OppActionRow
                      key={o.id}
                      o={o}
                      index={i + 1}
                      category="Flagged"
                      action="Open"
                      detail={flagSummary(o.risk_flags ?? []) || undefined}
                      rules={rules}
                    />
                  ))}
                </Section>
              )}

              {approvalSectionCount > 0 && (
                <Section
                  eyebrow="Approvals & renewals"
                  title="Sign-offs waiting on you"
                  count={approvalSectionCount}
                >
                  {data.complianceAlerts.map((c) => (
                    <Link key={c.id} href="/compliance" className={ROW}>
                      <div className="min-w-[14rem] flex-1">
                        <p className="eyebrow-gold">Compliance</p>
                        <p className="mt-1 truncate text-sm font-medium text-foreground">
                          Renew: {c.label}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {c.days_remaining != null && c.days_remaining >= 0
                            ? `${c.days_remaining} day${c.days_remaining === 1 ? "" : "s"} until it lapses`
                            : c.due_at
                              ? `was due ${shortDate(c.due_at)}`
                              : "no date on record"}
                          {" · a lapse can block bidding"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span
                          className={`badge ${
                            c.status === "warning"
                              ? "bg-review/20 text-review"
                              : "bg-risk/20 text-risk"
                          }`}
                        >
                          {c.status}
                        </span>
                        <CtaArrow label="Open compliance" />
                      </div>
                    </Link>
                  ))}
                  {data.proposedWeights.map((w) => (
                    <div key={w.id} className={`${ROW} cursor-default`}>
                      <div className="min-w-0 flex-1">
                        <p className="eyebrow-gold">Scoring weights</p>
                        <p className="mt-1 truncate text-sm font-medium text-foreground">
                          Approve new scoring weights (v{w.version}), proposed{" "}
                          {timeAgo(w.proposed_at)}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {w.rationale ??
                            "The Learning Loop analyzed recent wins and losses and suggests adjusting how opportunities are scored."}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <ActionButton
                          endpoint={`/api/scoring-weights/${w.id}/approve`}
                          body={{ action: "approve" }}
                          className="btn-success text-xs"
                          successText="Approved. Future scoring uses the new weights."
                        >
                          Approve
                        </ActionButton>
                        <ActionButton
                          endpoint={`/api/scoring-weights/${w.id}/approve`}
                          body={{ action: "reject" }}
                          className="btn-danger text-xs"
                        >
                          Reject
                        </ActionButton>
                        <Link href="/settings/profile" className="shell-ghost text-xs">
                          Details →
                        </Link>
                      </div>
                    </div>
                  ))}
                  {canSeeAuthority && data.backlinkApprovals > 0 && (
                    <Link href="/authority" className={ROW}>
                      <div className="min-w-0 flex-1">
                        <p className="eyebrow-gold">Site authority</p>
                        <p className="mt-1 truncate text-sm font-medium text-foreground">
                          Approve{" "}
                          {data.backlinkApprovals === 1
                            ? "1 drafted outreach email"
                            : `${data.backlinkApprovals} drafted outreach emails`}{" "}
                          before they send
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          Site Authority drafted these to earn backlinks. Nothing sends
                          without your approval.
                        </p>
                      </div>
                      <CtaArrow label="Review drafts" />
                    </Link>
                  )}
                </Section>
              )}

              {data.snoozedCount > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 border border-dashed border-border/55 px-4 py-2.5 text-xs text-muted-foreground dark:border-white/15">
                  <span>
                    {data.snoozedCount === 1
                      ? "1 snoozed item hidden for now."
                      : `${data.snoozedCount} snoozed items hidden for now.`}{" "}
                    Each returns
                    automatically; deadline alerts keep running meanwhile.
                  </span>
                  <ActionButton
                    endpoint="/api/snooze"
                    body={{ wakeAll: true }}
                    className="shell-ghost text-xs"
                    toast={{ message: "All snoozed items are back on the list." }}
                  >
                    Bring them all back now
                  </ActionButton>
                </div>
              )}

              <details className="group rounded-md border border-border/55 dark:border-white/10 bg-surface/60 px-4 py-3 lg:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium text-foreground/80 [&::-webkit-details-marker]:hidden">
                  Pipeline overview and last 24 hours
                  <span
                    aria-hidden
                    className="text-muted-foreground transition-transform group-open:rotate-180"
                  >
                    ▾
                  </span>
                </summary>
                <div className="mt-4 space-y-4">
                  <PipelineStrip counts={data.stageCounts} callsEnabled={rules.calls_enabled} />
                  {digestParts.length > 0 && (
                    <Link
                      href="/agents"
                      className="block rounded-md border border-gold/30 bg-gold/10 px-4 py-2.5 text-sm text-foreground/80 transition-colors hover:border-gold/60"
                    >
                      <span className="font-semibold text-gold-text">Last 24 hours:</span>{" "}
                      {digestParts.join(" · ")}
                      <span className="text-foreground/45"> · open Automation Log</span>
                    </Link>
                  )}
                </div>
              </details>

              {/*
                * Last, and quieter than everything above it. What is left
                * outranks what is finished on a page whose job is the day
                * ahead, but a day with nothing recorded and a day with
                * everything recorded should not look the same either.
                */}
              <CompletedTodayPanel done={done} />

              <SystemStatusPanel
                items={[
                  health
                    ? automationStatusItem({
                        state: health.state,
                        headline: health.headline,
                        detail: health.detail,
                      })
                    : {
                        id: "automation",
                        label: "Background work",
                        kind: "delayed" as const,
                        detail:
                          "Could not check whether background work is running. Refresh this page. If this stays, open Automation Health.",
                        actionLabel: "Open automation health",
                        href: "/agents",
                      },
                  inboxStatusItem(inbox),
                  samStatusItem(samConfigured),
                ]}
              />

            </div>

            <PipelineHealthRail
              stageCounts={data.stageCounts}
              totalActions={totalActions}
              actionHeadline={ledgerHeadline(ledger)}
              actionBreakdown={ledgerBreakdown(ledger)}
              digestParts={digestParts}
              callsEnabled={rules.calls_enabled}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
