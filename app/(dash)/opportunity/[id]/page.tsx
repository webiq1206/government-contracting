import Link from "next/link";
import { notFound } from "next/navigation";
import { opportunityDetail } from "@/lib/data";
import { PageHeader, ScoreBadge, TierBadge } from "@/components/badges";
import { ActionButton } from "@/components/action-button";
import { QuoteEntryForm } from "@/components/quote-entry-form";
import { BidBrief } from "@/components/bid-brief";
import { AttachmentsPanel } from "@/components/attachments-panel";
import { currency, currencyCents, countdown, timeAgo, pct, shortDate } from "@/lib/format";
import type { Bid, ScoreBreakdown, SolicitationAnalysis } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Plain-English labels for internal enums shown on this page. */
const PAST_PERF_LABEL: Record<string, string> = {
  not_required: "Not required",
  team_accepted: "Team experience accepted",
  prime_only: "Prime-only (blocked)",
};

const OUTREACH_LABEL: Record<string, string> = {
  pending: "Not contacted yet",
  sent: "Email sent",
  followed_up: "Followed up",
  responsive: "Responded",
  unresponsive: "No response",
  declined: "Declined",
};

/**
 * The Opportunity Detail page is the single source of truth for one bid.
 * Every card and list here is the authoritative view; changes made in Call
 * Workspace, Quote Entry, or Review flow refresh into these panels on the
 * next server render (all wrapping views call `router.refresh()` after save).
 */
export default async function OpportunityPage({ params }: { params: { id: string } }) {
  const detail = await opportunityDetail(params.id);
  if (!detail) notFound();
  const { opp, quotes, subs, documents, logs } = detail;
  const bid = detail.bid as Bid | null;
  const breakdown = opp.score_breakdown as ScoreBreakdown | null;
  const analysis = opp.solicitation_analysis as SolicitationAnalysis | null;
  const pricing = (opp.raw_json as { pricing_summary?: Record<string, unknown> } | null)?.pricing_summary;
  const subOptions = (subs as Record<string, unknown>[]).map((s) => ({
    subcontractor_id: String(s.subcontractor_id),
    company_name: String(s.company_name),
    trade: (s.trade as string) ?? null,
  }));
  const briefDocs = (documents as Record<string, unknown>[]).map((d) => ({
    id: String(d.id),
    name: String(d.name),
    kind: String(d.kind),
    storage_path: (d.storage_path as string) ?? null,
    meta: (d.meta as { source_url?: string }) ?? null,
  }));

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title={opp.title ?? "Opportunity"}
        eyebrow={[opp.agency, opp.solicitation_number].filter(Boolean).join(" · ") || undefined}
        subtitle={`${opp.naics_code ? "NAICS " + opp.naics_code + " · " : ""}${opp.set_aside_type ?? ""}`}
      >
        <TierBadge tier={opp.tier} />
        <span className="badge bg-surface text-slate-600">
          {opp.stage.replace(/_/g, " ")}
        </span>
      </PageHeader>

      <div className="scroll-thin flex-1 overflow-y-auto">
        {/* Bid Brief — always shown; falls back to lightweight header when no analysis yet */}
        <div className="px-5 pt-5">
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

        <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-3">
          {/* Column 1 — facts + triage */}
          <div className="space-y-4">
            <div className="card">
              <p className="eyebrow mb-3">At a glance</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Fact label="Score" value={<ScoreBadge score={opp.score} />} />
                <Fact label="Value" value={currency(opp.value_estimated)} />
                <Fact label="NAICS" value={opp.naics_code ?? "—"} />
                <Fact label="Set-aside" value={opp.set_aside_type ?? "—"} />
                <Fact label="State" value={opp.location_state ?? "—"} />
                <Fact label="Deadline" value={countdown(opp.deadline)} />
                <Fact label="Solicitation" value={opp.solicitation_number ?? "—"} />
                <Fact
                  label="Past performance"
                  value={
                    opp.past_perf_classification
                      ? (PAST_PERF_LABEL[opp.past_perf_classification] ??
                        opp.past_perf_classification.replace(/_/g, " "))
                      : "—"
                  }
                />
              </div>
              {opp.risk_flags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {opp.risk_flags.map((f) => (
                    <span key={f} className="badge bg-risk/15 text-risk">
                      ⚠ {f}
                    </span>
                  ))}
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
                  subcontractors) has done similar work before. BROSTCO does not
                  have that track record yet, so automation stopped here. You can
                  pursue it anyway as an exception, or dismiss it.
                </p>
              </div>
            )}

            {/* Always-visible attachments panel, so the record is complete even
                if the AI analysis has not run yet. */}
            <AttachmentsPanel documents={briefDocs} />
          </div>

          {/* Column 2 — analysis + pricing + subs */}
          <div className="space-y-4">
            {breakdown && (
              <div className="card">
                <p className="eyebrow mb-3">
                  Score breakdown · <span className="num">{breakdown.total}/100</span>
                </p>
                <div className="space-y-2">
                  {breakdown.dimensions.map((d) => (
                    <div key={d.key} className="text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-700">{d.label}</span>
                        <span className="num text-slate-500">
                          {d.points}/{d.max_points}
                        </span>
                      </div>
                      <div className="mt-0.5 h-1 rounded-full bg-surface">
                        <div
                          className="h-1 rounded-full bg-accent"
                          style={{
                            width: `${(d.points / Math.max(d.max_points, 1)) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {breakdown.summary && (
                  <p className="mt-3 text-xs text-slate-500">{breakdown.summary}</p>
                )}
              </div>
            )}

            {pricing && (
              <div className="card text-sm">
                <p className="eyebrow mb-3">Pricing comps · CPI-adjusted</p>
                <div className="grid grid-cols-2 gap-2 text-slate-700">
                  {["count", "median", "average", "p25", "p75"].map((k) =>
                    pricing[k] != null ? (
                      <div key={k} className="flex justify-between">
                        <span className="text-slate-500">{k}</span>
                        <span className="num">
                          {k === "count"
                            ? String(pricing[k])
                            : currency(Number(pricing[k]))}
                        </span>
                      </div>
                    ) : null,
                  )}
                </div>
              </div>
            )}

            <div className="card">
              <p className="eyebrow mb-3">
                Subcontractors · <span className="num">{subOptions.length}</span>
              </p>
              {subOptions.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No subs paired yet. Sub Finder will run once this opportunity
                  is pursued.
                </p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {(subs as Record<string, unknown>[]).slice(0, 12).map((s) => (
                    <li key={String(s.id)}>
                      <Link
                        href={`/subs/${String(s.subcontractor_id)}`}
                        className="flex items-center justify-between py-2 hover:text-accent"
                      >
                        <span className="min-w-0 truncate text-slate-700">
                          {String(s.company_name)}
                          {s.trade ? (
                            <span className="text-slate-500">
                              {" "}
                              · {String(s.trade)}
                            </span>
                          ) : null}
                        </span>
                        <span className="text-xs text-slate-500">
                          {s.outreach_state
                            ? (OUTREACH_LABEL[String(s.outreach_state)] ??
                              String(s.outreach_state).replace(/_/g, " "))
                            : ""}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Column 3 — quotes + bid + activity */}
          <div className="space-y-4">
            <div className="card">
              <p className="eyebrow mb-3">Quote entry</p>
              <QuoteEntryForm opportunityId={opp.id} subs={subOptions} />
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
                        {currencyCents(Number(q.quote_amount))}
                        {q.is_out_of_range ? " ⚠" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {bid && (
              <div className="card space-y-3">
                <p className="eyebrow">Bid package</p>
                <div className="flex items-baseline justify-between">
                  <span className="num font-serif text-3xl font-semibold text-foreground">
                    {currency(bid.bid_amount)}
                  </span>
                  <span className="text-sm text-slate-500">
                    margin {pct(bid.margin_pct)}
                  </span>
                </div>
                {bid.qa_checklist && (
                  <ul className="space-y-1 text-xs">
                    {bid.qa_checklist.map((c, i) => (
                      <li
                        key={i}
                        className={c.ok ? "text-pursue" : "text-review"}
                      >
                        {c.ok ? "✓" : "✗"} {c.item}
                        {c.note ? (
                          <span className="text-slate-500"> · {c.note}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {bid.human_flags?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {bid.human_flags.map((f) => (
                      <span key={f} className="badge bg-review/15 text-review">
                        {f}
                      </span>
                    ))}
                  </div>
                )}
                {!bid.submitted_at && (
                  <ActionButton
                    endpoint={`/api/opportunities/${opp.id}/submit`}
                    className="btn-primary w-full"
                    confirm="Submit this bid package?"
                  >
                    Submit bid
                  </ActionButton>
                )}
                {bid.submitted_at && (
                  <div className="space-y-2">
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
              </div>
            )}

            <div className="card">
              <p className="eyebrow mb-3">Agent activity</p>
              <ul className="space-y-2 text-xs">
                {(logs as Record<string, unknown>[]).slice(0, 20).map((l, i) => (
                  <li
                    key={i}
                    className="border-l-2 border-border pl-2"
                  >
                    <div className="flex justify-between">
                      <span className="font-medium text-slate-700">
                        {String(l.agent)}
                      </span>
                      <span className="text-slate-500">
                        {timeAgo(String(l.created_at))}
                      </span>
                    </div>
                    <p className="text-slate-500">
                      {String(l.message ?? l.action)}
                    </p>
                    {l.created_at ? (
                      <p className="text-slate-400">{shortDate(String(l.created_at))}</p>
                    ) : null}
                  </li>
                ))}
                {(logs as Record<string, unknown>[]).length === 0 && (
                  <li className="text-slate-500">No activity yet.</li>
                )}
              </ul>
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

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className="mt-0.5 text-sm text-slate-800">{value}</p>
    </div>
  );
}
