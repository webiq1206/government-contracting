import { notFound } from "next/navigation";
import { opportunityDetail } from "@/lib/data";
import { ScoreBadge, TierBadge } from "@/components/badges";
import { PAGE_HELP } from "@/lib/help-content";
import { HelpPopover } from "@/components/help-popover";
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
import { OpportunityWorkspace } from "@/components/opportunity-workspace";
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

const PAST_PERF_LABEL: Record<string, string> = {
  not_required: "Not required",
  team_accepted: "Team experience accepted",
  prime_only: "Prime-only (blocked)",
};

/**
 * Opportunity Detail: editorial hero + tabs matching the product mock, with
 * every operational panel preserved under Brief / Requirements / Coverage /
 * Pricing / Files / More.
 */
export default async function OpportunityPage({ params }: { params: { id: string } }) {
  const [detail, automation, rules] = await Promise.all([
    opportunityDetail(params.id),
    getAutomationState(),
    getAutomationRules(),
  ]);
  if (!detail) notFound();
  const { opp, quotes, subs, documents, logs, competitors, subComms } = detail;
  const hoursSinceUpdate = opp.updated_at
    ? (Date.now() - new Date(opp.updated_at).getTime()) / 3_600_000
    : null;
  const bid = detail.bid as Bid | null;
  const breakdown = opp.score_breakdown as ScoreBreakdown | null;
  const analysis = opp.solicitation_analysis as SolicitationAnalysis | null;
  const pricing = (opp.raw_json as { pricing_summary?: Record<string, unknown> } | null)
    ?.pricing_summary;
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
  const kindToPath: Record<string, string> = {};
  for (const d of documents as Record<string, unknown>[]) {
    const kind = String(d.kind);
    const path = d.storage_path ? String(d.storage_path) : "";
    if (path && !kindToPath[kind]) kindToPath[kind] = path;
  }
  const quoteAmounts = (quotes as Record<string, unknown>[])
    .map((q) => Number(q.quote_amount))
    .filter((n) => Number.isFinite(n) && n > 0);
  const bestQuote = quoteAmounts.length ? Math.min(...quoteAmounts) : null;
  const requiredTradeCount = analysis?.required_trades?.length ?? 0;

  const quotesEntered = (quotes as unknown[]).length;
  const hasBid = Boolean(bid);
  const bidSubmitted = Boolean(bid?.submitted_at);
  const QUOTE_STAGES = ["sub_research", "outreach", "call_queue", "quote_entry"];
  const showQuotePanel =
    opp.status === "open" &&
    !hasBid &&
    !bidSubmitted &&
    (quotesEntered > 0 || subOptions.length > 0 || QUOTE_STAGES.includes(opp.stage));
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
  const riskFlags = opp.risk_flags ?? [];
  const pastPerfBlocked =
    riskFlags.includes("prime_only_blocked") ||
    (opp.past_perf_classification === "prime_only" &&
      opp.stage === "analysis" &&
      Boolean(opp.human_action_required));
  const CONTACTED = new Set([
    "sent",
    "followed_up",
    "responsive",
    "called",
    "quoted",
  ]);
  const outreachStates = subs.map((s) => s.outreach_state ?? "");
  const outreachDraftOnly =
    (opp.stage === "outreach" || opp.stage === "sub_research") &&
    (riskFlags.includes("outreach_send_failed") ||
      (outreachStates.length > 0 &&
        outreachStates.every((st) => !CONTACTED.has(st)) &&
        outreachStates.some((st) =>
          ["draft", "send_failed", "email_unverified"].includes(st)
        )));

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
    tier: opp.tier,
    pastPerfBlocked,
    completenessMissing: analysis?.completeness?.missing ?? null,
    packageBlockers: (bid?.validation_json as { blockers?: string[] } | null)?.blockers ?? null,
  });
  const activity = buildActivityTimeline({
    logs,
    communications: subComms,
    limit: 40,
  });

  const place =
    [opp.location_text, opp.location_state].filter(Boolean).join(", ") ||
    (analysis?.location && analysis.location !== NA_TEXT ? analysis.location : null);
  const contractKind = opp.is_sources_sought
    ? "Sources sought"
    : opp.set_aside_type
      ? opp.set_aside_type
      : "Service contract";
  const metaLine = [
    place,
    contractKind,
    opp.deadline ? `Due ${shortDate(opp.deadline)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const whyHeadline =
    analysis?.pursue_recommendation?.trim() ||
    breakdown?.summary?.trim() ||
    "Fit details appear once scoring and analysis finish.";
  const whyBody =
    analysis?.project_overview?.trim() && analysis.project_overview !== NA_TEXT
      ? analysis.project_overview
      : analysis?.scope_plain_language?.trim() && analysis.scope_plain_language !== NA_TEXT
        ? analysis.scope_plain_language
        : "Open Requirements for identity details, Coverage for trades, and Pricing when quotes are ready.";

  const matchBadges = buildMatchBadges({
    naics: opp.naics_code,
    location: place,
    setAside: opp.set_aside_type,
    breakdown,
    riskCount: opp.risk_flags?.length ?? 0,
  });

  const pricingCompareAmount =
    bid?.bid_amount != null && bid.bid_amount > 0
      ? Number(bid.bid_amount)
      : bestQuote != null && bestQuote > 0
        ? bestQuote
        : opp.value_estimated != null && opp.value_estimated > 0
          ? Number(opp.value_estimated)
          : null;
  const pricingCompareLabel =
    bid?.bid_amount != null && bid.bid_amount > 0
      ? "Your priced bid"
      : bestQuote != null && bestQuote > 0
        ? "Lowest sub quote"
        : opp.value_estimated != null && opp.value_estimated > 0
          ? "Estimated value"
          : null;

  return (
    <div className="flex page-shell bg-background">
      {/* Thin utility bar stays pinned; hero scrolls with content. */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-[0.65rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Opportunity
            {opp.solicitation_number ? ` · ${opp.solicitation_number}` : ""}
          </p>
          <HelpPopover help={PAGE_HELP["opportunity"]} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="badge bg-surface-raised text-slate-600">{stageLabel(opp.stage)}</span>
          {opp.tier ? (
            <span
              className={`badge uppercase ${
                opp.tier === "pursue"
                  ? "bg-pursue-soft text-pursue-strong"
                  : opp.tier === "review"
                    ? "bg-review/15 text-review"
                    : "bg-surface-raised text-slate-600"
              }`}
            >
              {opp.tier}
            </span>
          ) : null}
        </div>
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto">
        <header className="border-b border-border px-4 py-4 sm:px-6 sm:py-8">
          <div className="flex flex-wrap items-start justify-between gap-4 sm:gap-6">
            <div className="min-w-0 max-w-3xl flex-1">
              {opp.agency && <p className="eyebrow-gold">{opp.agency}</p>}
              <h1 className="mt-2 font-display text-2xl leading-[1.15] text-foreground sm:mt-3 sm:text-4xl lg:text-[2.75rem]">
                {opp.title ?? "Opportunity"}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground sm:mt-3">
                {metaLine || "Details loading"}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 sm:mt-4">
                <TierBadge tier={opp.tier} />
                <DeadlineBadge deadline={opp.deadline} rules={rules} showDate />
                {opp.naics_code ? (
                  <span className="badge bg-surface-raised text-slate-600">
                    NAICS {opp.naics_code}
                  </span>
                ) : null}
              </div>
            </div>
            <ScoreBadge score={opp.score} variant="box" />
          </div>
        </header>
        <OpportunityWorkspace
          banner={
            <div className="space-y-3 px-5 pt-4 sm:px-6">
              <div className="rounded-md border border-border/55 bg-surface/80 px-3 py-2.5 dark:border-white/10">
                <p className="mb-1.5 text-[0.65rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Where this stands
                </p>
                <OpportunityJourney stage={opp.stage} />
              </div>
              <div id="next" data-guide-target="next-step">
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
                  pastPerfBlocked={pastPerfBlocked}
                  automationPaused={automation.paused}
                  hoursSinceUpdate={hoursSinceUpdate}
                  expired={
                    opp.status === "archived" && (opp.risk_flags ?? []).includes("expired")
                  }
                  hasQuotes={quotesEntered > 0}
                  outreachDraftOnly={outreachDraftOnly}
                  riskFlags={opp.risk_flags}
                />
              </div>
              <AttentionStrip readiness={readiness} opportunityId={opp.id} />
            </div>
          }
          brief={
            <div
              className="scroll-mt-editorial space-y-8 px-5 py-8 sm:px-6"
              id="brief"
              data-guide-target="brief"
            >
              <div className="grid gap-10 lg:grid-cols-2 lg:gap-0">
                <div className="lg:border-r lg:border-border lg:pr-10">
                  <h2 className="font-display text-lg font-semibold leading-tight text-foreground sm:text-xl">
                    Why this fits
                  </h2>
                  <p className="mt-2 font-display text-2xl font-semibold leading-snug text-foreground sm:text-3xl">
                    {whyHeadline}
                  </p>
                  <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                    {whyBody}
                  </p>
                  {matchBadges.length > 0 && (
                    <div className="mt-6 flex flex-wrap gap-2">
                      {matchBadges.map((b) => (
                        <span
                          key={b.label}
                          className={
                            b.tone === "risk"
                              ? "badge bg-review/15 text-review"
                              : "badge-match"
                          }
                        >
                          {b.tone === "risk" ? "!! " : "✓ "}
                          {b.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="lg:pl-10">
                  {breakdown ? (
                    <ScoreBreakdownCard breakdown={breakdown} />
                  ) : (
                    <div className="rounded-md border border-border/55 bg-surface p-5 dark:border-white/10">
                      <h2 className="font-display text-lg font-semibold leading-tight text-foreground sm:text-xl">
                        Score breakdown
                      </h2>
                      <p className="mt-3 text-sm text-muted-foreground">
                        Scoring has not finished yet. The fit score box updates when dimensions
                        land.
                      </p>
                      <div className="mt-4">
                        <ScoreBadge score={opp.score} />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {analysis ? (
                <BidBrief analysis={analysis} documents={briefDocs} />
              ) : (
                <div className="card">
                  <h2 className="font-display text-lg font-semibold leading-tight text-foreground sm:text-xl">
                    Plain-English summary
                  </h2>
                  <p className="mt-2 text-sm text-slate-500">
                    The plain-English analysis has not run yet. Everything you need is still
                    available in the other tabs: score, pricing, subcontractors, and original
                    attachments.
                  </p>
                </div>
              )}
            </div>
          }
          requirements={
            <div
              className="scroll-mt-editorial space-y-4 px-5 py-8 sm:px-6"
              id="requirements"
              data-guide-target="requirements"
            >
              <SectionHeading eyebrow="Requirements" title="Key facts">
                Deadline countdown, value, identity, and eligibility details.
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
                    tip="How well this opportunity fits your profile. Open Brief for the full breakdown."
                    value={
                      <a href="#brief" className="inline-flex hover:opacity-80">
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
                      value={
                        <span className="num text-accent">{currency(bid.bid_amount)}</span>
                      }
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
                      <a href="#coverage" className="num text-accent hover:underline">
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
                    value={place || "-"}
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
                  <h2 className="font-display text-lg font-semibold leading-tight text-foreground sm:text-xl">
                    Triage
                  </h2>
                  <p className="text-sm text-slate-600">
                    Pursue or pass from the Next step banner at the top of this page.
                  </p>
                  <a href="#next-step" className="btn-ghost text-xs">
                    Use Next step above
                  </a>
                </div>
              )}

              {pastPerfBlocked && (
                <div className="card border-risk/50 bg-risk/5">
                  <p className="text-sm font-medium text-risk">
                    Blocked: prime-only past performance required
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    This agency wants proof that your company itself (not your subcontractors)
                    has done similar work before. Brost Co does not have that track record yet,
                    so automation stopped here. You can pursue it anyway as an exception, or
                    dismiss it.
                  </p>
                  <a href="#next-step" className="btn-ghost mt-2 inline-flex text-xs">
                    Use Next step above
                  </a>
                </div>
              )}
            </div>
          }
          coverage={
            <div className="space-y-6 px-5 py-8 sm:px-6" id="coverage">
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
              <div id="subs" data-guide-target="subs">
                <OpportunitySubsPanel
                  subs={subs}
                  communications={subComms}
                  analysis={analysis as unknown as Record<string, unknown> | null}
                  description={opp.description}
                />
              </div>
            </div>
          }
          pricing={
            <div className="space-y-6 px-5 py-8 sm:px-6">
              {showQuotePanel && (
                <div
                  className="scroll-mt-editorial"
                  id="quotes"
                  data-guide-target="quotes"
                >
                  <div
                    className={`card ${
                      emphasizeQuotePanel ? "border-pursue bg-pursue-soft" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <p className="eyebrow text-pursue-strong">Your turn</p>
                        <h2 className="mt-0.5 font-display text-2xl font-normal text-foreground">
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
                          {requiredTradeCount} trade
                          {requiredTradeCount === 1 ? "" : "s"} needed for this job
                        </span>
                      )}
                    </div>
                    <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500">
                      Enter each price a subcontractor gave you. As soon as you save, the Bid
                      Builder prices and assembles the full package for your review.{" "}
                      <span className="font-medium text-slate-700">Trade</span> is the type of
                      work (e.g. HVAC, electrical, roofing).{" "}
                      <span className="font-medium text-slate-700">Subcontractor</span> is the
                      company giving you that price; pick one you have already found or leave
                      it blank if they are not on file yet.
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

              {hasBid && !bidSubmitted && (
                <div className="card scroll-mt-editorial" id="revise-quotes">
                  <h2 className="mb-3 font-display text-lg font-semibold leading-tight text-foreground sm:text-xl">
                    Revise quotes
                  </h2>
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

              <PricingCompsCard
                pricing={pricing}
                compareAmount={pricingCompareAmount}
                compareLabel={pricingCompareLabel}
              />

              <CompetitiveLandscape competitors={competitors} pricing={pricing} />

              {bid && (
                <>
                  <div
                    id="submission"
                    className="scroll-mt-editorial"
                    data-guide-target="submission"
                  >
                    <SubmissionPackage
                      opportunityId={opp.id}
                      bid={bid}
                      kindToPath={kindToPath}
                      submissionMethod={
                        analysis?.submission_method &&
                        analysis.submission_method !== NA_TEXT
                          ? analysis.submission_method
                          : null
                      }
                      contact={
                        opp.contact_json as {
                          name?: string;
                          email?: string;
                          phone?: string;
                        } | null
                      }
                      solicitationNumber={opp.solicitation_number}
                      opportunityTitle={opp.title}
                    />
                  </div>
                  {bid.submitted_at && (
                    <div className="card space-y-2">
                      <h2 className="font-display text-lg font-semibold leading-tight text-foreground sm:text-xl">
                        Outcome
                      </h2>
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

              {!showQuotePanel && !hasBid && (
                <div className="card">
                  <h2 className="font-display text-lg font-semibold leading-tight text-foreground sm:text-xl">
                    Pricing
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Quote entry opens once this opportunity reaches capture. Pricing comps and
                    the bid package will appear here when available.
                  </p>
                </div>
              )}
            </div>
          }
          files={
            <div className="space-y-4 px-5 py-8 sm:px-6" id="docs">
              <SectionHeading
                eyebrow="Documents"
                title="Files for this bid"
                tip={termTip("documents")}
              >
                Solicitation attachments, generated package pieces, and downloads.
              </SectionHeading>
              <AttachmentsPanel documents={briefDocs} />
              <Collapsible title="Notes" defaultOpen={Boolean(opp.notes)}>
                <OpportunityNotes opportunityId={opp.id} initialNotes={opp.notes} />
              </Collapsible>
            </div>
          }
          more={
            <div className="space-y-8 px-5 py-8 sm:px-6">
              <div id="workflow" data-guide-target="workflow" className="space-y-2">
                <SectionHeading
                  eyebrow="Current workflow"
                  title="Where this bid stands"
                  tip={termTip("workflow")}
                >
                  Same tracker as the top banner. Use Next step for the action to take now.
                </SectionHeading>
                <OpportunityJourney stage={opp.stage} />
                <a href="#next-step" className="btn-ghost text-xs">
                  Jump to Next step
                </a>
              </div>

              <div id="activity" className="scroll-mt-editorial space-y-2">
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
          }
        />
      </div>

      <datalist id="trades">
        {analysis?.required_trades?.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </div>
  );
}

function buildMatchBadges({
  naics,
  location,
  setAside,
  breakdown,
  riskCount,
}: {
  naics: string | null;
  location: string | null;
  setAside: string | null;
  breakdown: ScoreBreakdown | null;
  riskCount: number;
}): { label: string; tone: "ok" | "risk" }[] {
  const badges: { label: string; tone: "ok" | "risk" }[] = [];
  const dims = breakdown?.dimensions ?? [];
  const positive = (keyPart: string) =>
    dims.some(
      (d) =>
        d.points > 0 &&
        (d.key.toLowerCase().includes(keyPart) || d.label.toLowerCase().includes(keyPart))
    );

  if (naics || positive("naics") || positive("trade")) {
    badges.push({ label: "NAICS match", tone: "ok" });
  }
  if (location || positive("geo") || positive("location") || positive("service")) {
    badges.push({ label: "Service area", tone: "ok" });
  }
  if (setAside || positive("set") || positive("size")) {
    badges.push({ label: "Size band", tone: "ok" });
  }
  if (riskCount > 0) {
    badges.push({
      label: `${riskCount} risk${riskCount === 1 ? "" : "s"} to review`,
      tone: "risk",
    });
  }
  return badges;
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
