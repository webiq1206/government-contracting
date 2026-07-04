import { notFound } from "next/navigation";
import { opportunityDetail } from "@/lib/data";
import { PageHeader, ScoreBadge, TierBadge } from "@/components/badges";
import { ActionButton } from "@/components/action-button";
import { QuoteEntryForm } from "@/components/quote-entry-form";
import { currency, currencyCents, countdown, shortDate, timeAgo, pct } from "@/lib/format";
import type { Bid, ScoreBreakdown, SolicitationAnalysis } from "@/lib/types";

export const dynamic = "force-dynamic";

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

  return (
    <div>
      <PageHeader title={opp.title ?? "Opportunity"} subtitle={opp.agency ?? undefined}>
        <TierBadge tier={opp.tier} />
        <span className="badge bg-ink-700 text-slate-300">{opp.stage.replace(/_/g, " ")}</span>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-3">
        {/* Left column: facts + actions */}
        <div className="space-y-4">
          <div className="card">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Fact label="Score" value={<ScoreBadge score={opp.score} />} />
              <Fact label="Value" value={currency(opp.value_estimated)} />
              <Fact label="NAICS" value={opp.naics_code ?? "—"} />
              <Fact label="Set-aside" value={opp.set_aside_type ?? "—"} />
              <Fact label="State" value={opp.location_state ?? "—"} />
              <Fact label="Deadline" value={countdown(opp.deadline)} />
              <Fact label="Solicitation" value={opp.solicitation_number ?? "—"} />
              <Fact
                label="Past perf"
                value={opp.past_perf_classification ?? "—"}
              />
            </div>
            {opp.risk_flags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {opp.risk_flags.map((f) => (
                  <span key={f} className="badge bg-risk/15 text-risk">
                    {f}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Triage actions for review-tier */}
          {opp.tier === "review" && opp.human_action_required && (
            <div className="card space-y-2">
              <p className="label">Triage</p>
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

          {/* prime_only block */}
          {opp.past_perf_classification === "prime_only" && (
            <div className="card border-risk/50 bg-risk/5">
              <p className="text-sm text-risk">
                Past performance is <strong>prime_only</strong> — blocked for human review. We
                cannot yet meet this as prime. Decide whether to pursue as an exception or dismiss.
              </p>
            </div>
          )}

          {/* Documents */}
          {(documents as Record<string, unknown>[]).length > 0 && (
            <div className="card">
              <p className="label mb-2">Documents</p>
              <ul className="space-y-1 text-sm">
                {(documents as Record<string, unknown>[]).map((d) => (
                  <li key={String(d.id)}>
                    <a
                      className="text-brand-400 hover:underline"
                      href={`/api/files/${d.storage_path}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {String(d.name)} <span className="text-slate-500">({String(d.kind)})</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Middle column: analysis + pricing + subs */}
        <div className="space-y-4">
          {breakdown && (
            <div className="card">
              <p className="label mb-2">Score breakdown — {breakdown.total}/100</p>
              <div className="space-y-1.5">
                {breakdown.dimensions.map((d) => (
                  <div key={d.key} className="text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-300">{d.label}</span>
                      <span className="font-mono text-slate-400">
                        {d.points}/{d.max_points}
                      </span>
                    </div>
                    <div className="mt-0.5 h-1 rounded bg-ink-700">
                      <div
                        className="h-1 rounded bg-brand-500"
                        style={{ width: `${(d.points / Math.max(d.max_points, 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              {breakdown.summary && (
                <p className="mt-3 text-xs text-slate-400">{breakdown.summary}</p>
              )}
            </div>
          )}

          {analysis && (
            <div className="card space-y-2 text-sm">
              <p className="label">Solicitation analysis</p>
              <p className="text-slate-300">{analysis.scope_plain_language}</p>
              {analysis.required_trades?.length > 0 && (
                <p className="text-slate-400">
                  <span className="text-slate-500">Trades:</span> {analysis.required_trades.join(", ")}
                </p>
              )}
              {analysis.risk_flags?.length > 0 && (
                <p className="text-slate-400">
                  <span className="text-slate-500">Risks:</span> {analysis.risk_flags.join("; ")}
                </p>
              )}
            </div>
          )}

          {pricing && (
            <div className="card text-sm">
              <p className="label mb-2">Pricing comps (CPI-adjusted)</p>
              <div className="grid grid-cols-2 gap-2 text-slate-300">
                {["count", "median", "average", "p25", "p75"].map((k) =>
                  pricing[k] != null ? (
                    <div key={k} className="flex justify-between">
                      <span className="text-slate-500">{k}</span>
                      <span className="font-mono">
                        {k === "count" ? String(pricing[k]) : currency(Number(pricing[k]))}
                      </span>
                    </div>
                  ) : null
                )}
              </div>
            </div>
          )}

          {subOptions.length > 0 && (
            <div className="card">
              <p className="label mb-2">Subcontractors ({subOptions.length})</p>
              <ul className="space-y-1 text-sm">
                {(subs as Record<string, unknown>[]).slice(0, 12).map((s) => (
                  <li key={String(s.id)} className="flex items-center justify-between">
                    <span className="text-slate-300">
                      {String(s.company_name)}
                      {s.trade ? <span className="text-slate-500"> · {String(s.trade)}</span> : null}
                    </span>
                    <span className="text-xs text-slate-500">
                      {s.outreach_state ? String(s.outreach_state) : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Right column: quotes + bid + submit + outcome */}
        <div className="space-y-4">
          <div className="card">
            <p className="label mb-2">Quote entry</p>
            <QuoteEntryForm opportunityId={opp.id} subs={subOptions} />
            {(quotes as Record<string, unknown>[]).length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {(quotes as Record<string, unknown>[]).map((q) => (
                  <li key={String(q.id)} className="flex justify-between">
                    <span className="text-slate-300">
                      {q.company_name ? String(q.company_name) : q.trade ? String(q.trade) : "Quote"}
                    </span>
                    <span className={`font-mono ${q.is_out_of_range ? "text-review" : "text-slate-300"}`}>
                      {currencyCents(Number(q.quote_amount))}
                      {q.is_out_of_range ? " ⚠" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {bid && (
            <div className="card space-y-2">
              <p className="label">Bid package</p>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-semibold text-white">{currency(bid.bid_amount)}</span>
                <span className="text-sm text-slate-400">margin {pct(bid.margin_pct)}</span>
              </div>
              {bid.qa_checklist && (
                <ul className="mt-2 space-y-1 text-xs">
                  {bid.qa_checklist.map((c, i) => (
                    <li key={i} className={c.ok ? "text-pursue" : "text-review"}>
                      {c.ok ? "✓" : "✗"} {c.item}
                      {c.note ? <span className="text-slate-500"> — {c.note}</span> : null}
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
                  <p className="text-xs text-pursue">Submitted {timeAgo(bid.submitted_at)}</p>
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
                    <p className="text-sm font-medium text-slate-200">Outcome: {bid.outcome}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Activity log */}
          <div className="card">
            <p className="label mb-2">Agent activity</p>
            <ul className="space-y-2 text-xs">
              {(logs as Record<string, unknown>[]).map((l, i) => (
                <li key={i} className="border-l-2 border-ink-700 pl-2">
                  <div className="flex justify-between">
                    <span className="font-medium text-slate-300">{String(l.agent)}</span>
                    <span className="text-slate-600">{timeAgo(String(l.created_at))}</span>
                  </div>
                  <p className="text-slate-400">{String(l.message ?? l.action)}</p>
                </li>
              ))}
              {(logs as Record<string, unknown>[]).length === 0 && (
                <li className="text-slate-600">No activity yet.</li>
              )}
            </ul>
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
      <p className="mt-0.5 text-slate-200">{value}</p>
    </div>
  );
}
