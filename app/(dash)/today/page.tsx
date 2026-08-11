import Link from "next/link";
import { actionCenter, dailyDigest, engineStatus, type ActionOppRow } from "@/lib/data";
import { PipelineStrip } from "@/components/pipeline-strip";
import { AutomationPausedBanner } from "@/components/automation-control";
import { getAutomationState, getAutomationRules } from "@/lib/app-settings";
import { SetupChecklist } from "@/components/setup-checklist";
import { PAGE_HELP } from "@/lib/help-content";
import { HelpPopover } from "@/components/help-popover";
import { integrationStatus } from "@/lib/config";
import { hydrateIntegrationEnv } from "@/lib/integration-settings";
import { getActiveProfile } from "@/lib/ai/companyProfile";
import { computeSetupChecklist } from "@/lib/domain/setup";
import { flagSummary } from "@/lib/flag-labels";
import { stageParty, PARTY_LABEL, STAGE_LABEL } from "@/lib/domain/journey";
import { outreachLabel } from "@/lib/domain/sub-contact";
import { DeadlineBadge } from "@/components/deadline-badge";
import { ActionButton } from "@/components/action-button";
import { SnoozeButton } from "@/components/snooze-button";
import { StopClickPropagation } from "@/components/stop-click-propagation";
import { TodayLive } from "@/components/today-live";
import { TodayGreeting } from "@/components/today-greeting";
import { EmptyState } from "@/components/empty-state";
import type { AutomationRules } from "@/lib/domain/intake";
import { currency, shortDate, timeAgo } from "@/lib/format";
import { withGuideQuery } from "@/lib/guide-links";

export const dynamic = "force-dynamic";

/**
 * "Today", the guided home page. Answers one question the moment the
 * operator logs in: what should I do next, and why? Everything here is a
 * deep link into the exact place the work happens, ordered by urgency.
 */

const ROW =
  "group flex flex-col gap-3 border-b border-white/10 px-1 py-4 transition-colors hover:bg-white/[0.02] sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-3 sm:gap-y-1.5";

function CtaArrow({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-white/70 transition-colors group-hover:text-gold">
      {label}
      <span aria-hidden className="text-gold">
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
}) {
  const party = stageParty(o.stage, { hasBid: o.has_bid });
  const meta = [
    o.value_estimated != null ? currency(o.value_estimated) : null,
    o.agency,
    detail,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href={withGuideQuery(`/opportunity/${o.id}`, {
        step: guideStep,
        focus: "next-step",
      })}
      className={`${ROW} ${focused ? "focus-rail pl-3" : ""}`}
    >
      <div className="min-w-0 flex-1">
        <p className="eyebrow-gold">{category}</p>
        <p className="mt-1 text-sm font-medium text-white sm:truncate">
          {o.title ?? "Untitled opportunity"}
        </p>
        <p className="mt-0.5 text-xs text-white/40 sm:truncate">{meta}</p>
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end sm:gap-3">
        {party && !inlineTriage && (
          <span
            className={`badge ${
              party === "you"
                ? "bg-pursue/20 text-pursue"
                : "bg-white/10 text-white/55"
            }`}
          >
            waiting on {PARTY_LABEL[party]}
          </span>
        )}
        <DeadlineBadge deadline={o.deadline} rules={rules} variant="shell" />
        {!inlineTriage && (
          <StopClickPropagation className="inline-flex">
            <SnoozeButton
              kind="opportunity"
              id={o.id}
              className="shell-ghost min-h-11 text-xs md:min-h-0"
            />
          </StopClickPropagation>
        )}
        {inlineTriage ? (
          <StopClickPropagation className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <SnoozeButton
              kind="opportunity"
              id={o.id}
              className="shell-ghost min-h-11 text-xs md:min-h-0"
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
            <ActionButton
              endpoint={`/api/opportunities/${o.id}/action`}
              body={{ action: "dismiss" }}
              className="btn-danger min-h-11 flex-1 text-xs sm:min-h-0 sm:flex-none"
              toast={{
                message: `Dismissed "${o.title ?? "opportunity"}". It's archived, not deleted.`,
                undo: {
                  endpoint: `/api/opportunities/${o.id}/action`,
                  body: { action: "restore" },
                },
              }}
            >
              Pass on this
            </ActionButton>
            <span className="text-xs font-medium text-gold sm:ml-1">Open brief</span>
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
    <details id={id} open={defaultOpen} className="group scroll-mt-12">
      <summary className="flex cursor-pointer list-none items-end justify-between gap-3 border-b border-white/15 pb-3 [&::-webkit-details-marker]:hidden">
        <div>
          <p className="eyebrow-gold">{eyebrow}</p>
          <h2 className="mt-1 font-display text-2xl font-normal text-white">
            {title}
            {typeof count === "number" && (
              <span className="num ml-2 text-base font-normal text-white/40">
                ({count} {count === 1 ? "item" : "items"})
              </span>
            )}
          </h2>
        </div>
        <span
          aria-hidden
          className="mb-1 select-none text-white/40 transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="mt-1">{children}</div>
    </details>
  );
}

function PipelineHealthRail({
  stageCounts,
  totalActions,
  digestParts,
}: {
  stageCounts: { stage: string; count: number }[];
  totalActions: number;
  digestParts: string[];
}) {
  const byStage = Object.fromEntries(stageCounts.map((s) => [s.stage, s.count]));
  const active = stageCounts.reduce((n, s) => n + s.count, 0);
  const strongFits =
    (byStage.analysis ?? 0) +
    (byStage.sub_research ?? 0) +
    (byStage.outreach ?? 0) +
    (byStage.quote_entry ?? 0) +
    (byStage.bid_building ?? 0);
  const inPursuit =
    (byStage.outreach ?? 0) +
    (byStage.call_queue ?? 0) +
    (byStage.quote_entry ?? 0) +
    (byStage.bid_building ?? 0);
  const packagesReady = byStage.bid_building ?? 0;
  const bars = [35, 48, 42, 62, 55, 78, 70].map((h, i) => ({
    h: Math.min(100, h + (active > 0 ? (i * 3) % 17 : 0)),
  }));

  return (
    <aside className="hidden w-72 shrink-0 lg:block">
      <div className="sticky top-6 space-y-6">
        <div className="shell-panel p-5">
          <div className="flex items-center justify-between">
            <p className="eyebrow-gold">Pipeline health</p>
            <span className="badge bg-pursue/20 text-pursue">Live</span>
          </div>
          <p className="mt-4 font-display text-5xl text-white">
            <span className="num">{active}</span>
          </p>
          <p className="mt-1 text-sm text-white/45">active opportunities</p>

          <div className="mt-6 flex h-24 items-end gap-1.5">
            {bars.map((b, i) => (
              <div
                key={i}
                className="flex-1 rounded-sm bg-gradient-to-t from-gold/25 to-gold/85"
                style={{ height: `${b.h}%` }}
                aria-hidden
              />
            ))}
          </div>

          <ul className="mt-6 divide-y divide-white/10 text-sm text-white/60">
            <li className="flex justify-between py-2.5">
              <span>Needs you</span>
              <span className="num text-white">{totalActions}</span>
            </li>
            <li className="flex justify-between py-2.5">
              <span>In capture</span>
              <span className="num text-white">{strongFits}</span>
            </li>
            <li className="flex justify-between py-2.5">
              <span>In pursuit</span>
              <span className="num text-white">{inPursuit}</span>
            </li>
            <li className="flex justify-between py-2.5">
              <span>Packages ready</span>
              <span className="num text-white">{packagesReady}</span>
            </li>
          </ul>
        </div>

        {digestParts.length > 0 && (
          <Link
            href="/agents"
            className="block shell-panel p-4 text-sm text-white/65 transition-colors hover:border-gold/40"
          >
            <p className="eyebrow-gold">Recent activity</p>
            <p className="mt-2 leading-relaxed">{digestParts.join(" · ")}</p>
          </Link>
        )}
      </div>
    </aside>
  );
}

export default async function TodayPage() {
  const rules = await getAutomationRules();
  const [data, profile, automation, digest, engine] = await Promise.all([
    actionCenter({ urgentDays: rules.urgent_days }),
    getActiveProfile(),
    getAutomationState(),
    dailyDigest(),
    engineStatus(),
  ]);
  const engineDown =
    !automation.paused &&
    ((engine.lastRunAt != null &&
      Date.now() - new Date(engine.lastRunAt).getTime() > 2 * 3_600_000) ||
      (engine.lastRunAt == null && engine.openCount > 0));
  const digestParts = [
    digest.found > 0 && `${digest.found} new opportunit${digest.found === 1 ? "y" : "ies"} found`,
    digest.autoPursued > 0 && `${digest.autoPursued} auto-pursued`,
    digest.replies > 0 && `${digest.replies} sub repl${digest.replies === 1 ? "y" : "ies"} received`,
    digest.callsLogged > 0 && `${digest.callsLogged} call${digest.callsLogged === 1 ? "" : "s"} logged`,
    digest.bidsPriced > 0 && `${digest.bidsPriced} bid${digest.bidsPriced === 1 ? "" : "s"} priced`,
    digest.expiredArchived > 0 && `${digest.expiredArchived} expired archived`,
  ].filter(Boolean) as string[];
  await hydrateIntegrationEnv();
  const integrations = integrationStatus();
  const setup = computeSetupChecklist({
    profile: profile?.profile_json ?? null,
    integrations,
  });

  const urgentIds = new Set(data.urgent.map((o) => o.id));
  const bidWork = data.bidWork.filter((o) => !urgentIds.has(o.id));
  const flagged = data.flagged.filter((o) => !urgentIds.has(o.id));

  const approvalCount =
    data.complianceAlerts.length +
    data.proposedWeights.length +
    (data.backlinkApprovals > 0 ? 1 : 0);
  const totalActions =
    data.urgent.length +
    data.triage.length +
    data.calls.count +
    data.subFollowUps.length +
    data.quoteReviews.length +
    bidWork.length +
    data.awaitingOutcome.length +
    flagged.length +
    approvalCount;

  const firstOpen =
    data.urgent.length > 0
      ? "urgent"
      : data.triage.length > 0
        ? "triage"
        : data.calls.count > 0
          ? "calls"
          : "other";

  const clear = totalActions === 0 && setup.complete;

  return (
    <div className="flex page-shell bg-ink text-white">
      <TodayLive />
      <div className="scroll-thin flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
          <div className="mb-2 flex justify-end">
            <HelpPopover help={PAGE_HELP["today"]} variant="dark" />
          </div>

          <TodayGreeting clear={clear} actionCount={totalActions} />

          <div className="mt-8 flex gap-10">
            <div className="min-w-0 flex-1 space-y-10">
              <AutomationPausedBanner state={automation} variant="shell" />

              {engineDown && (
                <div className="rounded-md border border-risk/40 bg-risk/10 px-4 py-3 text-sm">
                  <p className="font-semibold text-risk">
                    The automation engine is not running.
                  </p>
                  <p className="mt-1 text-white/70">
                    {engine.lastRunAt
                      ? `Nothing has run since ${timeAgo(engine.lastRunAt)}. `
                      : "No automated work has ever run, though opportunities are waiting. "}
                    Records will not move, be scored, or be monitored until it is back. On
                    Replit this usually means the app is not running as an always-on
                    deployment: open your Repl and press{" "}
                    <span className="font-medium text-white">Run</span> (or use a Reserved-VM
                    deployment for 24/7 operation). The{" "}
                    <Link href="/agents" className="underline">
                      Automation Log
                    </Link>{" "}
                    shows the moment it comes back.
                  </p>
                </div>
              )}

              {!setup.complete && (
                <div className="rounded-md border border-white/10 bg-shell p-4 [&_.card]:border-white/10 [&_.card]:bg-shell [&_h2]:text-white [&_p]:text-white/60">
                  <SetupChecklist checklist={setup} />
                </div>
              )}

              {clear && (
                <EmptyState
                  tone="success"
                  variant="shell"
                  title="You are clear for now"
                  description={`${data.stageCounts.reduce((n, s) => n + s.count, 0).toLocaleString()} opportunities are being worked automatically. Anything that needs a person will show up here.`}
                  action={
                    <Link href="/pipeline" className="shell-ghost text-sm">
                      Browse pipeline
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
                      category="Deadline"
                      focused={i === 0}
                      action={o.has_bid ? "Review & submit" : "Open"}
                      detail={`still ${STAGE_LABEL[o.stage]?.toLowerCase() ?? o.stage.replace(/_/g, " ")}`}
                      rules={rules}
                    />
                  ))}
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
                  <p className="mb-2 text-sm text-white/45">
                    These scored in the borderline band, so the system wants your judgment.
                    Decide right here, or click a row to read the full brief first. Unactioned
                    items auto-dismiss when their timer runs out.
                  </p>
                  {data.triage.map((o, i) => (
                    <OppActionRow
                      key={o.id}
                      o={o}
                      category="Pursuit decision"
                      focused={firstOpen === "triage" && i === 0}
                      action="Decide"
                      rules={rules}
                      inlineTriage
                    />
                  ))}
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
                  <p className="mb-2 text-sm text-white/45">
                    Each row opens that call&rsquo;s guided workspace: the script, project
                    details, and a form that saves the quote and every answer in one step.
                    Skip removes it from the queue and records that you chose not to call;
                    Snooze just hides it for a bit.
                  </p>
                  {data.calls.rows.map((c, i) => (
                    <Link
                      key={c.id}
                      href={withGuideQuery(`/call-queue?open=${c.id}`, {
                        step: "today-calls",
                        focus: "call-queue",
                      })}
                      className={`${ROW} ${firstOpen === "calls" && i === 0 ? "focus-rail pl-3" : ""}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="eyebrow-gold">Quote follow-up</p>
                        <p className="mt-1 text-sm font-medium text-white sm:truncate">
                          Call {c.company_name}
                          {c.trade
                            ? ` about ${c.trade.toLowerCase()} pricing`
                            : " for their quote"}
                        </p>
                        <p className="mt-0.5 text-xs text-white/40 sm:truncate">
                          {[c.opportunity_title, c.phone ?? "no phone on file"]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {c.work_summary && (
                          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-white/50">
                            <span className="font-medium text-white/70">Work: </span>
                            {c.work_summary}
                          </p>
                        )}
                      </div>
                      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:gap-3">
                        {c.source === "reply" && (
                          <span className="badge bg-pursue/20 text-pursue">
                            Replied, interested
                          </span>
                        )}
                        <DeadlineBadge deadline={c.deadline} rules={rules} variant="shell" />
                        <StopClickPropagation className="flex items-center gap-2">
                          <SnoozeButton
                            kind="call_card"
                            id={c.id}
                            className="shell-ghost min-h-11 text-xs md:min-h-0"
                          />
                          <ActionButton
                            endpoint={`/api/call-cards/${c.id}/skip`}
                            className="shell-ghost text-xs"
                            toast={{
                              message: `Skipped calling ${c.company_name}. Recorded on their history.`,
                              undo: {
                                endpoint: `/api/call-cards/${c.id}/skip`,
                                body: { undo: true },
                              },
                            }}
                          >
                            Skip
                          </ActionButton>
                        </StopClickPropagation>
                        <CtaArrow label="Start call" />
                      </div>
                    </Link>
                  ))}
                  {data.calls.count > data.calls.rows.length && (
                    <Link
                      href="/call-queue"
                      className="block border-b border-white/10 px-1 py-3 text-center text-xs text-white/45 transition-colors hover:text-gold"
                    >
                      {data.calls.count - data.calls.rows.length} more call
                      {data.calls.count - data.calls.rows.length === 1 ? "" : "s"} in the
                      queue →
                    </Link>
                  )}
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
                  <p className="mb-2 text-sm text-white/45">
                    Automated email and follow-up already went out. These still need a person,
                    usually a quick call, before pricing can land.
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
                        <p className="mt-1 truncate text-sm font-medium text-white">
                          Call {s.company_name}
                          {s.trade ? ` about ${s.trade.toLowerCase()} pricing` : ""}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-white/40">
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
                          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-white/50">
                            <span className="font-medium text-white/70">Work: </span>
                            {s.work_summary}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <DeadlineBadge deadline={s.deadline} rules={rules} variant="shell" />
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
                  <p className="mb-2 text-sm text-white/45">
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
                        <p className="mt-1 truncate text-sm font-medium text-white">
                          Review {q.quote_amount != null ? currency(q.quote_amount) : "a quote"}
                          {q.trade ? ` for ${q.trade}` : ""}
                          {q.company_name ? ` from ${q.company_name}` : ""}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-white/40">
                          {q.opportunity_title ?? "Opportunity"} · outside expected range
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <DeadlineBadge deadline={q.deadline} rules={rules} variant="shell" />
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
                  {bidWork.map((o) => (
                    <OppActionRow
                      key={o.id}
                      o={o}
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
                  <p className="mb-2 text-sm text-white/45">
                    When the agency announces, record the result so the platform can set up
                    the contract (win) or learn from the loss.
                  </p>
                  {data.awaitingOutcome.map((o) => (
                    <OppActionRow
                      key={o.id}
                      o={o}
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
                  {flagged.map((o) => (
                    <OppActionRow
                      key={o.id}
                      o={o}
                      category="Flagged"
                      action="Open"
                      detail={flagSummary(o.risk_flags ?? []) || undefined}
                      rules={rules}
                    />
                  ))}
                </Section>
              )}

              {approvalCount > 0 && (
                <Section
                  eyebrow="Approvals & renewals"
                  title="Sign-offs waiting on you"
                  count={approvalCount}
                >
                  {data.complianceAlerts.map((c) => (
                    <Link key={c.id} href="/compliance" className={ROW}>
                      <div className="min-w-[14rem] flex-1">
                        <p className="eyebrow-gold">Compliance</p>
                        <p className="mt-1 truncate text-sm font-medium text-white">
                          Renew: {c.label}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-white/40">
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
                        <p className="mt-1 truncate text-sm font-medium text-white">
                          Approve new scoring weights (v{w.version}), proposed{" "}
                          {timeAgo(w.proposed_at)}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-white/40">
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
                  {data.backlinkApprovals > 0 && (
                    <Link href="/authority" className={ROW}>
                      <div className="min-w-0 flex-1">
                        <p className="eyebrow-gold">Site authority</p>
                        <p className="mt-1 truncate text-sm font-medium text-white">
                          Approve {data.backlinkApprovals} drafted outreach email
                          {data.backlinkApprovals === 1 ? "" : "s"} before they send
                        </p>
                        <p className="mt-0.5 truncate text-xs text-white/40">
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
                <div className="flex flex-wrap items-center justify-between gap-2 border border-dashed border-white/15 px-4 py-2.5 text-xs text-white/45">
                  <span>
                    {data.snoozedCount} snoozed item
                    {data.snoozedCount === 1 ? "" : "s"} hidden for now. Each returns
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

              <details className="group rounded-md border border-white/10 bg-shell/60 px-4 py-3 lg:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium text-white/80 [&::-webkit-details-marker]:hidden">
                  Pipeline overview and last 24 hours
                  <span
                    aria-hidden
                    className="text-white/40 transition-transform group-open:rotate-180"
                  >
                    ▾
                  </span>
                </summary>
                <div className="mt-4 space-y-4">
                  <PipelineStrip counts={data.stageCounts} />
                  {digestParts.length > 0 && (
                    <Link
                      href="/agents"
                      className="block rounded-md border border-gold/30 bg-gold/10 px-4 py-2.5 text-sm text-white/80 transition-colors hover:border-gold/60"
                    >
                      <span className="font-semibold text-gold">Last 24 hours:</span>{" "}
                      {digestParts.join(" · ")}
                      <span className="text-white/45"> · open Automation Log</span>
                    </Link>
                  )}
                </div>
              </details>

            </div>

            <PipelineHealthRail
              stageCounts={data.stageCounts}
              totalActions={totalActions}
              digestParts={digestParts}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
