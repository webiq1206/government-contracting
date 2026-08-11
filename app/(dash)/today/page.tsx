import Link from "next/link";
import { actionCenter, dailyDigest, engineStatus, type ActionOppRow } from "@/lib/data";
import { PageHeader } from "@/components/badges";
import { PipelineStrip } from "@/components/pipeline-strip";
import { AutomationPausedBanner } from "@/components/automation-control";
import { getAutomationState, getAutomationRules } from "@/lib/app-settings";
import { SetupChecklist } from "@/components/setup-checklist";
import { PAGE_HELP } from "@/lib/help-content";
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
import type { AutomationRules } from "@/lib/domain/intake";
import { currency, shortDate, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * "Today", the guided home page. Answers one question the moment the
 * operator logs in: what should I do next, and why? Everything here is a
 * deep link into the exact place the work happens, ordered by urgency.
 */

function OppActionRow({
  o,
  action,
  detail,
  rules,
  inlineTriage = false,
}: {
  o: ActionOppRow;
  action: string;
  detail?: string;
  rules?: AutomationRules;
  /** Render Pursue/Dismiss right on the row so the decision happens here. */
  inlineTriage?: boolean;
}) {
  const party = stageParty(o.stage, { hasBid: o.has_bid });
  return (
    <Link
      href={`/opportunity/${o.id}`}
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-border bg-background px-4 py-3 transition-colors hover:border-accent/60"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">
          {o.title ?? "Untitled opportunity"}
        </p>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {[o.agency, o.value_estimated != null ? currency(o.value_estimated) : null]
            .filter(Boolean)
            .join(" · ")}
          {detail ? ` · ${detail}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {party && !inlineTriage && (
          <span
            className={`badge ${
              party === "you" ? "bg-pursue/10 text-pursue" : "bg-slate-200 text-slate-600"
            }`}
          >
            waiting on {PARTY_LABEL[party]}
          </span>
        )}
        <DeadlineBadge deadline={o.deadline} rules={rules} />
        {!inlineTriage && (
          <StopClickPropagation className="inline-flex">
            <SnoozeButton kind="opportunity" id={o.id} />
          </StopClickPropagation>
        )}
        {inlineTriage ? (
          <StopClickPropagation className="flex items-center gap-2">
            <SnoozeButton kind="opportunity" id={o.id} />
            <ActionButton
              endpoint={`/api/opportunities/${o.id}/action`}
              body={{ action: "pursue" }}
              className="btn-success text-xs"
              toast={{
                message: "Pursued. Analysis and pricing are running.",
              }}
            >
              Pursue
            </ActionButton>
            <ActionButton
              endpoint={`/api/opportunities/${o.id}/action`}
              body={{ action: "dismiss" }}
              className="btn-danger text-xs"
              toast={{
                message: `Dismissed "${o.title ?? "opportunity"}". It's archived, not deleted.`,
                undo: {
                  endpoint: `/api/opportunities/${o.id}/action`,
                  body: { action: "restore" },
                },
              }}
            >
              Dismiss
            </ActionButton>
            <span className="btn-ghost pointer-events-none text-xs">Read brief →</span>
          </StopClickPropagation>
        ) : (
          <span className="btn-ghost pointer-events-none text-xs">{action} →</span>
        )}
      </div>
    </Link>
  );
}

/**
 * A collapsible section with a prominent, green-underlined heading. Uses native
 * <details> so it needs no client JS; the chevron rotates when open.
 */
function Section({
  eyebrow,
  title,
  count,
  children,
}: {
  eyebrow: string;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <details open className="group">
      <summary className="flex cursor-pointer list-none items-end justify-between gap-3 border-b-2 border-accent/80 pb-2 [&::-webkit-details-marker]:hidden">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="mt-0.5 font-display text-2xl font-semibold text-foreground">
            {title}
            {typeof count === "number" && (
              <span className="num ml-2 text-base font-normal text-slate-500">{count}</span>
            )}
          </h2>
        </div>
        <span
          aria-hidden
          className="mb-1 select-none text-slate-500 transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="mt-3 space-y-2">{children}</div>
    </details>
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
  // Engine liveness: sweeps run every 10-20 min, so hours of silence while
  // records sit open means the worker process itself is down, which strands
  // EVERYTHING. Surface that here, not buried in the Automation Log.
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
  // Keys saved on the Integrations page live encrypted in the DB and are
  // mirrored into process.env. A server instance that never served that
  // page (or restarted since) has an empty env, which made connected
  // integrations show as "not set up" here. Hydrate before reading.
  await hydrateIntegrationEnv();
  const integrations = integrationStatus();
  const setup = computeSetupChecklist({
    profile: profile?.profile_json ?? null,
    integrations,
  });

  // Items already surfaced in a more urgent section shouldn't repeat below it.
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

  return (
    <div className="flex h-screen flex-col">
      <TodayLive />
      <PageHeader
        help={PAGE_HELP["today"]}
        title="Today"
        subtitle={
          !setup.complete
            ? `Finish setup first (${setup.done}/${setup.total} complete), then Today will only show work that needs you.`
            : totalActions === 0
              ? "Nothing needs you right now."
              : `${totalActions} thing${totalActions === 1 ? "" : "s"} need${totalActions === 1 ? "s" : ""} your attention, most urgent first.`
        }
      />
      <div className="scroll-thin flex-1 overflow-y-auto p-5">
       <div className="mx-auto w-full max-w-5xl space-y-8">
        {/* Site-wide warning while the operator has paused the cron loop. */}
        <AutomationPausedBanner state={automation} />

        {/* The one failure that strands everything: the background engine
            isn't running. Say so in plain language, with the fix. */}
        {engineDown && (
          <div className="rounded-md border border-risk/50 bg-risk/5 px-4 py-3">
            <p className="text-sm font-semibold text-risk">
              The automation engine is not running.
            </p>
            <p className="mt-1 text-sm text-slate-700">
              {engine.lastRunAt
                ? `Nothing has run since ${timeAgo(engine.lastRunAt)}. `
                : "No automated work has ever run, though opportunities are waiting. "}
              Records will not move, be scored, or be monitored until it&rsquo;s back. On
              Replit this usually means the app isn&rsquo;t running as an always-on
              deployment: open your Repl and press <span className="font-medium">Run</span>{" "}
              (or use a Reserved-VM deployment for 24/7 operation). The{" "}
              <Link href="/agents" className="underline">
                Automation Log
              </Link>{" "}
              shows the moment it comes back.
            </p>
          </div>
        )}

        {/* Pipeline overview first — scan where everything stands before the
            action list. Setup (when incomplete) still sits above the work. */}
        <PipelineStrip counts={data.stageCounts} />

        {/* What the machine did while you were away. */}
        {digestParts.length > 0 && (
          <Link
            href="/agents"
            className="block rounded-md border border-accent/30 bg-accent-soft/50 px-4 py-2.5 text-sm text-slate-700 transition-colors hover:border-accent/60"
          >
            <span className="font-semibold text-accent-strong">Last 24 hours:</span>{" "}
            {digestParts.join(" · ")}
            <span className="text-slate-500"> · details in the Automation Log →</span>
          </Link>
        )}

        {/* Setup stays near the top ONLY while the platform can't run on its
            own — it is blocking work. Once complete it disappears entirely. */}
        {!setup.complete && <SetupChecklist checklist={setup} />}

        {totalActions === 0 && setup.complete && (
          <div className="card mx-auto max-w-lg text-center">
            <p className="text-3xl">✅</p>
            <p className="mt-3 text-base font-semibold text-foreground">
              You&rsquo;re done for today.
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {data.stageCounts.reduce((n, s) => n + s.count, 0).toLocaleString()} opportunities
              are being worked automatically. Anything that needs a person will show up here,
              and you&rsquo;ll be warned before any deadline gets close.
            </p>
          </div>
        )}

        {data.urgent.length > 0 && (
          <Section
            eyebrow="Do this first"
            title={`Deadlines in the next ${rules.urgent_days} day${rules.urgent_days === 1 ? "" : "s"}`}
            count={data.urgent.length}
          >
            {data.urgent.map((o) => (
              <OppActionRow
                key={o.id}
                o={o}
                action={o.has_bid ? "Review & submit" : "Open"}
                detail={`still ${STAGE_LABEL[o.stage]?.toLowerCase() ?? o.stage.replace(/_/g, " ")}`}
                rules={rules}
              />
            ))}
          </Section>
        )}

        {data.triage.length > 0 && (
          <Section
            eyebrow="Needs your decision"
            title="Decide: pursue or pass"
            count={data.triage.length}
          >
            <p className="-mt-1 text-sm text-slate-500">
              These scored in the borderline band, so the system wants your
              judgment. Decide right here, or click a row to read the full
              brief first. Unactioned items auto-dismiss when their timer runs
              out.
            </p>
            {data.triage.map((o) => (
              <OppActionRow key={o.id} o={o} action="Decide" rules={rules} inlineTriage />
            ))}
          </Section>
        )}

        {data.calls.count > 0 && (
          <Section eyebrow="Keep things moving" title="Calls to make" count={data.calls.count}>
            <p className="-mt-1 text-sm text-slate-500">
              Each row opens that call&rsquo;s guided workspace: the script,
              project details, and a form that saves the quote and every answer
              in one step. Skip removes it from the queue and records that you
              chose not to call; Snooze just hides it for a bit.
            </p>
            {data.calls.rows.map((c) => (
              <Link
                key={c.id}
                href={`/call-queue?open=${c.id}`}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-border bg-background px-4 py-3 transition-colors hover:border-accent/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    Call {c.company_name}
                    {c.trade ? ` about ${c.trade.toLowerCase()} pricing` : " for their quote"}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {[c.opportunity_title, c.phone ?? "no phone on file"]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {c.work_summary && (
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-600">
                      <span className="font-medium text-slate-800">Work: </span>
                      {c.work_summary}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {c.source === "reply" && (
                    <span className="badge bg-pursue/15 text-pursue">Replied, interested</span>
                  )}
                  <DeadlineBadge deadline={c.deadline} rules={rules} />
                  <StopClickPropagation className="flex items-center gap-2">
                    <SnoozeButton kind="call_card" id={c.id} />
                    <ActionButton
                      endpoint={`/api/call-cards/${c.id}/skip`}
                      className="btn-ghost text-xs"
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
                  <span className="btn-primary pointer-events-none text-xs">Start call →</span>
                </div>
              </Link>
            ))}
            {data.calls.count > data.calls.rows.length && (
              <Link
                href="/call-queue"
                className="block rounded-md border border-border bg-background px-4 py-2.5 text-center text-xs text-slate-600 transition-colors hover:border-accent/60"
              >
                {data.calls.count - data.calls.rows.length} more call
                {data.calls.count - data.calls.rows.length === 1 ? "" : "s"} in the queue →
              </Link>
            )}
          </Section>
        )}

        {data.subFollowUps.length > 0 && (
          <Section
            eyebrow="Subcontractor outreach"
            title="Follow up with subcontractors"
            count={data.subFollowUps.length}
          >
            <p className="-mt-1 text-sm text-slate-500">
              Automated email and follow-up already went out. These still need a
              person — usually a quick call — before pricing can land.
            </p>
            {data.subFollowUps.map((s) => (
              <Link
                key={`${s.opportunity_id}-${s.subcontractor_id}`}
                href={`/opportunity/${s.opportunity_id}#subs`}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-border bg-background px-4 py-3 transition-colors hover:border-accent/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    Call {s.company_name}
                    {s.trade ? ` about ${s.trade.toLowerCase()} pricing` : ""}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
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
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-600">
                      <span className="font-medium text-slate-800">Work: </span>
                      {s.work_summary}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <DeadlineBadge deadline={s.deadline} rules={rules} />
                  <span className="btn-ghost pointer-events-none text-xs">Open opportunity →</span>
                </div>
              </Link>
            ))}
          </Section>
        )}

        {data.quoteReviews.length > 0 && (
          <Section
            eyebrow="Pricing check"
            title="Quotes that need a look"
            count={data.quoteReviews.length}
          >
            <p className="-mt-1 text-sm text-slate-500">
              These prices look unusually high or low versus comps. Confirm or
              replace them before the bid package is finalized.
            </p>
            {data.quoteReviews.map((q) => (
              <Link
                key={q.quote_id}
                href={`/opportunity/${q.opportunity_id}#quotes`}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-border bg-background px-4 py-3 transition-colors hover:border-accent/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    Review {q.quote_amount != null ? currency(q.quote_amount) : "a quote"}
                    {q.trade ? ` for ${q.trade}` : ""}
                    {q.company_name ? ` from ${q.company_name}` : ""}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {q.opportunity_title ?? "Opportunity"} · outside expected range
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <DeadlineBadge deadline={q.deadline} rules={rules} />
                  <span className="btn-ghost pointer-events-none text-xs">Review quote →</span>
                </div>
              </Link>
            ))}
          </Section>
        )}

        {bidWork.length > 0 && (
          <Section eyebrow="Keep things moving" title="Quotes & bids in progress" count={bidWork.length}>
            {bidWork.map((o) => (
              <OppActionRow
                key={o.id}
                o={o}
                action={
                  o.has_bid && !o.bid_submitted
                    ? "Review & submit bid"
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
            <p className="-mt-1 text-sm text-slate-500">
              When the agency announces, record the result so the platform can
              set up the contract (win) or learn from the loss.
            </p>
            {data.awaitingOutcome.map((o) => (
              <OppActionRow key={o.id} o={o} action="Record result" rules={rules} />
            ))}
          </Section>
        )}

        {flagged.length > 0 && (
          <Section eyebrow="Needs a look" title="Flagged by the system" count={flagged.length}>
            {flagged.map((o) => (
              <OppActionRow
                key={o.id}
                o={o}
                action="Open"
                detail={flagSummary(o.risk_flags ?? []) || undefined}
                rules={rules}
              />
            ))}
          </Section>
        )}

        {approvalCount > 0 && (
          <Section eyebrow="Approvals & renewals" title="Sign-offs waiting on you" count={approvalCount}>
            {data.complianceAlerts.map((c) => (
              <Link
                key={c.id}
                href="/compliance"
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-border bg-background px-4 py-3 transition-colors hover:border-accent/60"
              >
                <div className="min-w-[14rem] flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    Renew: {c.label}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
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
                        ? "bg-review/15 text-review"
                        : "bg-risk/15 text-risk"
                    }`}
                  >
                    {c.status}
                  </span>
                  <span className="btn-ghost pointer-events-none text-xs">Open compliance →</span>
                </div>
              </Link>
            ))}
            {data.proposedWeights.map((w) => (
              <div
                key={w.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-border bg-background px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    Approve new scoring weights (v{w.version}), proposed {timeAgo(w.proposed_at)}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
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
                  <Link href="/settings/profile" className="btn-ghost text-xs">
                    Details →
                  </Link>
                </div>
              </div>
            ))}
            {data.backlinkApprovals > 0 && (
              <Link
                href="/authority"
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-border bg-background px-4 py-3 transition-colors hover:border-accent/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    Approve {data.backlinkApprovals} drafted outreach email
                    {data.backlinkApprovals === 1 ? "" : "s"} before they send
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    Site Authority drafted these to earn backlinks. Nothing sends
                    without your approval.
                  </p>
                </div>
                <span className="btn-ghost pointer-events-none shrink-0 text-xs">
                  Review drafts →
                </span>
              </Link>
            )}
          </Section>
        )}

        {/* Items the operator snoozed. Kept visible as a count so nothing can
            feel "lost"; they return to their sections automatically. */}
        {data.snoozedCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-border px-4 py-2.5 text-xs text-slate-500">
            <span>
              {data.snoozedCount} snoozed item{data.snoozedCount === 1 ? "" : "s"} hidden for
              now. Each returns automatically; deadline alerts keep running meanwhile.
            </span>
            <ActionButton
              endpoint="/api/snooze"
              body={{ wakeAll: true }}
              className="btn-ghost text-xs"
              toast={{ message: "All snoozed items are back on the list." }}
            >
              Bring them all back now
            </ActionButton>
          </div>
        )}

        {/* Completed setup checklist stays available below the work so it
            doesn't compete with actions once the platform is fully wired. */}
        {setup.complete && (
          <div className="border-t border-border pt-6">
            <SetupChecklist checklist={setup} />
          </div>
        )}

       </div>
      </div>
    </div>
  );
}
