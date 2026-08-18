/**
 * PRICING RESEARCH, triggered at the pursue tier, in parallel with the
 * Solicitation Analyst. Pure API + math (no Claude), so it runs even when Claude
 * is not configured (worksWithoutClaude: true).
 *
 * For the opportunity's NAICS + state it pulls the last 36 months of USASpending
 * prime awards, inflation-adjusts each to the current year via BLS CPI, computes
 * comp statistics (count/avg/median/p25/p75), detects a likely incumbent
 * (recompete signal), and models target bid ranges for each margin scenario in
 * the profile using the median comp as a rough sub-cost proxy (clearly labeled an
 * estimate). It writes one pricing_comps row per adjusted award and folds a
 * compact pricing_summary into opportunities.raw_json.
 */
import { query, queryOne } from "../db";
import { getProfileJson } from "../ai/companyProfile";
import { logAgent } from "../logger";
import { usaspending } from "../integrations/usaspending";
import { bls } from "../integrations/bls";
import { bidForTargetMargin, compStats, round2 } from "../domain/pricing";
import { readCompReliability } from "../domain/comp-reliability";
import type { AgentDefinition } from "./types";
import type { AgentResult, Opportunity } from "../types";

/** Year from an ISO/date-ish string, or NaN. */
function yearOf(dateStr: string): number {
  const y = new Date(dateStr).getFullYear();
  return Number.isFinite(y) ? y : NaN;
}

export const pricingResearch: AgentDefinition = {
  name: "pricing-research",
  label: "Pricing Research",
  description:
    "Pulls historical USASpending awards for the NAICS+state, CPI-adjusts them, computes comp stats, detects incumbents, and models target bid ranges.",
  cron: undefined,
  worksWithoutClaude: true, // pure API + math; no Claude needed
  async handler(ctx): Promise<AgentResult> {
    const opportunityId = ctx.payload.opportunityId as string;
    if (!opportunityId) return { ok: false, summary: "no opportunityId in payload" };

    const opp = await queryOne<Opportunity>(`select * from opportunities where id = $1`, [
      opportunityId,
    ]);
    if (!opp) return { ok: false, summary: `opportunity ${opportunityId} not found` };

    const profile = await getProfileJson();
    if (!profile) return { ok: false, summary: "no active Company Profile" };

    const naics = opp.naics_code;
    const state = opp.location_state;
    if (!naics) {
      await logAgent({
        agent: "pricing-research",
        action: "research",
        opportunityId,
        level: "warn",
        status: "skipped",
        message: "opportunity has no NAICS code, cannot pull comps.",
      });
      return { ok: true, summary: "No NAICS on opportunity, pricing research skipped." };
    }

    // 1) Last 36 months of awards for this NAICS (+ state when known).
    const { results: awards, error: awardsError } = await usaspending.searchAwards({
      naics,
      state: state ?? undefined,
      limit: 100,
    });
    if (awardsError) {
      // Do NOT write pricing built on a failed lookup: zero comps from an
      // outage produces median $0 and $0 target bids that look like data.
      await logAgent({
        agent: "pricing-research",
        action: "comps",
        opportunityId,
        level: "error",
        status: "error",
        message: `USASpending could not be reached (${awardsError}), so no comps were pulled. Pricing was left untouched rather than written as zeros; it retries on the next run.`,
      });
      return {
        ok: false,
        summary: `Pricing research failed: USASpending unavailable (${awardsError}).`,
      };
    }

    // 2) CPI series for inflation adjustment.
    const currentYear = new Date().getFullYear();
    const seriesId = profile.pricing_rules?.cpi_series_id ?? "CUUR0000SA0";
    const cpiByYear = await bls.getCpiSeries(seriesId, currentYear - 4, currentYear);

    // Adjust TO the latest year CPI is actually published for, not the calendar
    // current year. BLS lags, so early in a year (or for any not-yet-published
    // year) cpiByYear[currentYear] is missing; using it as the numerator made
    // every award fail the CPI check and drop out, leaving empty comp stats
    // (median 0 → target bids 0 → the "bid within comps" QA gate silently off).
    const cpiYears = Object.keys(cpiByYear)
      .map(Number)
      .filter((y) => Number.isFinite(y) && cpiByYear[y] > 0)
      .sort((a, b) => a - b);
    const refYear = cpiYears.length ? cpiYears[cpiYears.length - 1] : currentYear;

    // 3) Adjust each award to reference-year dollars and stage comp rows.
    const adjustedAmounts: number[] = [];
    const compRows: {
      award_amount: number;
      award_amount_adj: number;
      awarded_at: string | null;
      recipient_name: string;
      agency: string;
    }[] = [];

    // Every positive-value award feeds the comp stats. Each is CPI-adjusted to
    // reference-year dollars when its year is known and in the CPI series, and
    // used at nominal value otherwise (many USASpending award rows carry no
    // usable date). Previously undated awards were dropped whenever CPI was
    // available, which silently emptied the stats (median 0 → target bids 0 →
    // the price-sanity QA gate off) any time award dates were missing.
    for (const a of awards) {
      const awardYear = yearOf(a.action_date);
      const haveCpi =
        Number.isFinite(awardYear) && !!cpiByYear[awardYear] && !!cpiByYear[refYear];
      const adj = haveCpi
        ? round2(a.award_amount * (cpiByYear[refYear] / cpiByYear[awardYear]))
        : round2(a.award_amount);
      if (a.award_amount > 0) adjustedAmounts.push(adj);
      compRows.push({
        award_amount: round2(a.award_amount),
        award_amount_adj: adj,
        awarded_at: a.action_date || null,
        recipient_name: a.recipient_name,
        agency: a.awarding_agency,
      });
    }

    const stats = compStats(adjustedAmounts);

    // 4) Incumbent / recompete detection.
    const incumbent = state ? await usaspending.findIncumbent(naics, state) : null;

    // 5) Target bid ranges per margin scenario, using median comp as sub-cost proxy.
    //
    // The proxy is only meaningful when the awards behind it describe the same
    // kind of work. Read that first so the summary can carry the verdict to
    // everything downstream (the comps card, the out-of-range flags, the QA
    // gate) instead of each caller trusting the median on sight.
    const reliability = readCompReliability(stats, {
      incumbentLastAward: incumbent ? round2(incumbent.award_amount) : null,
    });
    const marginScenarios = profile.pricing_rules?.margin_scenarios ?? [];
    const subCostProxy = stats.median; // rough baseline, an ESTIMATE, not a quote
    const targetBidRanges = marginScenarios.map((marginPct) => ({
      margin_pct: marginPct,
      target_bid: subCostProxy > 0 ? bidForTargetMargin(subCostProxy, marginPct) : 0,
    }));

    // 6) Persist comp rows (mark the incumbent's rows).
    for (const row of compRows) {
      const isIncumbent = !!incumbent && row.recipient_name === incumbent.recipient_name;
      await query(
        `insert into pricing_comps
           (opportunity_id, naics_code, state, award_amount, award_amount_adj,
            awarded_at, recipient_name, agency, is_incumbent, raw_json)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          opportunityId,
          naics,
          state ?? null,
          row.award_amount,
          row.award_amount_adj,
          row.awarded_at,
          row.recipient_name,
          row.agency,
          isIncumbent,
          JSON.stringify(row),
        ]
      );
    }

    // 7) Compact summary, folded into opportunities.raw_json (no dedicated column).
    const pricingSummary = {
      naics,
      state: state ?? null,
      cpi_series_id: seriesId,
      current_year: refYear,
      comp_count: stats.count,
      comp_stats: stats,
      sub_cost_proxy_estimate: subCostProxy,
      comp_reliability: {
        level: reliability.level,
        spread_ratio: reliability.spreadRatio,
        skew_ratio: reliability.skewRatio,
        usable_as_benchmark: reliability.usableAsBenchmark,
        verdict: reliability.verdict,
        guidance: reliability.guidance,
      },
      sub_cost_proxy_note: reliability.usableAsBenchmark
        ? "Sub-cost proxy uses the median CPI-adjusted historical award as a baseline; target bids are ESTIMATES pending real subcontractor quotes."
        : `${reliability.verdict} ${reliability.guidance} The target bids below are arithmetic on that median, so treat them as unfounded until real subcontractor quotes land.`,
      target_bid_ranges: targetBidRanges,
      incumbent: incumbent
        ? {
            recipient_name: incumbent.recipient_name,
            last_award_amount: round2(incumbent.award_amount),
            last_action_date: incumbent.action_date,
          }
        : null,
      is_recompete: !!incumbent,
    };

    await query(
      `update opportunities
         set raw_json = coalesce(raw_json,'{}'::jsonb) || $2::jsonb
       where id = $1`,
      [opportunityId, JSON.stringify({ pricing_summary: pricingSummary })]
    );

    const reasoning = [
      `Pulled ${awards.length} awards for NAICS ${naics}${state ? ` in ${state}` : ""} over the last 36 months.`,
      `CPI-adjusted to ${refYear} dollars via BLS series ${seriesId} (${cpiYears.length} years available).`,
      `Comp stats, count ${stats.count}, median $${stats.median}, avg $${stats.average}, p25 $${stats.p25}, p75 $${stats.p75}.`,
      incumbent
        ? `Likely incumbent: ${incumbent.recipient_name} (last award $${round2(incumbent.award_amount)} on ${incumbent.action_date}), recompete signal.`
        : "No incumbent detected.",
      `Modeled target bids from median proxy for scenarios: ${targetBidRanges
        .map((t) => `${t.margin_pct}% → $${t.target_bid}`)
        .join(", ")}. These are estimates pending real sub quotes.`,
    ].join(" ");

    await logAgent({
      agent: "pricing-research",
      action: "research",
      opportunityId,
      message: `priced from ${stats.count} comps (median $${stats.median})${
        incumbent ? `; incumbent ${incumbent.recipient_name}` : ""
      }`,
      reasoning,
      output: pricingSummary,
    });

    return {
      ok: true,
      summary: `Pricing research: ${stats.count} comps, median $${stats.median}${
        incumbent ? ` (recompete, incumbent ${incumbent.recipient_name})` : ""
      }.`,
      reasoning,
      data: pricingSummary,
    };
  },
};
