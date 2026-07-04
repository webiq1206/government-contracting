/**
 * SUB FINDER — triggered when an opportunity advances to sub_research.
 * For each required trade (from the Solicitation Analyst, falling back to the
 * profile's primary trades) it searches Google Places for candidate
 * subcontractors in the opportunity's geographic area, scores each 0-100 from
 * the available Google signals (rating, review volume, plus a base of 40 that
 * later verification tops up with license/age/SB), ranks them, upserts each
 * into the subcontractors table (deduped by company_name + state), records the
 * candidate set in opportunity_subs, and enqueues Sub Verify for the top N per
 * trade. Trades that turn up fewer than two candidates flag the opportunity for
 * human review.
 */
import { query, queryOne } from "../db";
import { getProfileJson } from "../ai/companyProfile";
import { logAgent } from "../logger";
import { googleMaps, type Contractor } from "../integrations/googleMaps";
import type { AgentDefinition } from "./types";
import type { AgentResult, Opportunity } from "../types";

/** Score a Google Places candidate 0-100 from available signals. */
function scoreCandidate(c: Contractor): number {
  const rating = c.rating ?? 0;
  const reviews = c.review_count ?? 0;
  const ratingPts = (rating / 5) * 40;
  const reviewPts = Math.min(reviews / 50, 1) * 20;
  const basePts = 40; // license/age/SB confirmed later by Sub Verify
  return Math.round(ratingPts + reviewPts + basePts);
}

export const subFinder: AgentDefinition = {
  name: "sub-finder",
  label: "Sub Finder",
  description:
    "Sources candidate subcontractors per required trade via Google Places, scores + ranks them, records candidates, and triggers verification.",
  worksWithoutClaude: true, // sourcing + scoring is rule-based
  async handler(ctx): Promise<AgentResult> {
    const opportunityId = ctx.payload.opportunityId as string;
    if (!opportunityId) return { ok: false, summary: "no opportunityId in payload" };

    const opp = await queryOne<Opportunity>(`select * from opportunities where id = $1`, [
      opportunityId,
    ]);
    if (!opp) return { ok: false, summary: `opportunity ${opportunityId} not found` };

    const profile = await getProfileJson();
    if (!profile) return { ok: false, summary: "no active Company Profile" };

    const analysis = opp.solicitation_analysis;
    const trades =
      analysis?.required_trades?.length
        ? analysis.required_trades
        : profile.primary_trades ?? [];
    const location =
      analysis?.geographic_area || opp.location_state || "";

    if (!trades.length) {
      await query(
        `update opportunities set stage='sub_research', human_action_required=true where id=$1`,
        [opportunityId]
      );
      return {
        ok: true,
        summary: "No trades identified for this opportunity; flagged for human review.",
        humanActionRequired: true,
      };
    }

    const std = profile.sub_standards;
    const perTrade = std?.candidates_per_trade ?? 12;
    const verifyTopN = std?.verify_top_n ?? 5;

    const enqueued: AgentResult["enqueued"] = [];
    const thinTrades: string[] = [];
    let totalCandidates = 0;
    let skippedDisabled = false;
    let humanAction = false;

    for (const trade of trades) {
      const search = await googleMaps.findContractors({
        trade,
        location,
        limit: perTrade,
      });

      if (search.disabled) {
        skippedDisabled = true;
        await logAgent({
          agent: "sub-finder",
          action: "find-contractors",
          level: "warn",
          status: "skipped",
          opportunityId,
          message: `Google Places disabled — skipping trade "${trade}".`,
        });
        continue;
      }

      // Score + rank the candidates for this trade.
      const ranked = search.results
        .map((c) => ({ candidate: c, score: scoreCandidate(c) }))
        .sort((a, b) => b.score - a.score);

      if (ranked.length < 2) {
        thinTrades.push(trade);
        humanAction = true;
      }

      let rank = 0;
      for (const { candidate, score } of ranked) {
        rank++;
        const subId = await upsertSubcontractor(candidate, trade, opp);
        if (!subId) continue;
        totalCandidates++;

        await query(
          `insert into opportunity_subs
             (opportunity_id, subcontractor_id, trade, candidate_rank, verified)
           values ($1,$2,$3,$4,false)
           on conflict (opportunity_id, subcontractor_id, trade)
           do update set candidate_rank = excluded.candidate_rank`,
          [opportunityId, subId, trade, rank]
        );

        if (rank <= verifyTopN) {
          enqueued.push({
            agent: "sub-verify",
            payload: { opportunityId, subcontractorId: subId, trade },
          });
        }
      }

      await logAgent({
        agent: "sub-finder",
        action: "rank-trade",
        opportunityId,
        message: `Trade "${trade}": ${ranked.length} candidates ranked (top score ${
          ranked[0]?.score ?? 0
        }).`,
        reasoning: `Scored by Google rating + review volume + base 40; top ${verifyTopN} sent to Sub Verify.`,
      });
    }

    await query(
      `update opportunities set stage='sub_research', human_action_required=$2 where id=$1`,
      [opportunityId, humanAction]
    );

    const summaryParts = [
      `Found ${totalCandidates} candidate subs across ${trades.length} trade(s)`,
    ];
    if (thinTrades.length)
      summaryParts.push(`thin coverage on: ${thinTrades.join(", ")}`);
    if (skippedDisabled) summaryParts.push("Google Places disabled for some trades");

    return {
      ok: true,
      summary: summaryParts.join("; ") + ".",
      reasoning: `Sourced from Google Places for [${trades.join(
        ", "
      )}] in "${location}"; deduped subs and enqueued verification for the top ${verifyTopN} per trade.`,
      data: {
        trades: trades.length,
        candidates: totalCandidates,
        thinTrades,
        verifyEnqueued: enqueued.length,
      },
      enqueued,
      humanActionRequired: humanAction,
    };
  },
};

/**
 * Upsert a Google Places candidate into subcontractors, deduping by
 * lower(company_name) + coalesce(state). Returns the subcontractor id.
 */
async function upsertSubcontractor(
  c: Contractor,
  trade: string,
  opp: Opportunity
): Promise<string | null> {
  const name = c.name?.trim();
  if (!name) return null;
  const state = opp.location_state ?? null;

  const existing = await queryOne<{ id: string }>(
    `select id from subcontractors
     where lower(company_name) = lower($1)
       and coalesce(state,'') = coalesce($2,'')`,
    [name, state]
  );
  if (existing) return existing.id;

  const inserted = await queryOne<{ id: string }>(
    `insert into subcontractors
       (company_name, trade_categories, state, city, phone, website,
        google_rating, review_count, google_place_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     returning id`,
    [
      name,
      [trade],
      state,
      opp.location_text ?? null,
      c.phone ?? null,
      c.website ?? null,
      c.rating ?? null,
      c.review_count ?? null,
      c.place_id ?? null,
    ]
  );
  return inserted?.id ?? null;
}
