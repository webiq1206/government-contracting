import { notFound } from "next/navigation";
import { opportunityDetail } from "@/lib/data";
import { PageHeader, ScoreBadge, TierBadge } from "@/components/badges";
import { PAGE_HELP } from "@/lib/help-content";
import { ActionButton } from "@/components/action-button";
import { QuoteEntryForm } from "@/components/quote-entry-form";
import { BidBrief } from "@/components/bid-brief";
import { AttachmentsPanel } from "@/components/attachments-panel";
import { NextStepBanner } from "@/components/next-step-banner";
import { OpportunityJourney } from "@/components/opportunity-journey";
import { DeadlineBadge } from "@/components/deadline-badge";
import { getAutomationState, getAutomationRules } from "@/lib/app-settings";
import { SubmissionPackage } from "@/components/submission-package";
import { OpportunityNotes } from "@/components/opportunity-notes";
import { Collapsible } from "@/components/collapsible";
import { CompetitiveLandscape } from "@/components/competitive-landscape";
import { DeadlineCountdown } from "@/components/deadline-countdown";
import { ScoreBreakdownCard } from "@/components/score-breakdown-card";
import { PricingCompsCard } from "@/components/pricing-comps-card";
import { OpportunitySubsPanel } from "@/components/opportunity-subs-panel";
import { AttentionStrip } from "@/components/attention-strip";
import { TradeCoverageStrip } from "@/components/trade-coverage-strip";
import { SubWorkNeeded } from "@/components/sub-work-needed";
import { InfoTip } from "@/components/info-tip";
import { SectionHeading } from "@/components/section-heading";
import { ActivityTimeline } from "@/components/activity-timeline";
import { summarizeTradeCoverage } from "@/lib/domain/trade-coverage";
import { computeBidReadiness } from "@/lib/domain/bid-readiness";
import { termTip } from "@/lib/domain/glossary";
import { resolveSubWork } from "@/lib/domain/sub-work";
import { buildActivityTimeline } from "@/lib/domain/activity-timeline";
import { stageLabel } from "@/lib/domain/journey";
import { currency, timeAgo, shortDate } from "@/lib/format";
import { flagLabel } from "@/lib/flag-labels";
import { EstimatedValue } from "@/components/estimated-value";
import type { Bid, ScoreBreakdown, SolicitationAnalysis } from "@/lib/types";

export const dynamic = "force-dynamic";

const NA_TEXT = "Not specified in the provided documents";

/** Plain-English labels for internal enums shown on this page. */
const PAST_PERF_LABEL: Record<string, string> = {
  not_required: "Not required",
  team_accepted: "Team experience accepted",
  prime_only: "Prime-only (blocked)",
};

/**
 * The Opportunity Detail page is the single source of truth for one bid.
 * Every card and list here is the authoritative view; changes made in Call
 * Workspace, Quote Entry, or Review flow refresh into these panels on the
 * next server render (all wrapping views call `router.refresh()` after save).
 */
export default async function OpportunityPage({ params }: { params: { id: string } }) {
  const [detail, automation, rules] = await Promise.all([
    opportunityDetail(params.id),
    getAutomationState(),
    getAutomationRules(),
  ]);
  if (!detail) notFound();
  const { opp, quotes, subs, documents, logs, competitors, subComms } = detail;
  // Hours since the record last changed, feeds the banner's stall detection.
  const hoursSinceUpdate = opp.updated_at
    ? (Date.now() - new Date(opp.updated_at).getTime()) / 3_600_000
    : null;
  const bid = detail.bid as Bid | null;
  const breakdown = opp.score_breakdown as ScoreBreakdown | null;
  const analysis = opp.solicitation_analysis as SolicitationAnalysis | null;
  const pricing = (opp.raw_json as { pricing_summary?: Record<string, unknown> } | null)?.pricing_summary;
  const subOptions = subs.map((s) => ({
    subcontractor_id: s.subcontractor_id,
    company_name: s.company_name,
    trade: s.trade,
  }));
  const briefDocs = (documents as Record<string, unknown>[]).map((d) => ({
    id: String(d.id),
    name: String(d.name),
    kind: String(d.kind),
    storage_path: (d.storage_path as string) ?? null,
    meta: (d.meta as { source_url?: string }) ?? null,
  }));
  // Latest storage path per document kind, for the submission-package downloads.
  const kindToPath: Record<string, string> = {};
  for (const d of documents as Record<string, unknown>[]) {
    const kind = String(d.kind);
    const path = d.storage_path ? String(d.storage_path) : "";
    if (path && !kindToPath[kind]) kindToPath[kind] = path;
  }
  // Lowest quote captured so far, for the at-a-glance summary.
  const quoteAmounts = (quotes as Record<string, unknown>[])
    .map((q) => Number(q.quote_amount))
    .filter((n) => Number.isFinite(n) && n > 0);
  const bestQuote = quoteAmounts.length ? Math.min(...quoteAmounts) : null;
  const requiredTradeCount = analysis?.required_trades?.length ?? 0;

  // Quote collection is the operator's active job before a bid exists. Surface it
  // full-width and up front once the opportunity has reached a stage where quotes
  // make sense (subs are being worked, or some quotes are already in). Once a bid
  // is built the focus shifts to review, so the panel steps aside.
  const quotesEntered = (quotes as unknown[]).length;
  const hasBid = Boolean(bid);
  const bidSubmitted = Boolean(bid?.submitted_at);
  const QUOTE_STAGES = ["sub_research", "outreach", "call_queue", "quote_entry"];
  const showQuotePanel =
    opp.status === "open" && // archived/expired records are read-only
    !hasBid &&
    !bidSubmitted &&
    (quotesEntered > 0 ||
      subOptions.length > 0 ||
      QUOTE_STAGES.includes(opp.stage));
  const emphasizeQuotePanel = showQuotePanel && quotesEntered === 0;

  const quoteRows = (quotes as Record<string, unknown>[]).map((q) => ({
    trade: (q.trade as string) ?? null,
    quote_amount: Number(q.quote_amount) || null,
    is_out_of_range: Boolean(q.is_out_of_range),
    subcontractor_id: (q.subcontractor_id as string) ?? null,
  }));
  const quotedSubIds = new Set(
    quoteRows
      .filter((q) => Number(q.quote_amount) > 0 && q.subcontractor_id)
      .map((q) => q.subcontractor_id as string)
  );
  const coverage = summarizeTradeCoverage({
    requiredTrades: analysis?.required_trades ?? [],
    subs: subs.map((s) => ({
      trade: s.trade,
      outreach_state: s.outreach_state,
      emails_sent: s.emails_sent,
      calls_logged: s.calls_logged,
      responded_at: s.responded_at,
    })),
    quotes: quoteRows,
  });
  const readiness = computeBidReadiness({
    stage: opp.stage,
    status: opp.status,
    deadline: opp.deadline,
    riskFlags: opp.risk_flags ?? [],
    attentionFromBrief: analysis?.attention_items ?? [],
    requiredTrades: analysis?.required_trades ?? [],
    quotes: quoteRows,
    tradeCoverageUncovered: coverage.totals.uncovered,
    uncoveredTrades: coverage.trades.filter((t) => t.quotes === 0).map((t) => t.trade),
    tradeStatuses: coverage.trades.map((t) => ({
      trade: t.trade,
      status: t.status,
      quotes: t.quotes,
      contacted: t.contacted,
      found: t.found,
    })),
    subsFound: subs.length,
    hasBid,
    packageReady: bid?.package_ready ?? null,
    humanFlags: (bid?.human_flags as string[] | null) ?? null,
    humanActionRequired: opp.human_action_required,
    completenessMissing: analysis?.completeness?.missing ?? null,
    packageBlockers: (bid?.validation_json as { blockers?: string[] } | null)?.blockers ?? null,
  });
  const activity = buildActivityTimeline({
    logs,
    communications: subComms,
    limit: 40,
  });

  return (
    <div className="flex page-shell">
      <PageHeader
        help={PAGE_HELP["opportunity"]}
        title={opp.title ?? "Opportunity"}
        eyebrow={[opp.agency, opp.solicitation_number].filter(Boolean).join(" · ") || undefined}
        status={
          <span className="inline-flex flex-wrap items-center gap-2">
            <TierBadge tier={opp.tier} />
            <span className="badge bg-surface text-slate-600">{stageLabel(opp.stage)}</span>
            <ScoreBadge score={opp.score} />
            <DeadlineBadge deadline={opp.deadline} rules={rules} showDate />
          </span>
        }
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-500">
            {opp.naics_code ? <span>NAICS {opp.naics_code}</span> : null}
            {opp.set_aside_type ? <span>{opp.set_aside_type}</span> : null}
          </span>
        }
      />

      <div className="scroll-thin flex-1 overflow-y-auto">
        {/* Attention + next action before jump nav so blockers win the fold. */}
        <div className="space-y-3 px-5 pt-4" id="attention" data-guide-target="attention">
          <AttentionStrip readiness={readiness} opportunityId={opp.id} />
        </div>
        <div className="px-5 pt-2" id="next" data-guide-target="next-step">
          <NextStepBanner
            opportunityId={opp.id}
            stage={opp.stage}
            tier={opp.tier}
            humanActionRequired={opp.human_action_required}
            quoteCount={readiness.tradesWithQuotes}
            tradesWithQuotes={readiness.tradesWithQuotes}
            tradeCoverageUncovered={coverage.totals.uncovered}
            requiredTradeCount={analysis?.required_trades?.length ?? 0}
            hasBid={Boolean(bid)}
            bidSubmitted={Boolean(bid?.submitted_at)}
            outcome={bid?.outcome ?? null}
            pastPerfBlocked={opp.past_perf_classification === "prime_only"}
            automationPaused={automation.paused}
            hoursSinceUpdate={hoursSinceUpdate}
            expired={opp.status === "archived" && (opp.risk_flags ?? []).includes("expired")}
          />
        </div>

        {/* Jump links named to match the page sections operators scan for. */}
        <div className="sticky top-0 z-20 mt-3 flex gap-1.5 overflow-x-auto border-y border-border bg-background/95 px-5 py-2 backdrop-blur">
          {[
            ...(readiness.attention.length > 0
              ? [{ href: "#attention", label: "Attention", primary: true as boolean }]
              : []),
            {
              href: "#next",
              label: "Next step",
              primary: readiness.attention.length === 0,
            },
            { href: "#workflow", label: "Workflow", primary: false },
            { href: "#overview", label: "Overview", primary: false },
            ...(coverage.trades.length > 0
              ? [{ href: "#coverage", label: "Coverage", primary: false }]
              : []),
            { href: "#brief", label: "Brief", primary: false },
            ...(showQuotePanel
              ? [{ href: "#quotes", label: "Quotes", primary: false }]
              : []),
            {
              href: "#subs",
              label: `Subs${subs.length ? ` (${subs.length})` : ""}`,
              primary: false,
            },
            ...(breakdown ? [{ href: "#score", label: "Score", primary: false }] : []),
            ...(bid ? [{ href: "#submission", label: "Bid", primary: false }] : []),
            { href: "#docs", label: "Documents", primary: false },
            { href: "#activity", label: "Activity", primary: false },
          ].map((s) => (
            <a
              key={s.href}
              href={s.href}
              className={s.primary ? "jump-chip jump-chip--primary" : "jump-chip"}
            >
              {s.label}
            </a>
          ))}
        </div>

        {/* Workflow — completed / current / next, whose turn. */}
        <div className="space-y-2 px-5 pt-4" id="workflow" data-guide-target="workflow">
          <SectionHeading
            eyebrow="Current workflow"
            title="Where this bid stands"
            tip={termTip("workflow")}
          >
            Completed steps, the active step, and who owns the next move.
          </SectionHeading>
          <OpportunityJourney stage={opp.stage} />
        </div>

        {/* Overview, compact facts (status already in header). */}
        <div className="scroll-mt-12 space-y-3 px-5 pt-5" id="overview" data-guide-target="overview">
          <SectionHeading eyebrow="Opportunity overview" title="Key facts">
            Deadline countdown, value, and identity details.
          </SectionHeading>
          <div className="card">
            <div className="mb-4 rounded-md border border-border bg-surface px-3 py-2.5">
              <p className="label">Time to submit</p>
              <div className="mt-0.5">
                <DeadlineCountdown deadline={opp.deadline} />
              </div>
            </div>

            <p className="label mb-2">Score & money</p>
            <div className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <Fact
                label="Score"
                tip="How well this opportunity fits your profile. Open Score for the full breakdown."
                value={
                  <a href="#score" className="inline-flex hover:opacity-80">
                    <ScoreBadge score={opp.score} />
                  </a>
                }
              />
              <Fact
                label="Recommendation"
                tip="Pursue / Review / No bid from the scoring tier."
                value={<TierBadge tier={opp.tier} />}
              />
              <Fact
                label="Est. value"
                tip="Published contract value when available; otherwise an estimate from the listing or attachments."
                value={
                  opp.value_estimated != null ? (
                    <EstimatedValue
                      value={opp.value_estimated}
                      source={opp.value_estimated_source}
                    />
                  ) : (
                    (analysis?.estimated_value ?? "-")
                  )
                }
              />
              {bestQuote != null && (
                <Fact
                  label="Lowest sub quote"
                  tip="Lowest price entered from a subcontractor so far on this bid."
                  value={<span className="num">{currency(bestQuote)}</span>}
                />
              )}
              {bid?.bid_amount != null && (
                <Fact
                  label="Priced bid"
                  tip="Your assembled bid amount after Bid Builder ran."
                  value={<span className="num text-accent">{currency(bid.bid_amount)}</span>}
                />
              )}
              {requiredTradeCount > 0 && (
                <Fact
                  label="Trades needed"
                  tip="Distinct trades the solicitation appears to require."
                  value={<span className="num">{requiredTradeCount}</span>}
                />
              )}
              <Fact
                label="Subs paired"
                tip="Subcontractors Sub Finder (or you) linked to this opportunity."
                value={
                  <a href="#subs" className="num text-accent hover:underline">
                    {subs.length}
                  </a>
                }
              />
            </div>

            <p className="label mb-2">Identity & place</p>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <Fact
                label="Agency"
                value={[opp.agency, opp.sub_agency].filter(Boolean).join(" · ") || "-"}
              />
              <Fact
                label="Type"
                tip="Sources sought are market research; solicitations are live bids."
                value={opp.is_sources_sought ? "Sources sought" : "Solicitation"}
              />
              <Fact label="NAICS" tip={termTip("naics")} value={opp.naics_code ?? "-"} />
              <Fact label="PSC" tip={termTip("psc")} value={opp.psc_code ?? "-"} />
              <Fact
                label="Set-aside"
                tip={termTip("set_aside")}
                value={opp.set_aside_type ?? "-"}
              />
              <Fact
                label="Place of performance"
                tip={termTip("place_of_performance")}
                value={
                  [opp.location_text, opp.location_state].filter(Boolean).join(", ") || "-"
                }
              />
              <Fact label="Posted" value={shortDate(opp.posted_at)} />
              <Fact label="Solicitation #" value={opp.solicitation_number ?? "-"} />
              <Fact
                label="Past performance"
                tip="Whether the agency requires your company (not just subs) to prove similar prior work."
                value={
                  opp.past_perf_classification
                    ? (PAST_PERF_LABEL[opp.past_perf_classification] ??
                      opp.past_perf_classification.replace(/_/g, " "))
                    : "-"
                }
              />
              {analysis?.submission_method &&
                analysis.submission_method !== NA_TEXT && (
                  <Fact label="How to submit" value={analysis.submission_method} />
                )}
            </div>
            {opp.risk_flags.length > 0 && (
              <div className="mt-4 border-t border-border pt-3">
                <p className="label mb-2">Flags needing attention</p>
                <div className="flex flex-wrap gap-1">
                  {opp.risk_flags.map((f) => (
                    <a
                      key={f}
                      href="#attention"
                      className="badge bg-risk/15 text-risk hover:bg-risk/25"
                      title="Open attention items for what to do next"
                    >
                      ⚠ {flagLabel(f)}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          {opp.tier === "review" && opp.human_action_required && (
            <div className="card space-y-2">
              <p className="eyebrow">Triage</p>
              <div className="flex gap-2">
                <ActionButton
                  endpoint={`/api/opportunities/${opp.id}/action`}
                  body={{ action: "pursue" }}
                  className="btn-success"
                >
                  Pursue
                </ActionButton>
                <ActionButton
                  endpoint={`/api/opportunities/${opp.id}/action`}
                  body={{ action: "dismiss" }}
                  className="btn-danger"
                  confirm="Dismiss this opportunity?"
                >
                  Dismiss
                </ActionButton>
              </div>
            </div>
          )}

          {opp.past_perf_classification === "prime_only" && (
            <div className="card border-risk/50 bg-risk/5">
              <p className="text-sm font-medium text-risk">
                Blocked: prime-only past performance required
              </p>
              <p className="mt-1 text-sm text-slate-700">
                This agency wants proof that your company itself (not your
                subcontractors) has done similar work before. BROST CO does not
                have that track record yet, so automation stopped here. You can
                pursue it anyway as an exception, or dismiss it.
              </p>
            </div>
          )}
        </div>

        {/* Trade coverage — who we found, who responded, what's still open. */}
        <div className="px-5 pt-4">
          <TradeCoverageStrip
            coverage={coverage}
            analysis={analysis as unknown as Record<string, unknown> | null}
            description={opp.description}
            subs={subs.map((s) => ({
              trade: s.trade,
              company_name: s.company_name,
              outreach_state: s.outreach_state,
              has_quote: quotedSubIds.has(s.subcontractor_id),
            }))}
          />
        </div>

        {/* Quote entry, promoted full-width and up front while quotes are the job. */}
        {showQuotePanel && (
          <div className="scroll-mt-12 px-5 pt-5" id="quotes" data-guide-target="quotes">
            <div
              className={`card ${
                emphasizeQuotePanel ? "border-pursue bg-pursue-soft" : ""
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="eyebrow text-pursue-strong">Your turn</p>
                  <h2 className="mt-0.5 font-display text-2xl font-semibold text-foreground">
                    {quotesEntered === 0
                      ? "Enter subcontractor quotes"
                      : "Quotes collected"}
                    <span className="num ml-2 text-base font-normal text-slate-500">
                      {quotesEntered}
                    </span>
                  </h2>
                </div>
                {requiredTradeCount > 0 && (
                  <span className="text-sm text-slate-500">
                    {requiredTradeCount} trade{requiredTradeCount === 1 ? "" : "s"}{" "}
                    needed for this job
                  </span>
                )}
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500">
                Enter each price a subcontractor gave you. As soon as you save,
                the Bid Builder prices and assembles the full package for your
                review. <span className="font-medium text-slate-700">Trade</span>{" "}
                is the type of work (e.g. HVAC, electrical, roofing).{" "}
                <span className="font-medium text-slate-700">Subcontractor</span>{" "}
                is the company giving you that price, pick one you&rsquo;ve
                already found or leave it blank if they&rsquo;re not on file yet.
              </p>

              {(analysis?.required_trades?.length ?? 0) > 0 && (
                <ul className="mt-3 space-y-2">
                  {(analysis?.required_trades ?? []).map((trade) => {
                    const work = resolveSubWork({
                      trade,
                      analysis,
                      description: opp.description,
                      maxChars: 280,
                    });
                    if (!work.work) return null;
                    return (
                      <li key={trade}>
                        <SubWorkNeeded work={work} variant="compact" />
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="mt-4">
                <QuoteEntryForm opportunityId={opp.id} subs={subOptions} />
              </div>

              {quotesEntered > 0 && (
                <div className="mt-5 border-t border-border pt-4">
                  <p className="label mb-2">Quotes on file</p>
                  <ul className="divide-y divide-border text-sm">
                    {(quotes as Record<string, unknown>[]).map((q) => (
                      <li
                        key={String(q.id)}
                        className="flex items-center justify-between py-2"
                      >
                        <span className="min-w-0 truncate text-slate-700">
                          {q.company_name
                            ? String(q.company_name)
                            : q.trade
                              ? String(q.trade)
                              : "Quote"}
                        </span>
                        <span
                          className={`num ${
                            q.is_out_of_range ? "text-review" : "text-slate-700"
                          }`}
                        >
                          {currency(Number(q.quote_amount))}
                          {q.is_out_of_range ? " ⚠" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Bid Brief, always shown; falls back to lightweight header when no analysis yet */}
        <div className="scroll-mt-12 px-5 pt-5" id="brief" data-guide-target="brief">
          {analysis ? (
            <BidBrief analysis={analysis} documents={briefDocs} />
          ) : (
            <div className="card">
              <p className="eyebrow">Plain-English summary</p>
              <p className="mt-2 text-sm text-slate-500">
                The plain-English analysis has not run yet. Everything you need
                is still available below: score, pricing comps, related
                subcontractors, and every original attachment.
              </p>
            </div>
          )}
        </div>

        {/* Subs are the heart of execution after pursue — full width so contact
            status and history are easy to scan before the denser side panels. */}
        <div className="px-5 pt-5">
          <OpportunitySubsPanel
            subs={subs}
            communications={subComms}
            analysis={analysis as unknown as Record<string, unknown> | null}
            description={opp.description}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-3">
          {/* Column 1 — documents, notes */}
          <div className="space-y-4">
            <div id="docs" className="scroll-mt-12 space-y-2">
              <SectionHeading
                eyebrow="Documents"
                title="Files for this bid"
                tip={termTip("documents")}
              >
                Solicitation attachments, generated package pieces, and downloads.
              </SectionHeading>
              <AttachmentsPanel documents={briefDocs} />
            </div>

            <Collapsible title="Notes" defaultOpen={Boolean(opp.notes)}>
              <OpportunityNotes opportunityId={opp.id} initialNotes={opp.notes} />
            </Collapsible>
          </div>

          {/* Column 2, analysis + pricing */}
          <div className="space-y-4">
            {breakdown && <ScoreBreakdownCard breakdown={breakdown} />}

            <PricingCompsCard
              pricing={pricing}
              compareAmount={
                bid?.bid_amount != null && bid.bid_amount > 0
                  ? Number(bid.bid_amount)
                  : bestQuote != null && bestQuote > 0
                    ? bestQuote
                    : opp.value_estimated != null && opp.value_estimated > 0
                      ? Number(opp.value_estimated)
                      : null
              }
              compareLabel={
                bid?.bid_amount != null && bid.bid_amount > 0
                  ? "Your priced bid"
                  : bestQuote != null && bestQuote > 0
                    ? "Lowest sub quote"
                    : opp.value_estimated != null && opp.value_estimated > 0
                      ? "Estimated value"
                      : null
              }
            />

            <CompetitiveLandscape competitors={competitors} pricing={pricing} />
          </div>

          {/* Column 3, quotes + bid + activity */}
          <div className="space-y-4">
            {/* After a bid exists, revisions live here in a compact form; before a
                bid, the full-width panel above owns quote entry (no duplication). */}
            {hasBid && !bidSubmitted && (
              <div className="card scroll-mt-12" id="revise-quotes">
                <p className="eyebrow mb-3">Revise quotes</p>
                <p className="mb-3 text-xs leading-relaxed text-slate-500">
                  Saving a new quote re-prices and rebuilds the bid.
                </p>
                <QuoteEntryForm
                  opportunityId={opp.id}
                  subs={subOptions}
                  layout="stacked"
                />
                {(quotes as Record<string, unknown>[]).length > 0 && (
                  <ul className="mt-4 divide-y divide-border text-sm">
                    {(quotes as Record<string, unknown>[]).map((q) => (
                      <li
                        key={String(q.id)}
                        className="flex items-center justify-between py-2"
                      >
                        <span className="min-w-0 truncate text-slate-700">
                          {q.company_name
                            ? String(q.company_name)
                            : q.trade
                              ? String(q.trade)
                              : "Quote"}
                        </span>
                        <span
                          className={`num ${
                            q.is_out_of_range ? "text-review" : "text-slate-700"
                          }`}
                        >
                          {currency(Number(q.quote_amount))}
                          {q.is_out_of_range ? " ⚠" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {bid && (
              <>
                <div id="submission" className="scroll-mt-4" data-guide-target="submission">
                  <SubmissionPackage
                    opportunityId={opp.id}
                    bid={bid}
                    kindToPath={kindToPath}
                    submissionMethod={
                      analysis?.submission_method && analysis.submission_method !== NA_TEXT
                        ? analysis.submission_method
                        : null
                    }
                    contact={opp.contact_json as { name?: string; email?: string; phone?: string } | null}
                    solicitationNumber={opp.solicitation_number}
                    opportunityTitle={opp.title}
                  />
                </div>
                {bid.submitted_at && (
                  <div className="card space-y-2">
                    <p className="eyebrow">Outcome</p>
                    <p className="text-xs text-pursue">
                      Submitted {timeAgo(bid.submitted_at)}
                    </p>
                    {(!bid.outcome || bid.outcome === "pending") && (
                      <div className="flex gap-2">
                        <ActionButton
                          endpoint={`/api/opportunities/${opp.id}/outcome`}
                          body={{ outcome: "won" }}
                          className="btn-success"
                          confirm="Mark as WON and create contract?"
                        >
                          Won
                        </ActionButton>
                        <ActionButton
                          endpoint={`/api/opportunities/${opp.id}/outcome`}
                          body={{ outcome: "lost" }}
                          className="btn-danger"
                        >
                          Lost
                        </ActionButton>
                      </div>
                    )}
                    {bid.outcome && bid.outcome !== "pending" && (
                      <p className="text-sm font-medium text-slate-700">
                        Outcome: {bid.outcome}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            <div id="activity" className="scroll-mt-12 space-y-2">
              <SectionHeading
                eyebrow="Activity"
                title="What happened"
                tip={termTip("activity")}
              >
                Automation, emails, calls, and your decisions in one timeline.
              </SectionHeading>
              <div className="card">
                <ActivityTimeline events={activity} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <datalist id="trades">
        {analysis?.required_trades?.map((t) => <option key={t} value={t} />)}
      </datalist>
    </div>
  );
}

function Fact({
  label,
  value,
  tip,
}: {
  label: string;
  value: React.ReactNode;
  tip?: string;
}) {
  return (
    <div>
      <p className="label flex items-center gap-1">
        {label}
        {tip ? <InfoTip label={`About ${label}`}>{tip}</InfoTip> : null}
      </p>
      <p className="mt-0.5 text-sm text-slate-800">{value}</p>
    </div>
  );
}
