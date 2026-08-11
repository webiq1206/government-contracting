/**
 * SUB FINDER, triggered when an opportunity advances to sub_research.
 * For each required trade (from the Solicitation Analyst, falling back to the
 * profile's primary trades) it:
 *   1. Reuses known subcontractors already on the roster (same trade + state,
 *      preferred / reliable first) so relationships are not rediscovered as new.
 *   2. Searches Google Places for additional candidates in the opportunity area,
 *      scores each 0-100 from Google signals, ranks them, and upserts with
 *      dedupe by google_place_id then company_name + state.
 * Records the candidate set in opportunity_subs and enqueues Sub Verify for the
 * top N per trade. Trades that turn up fewer than two candidates flag the
 * opportunity for human review.
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
    "Sources candidate subcontractors per required trade via known roster + Google Places, scores + ranks them, records candidates, and triggers verification.",
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
    let reusedFromRoster = 0;
    let skippedDisabled = false;
    let humanAction = false;

    for (const trade of trades) {
      // 1) Prefer known relationships before cold Places search.
      const known = await query<{ id: string; company_name: string }>(
        `select id, company_name from subcontractors
          where coalesce(blacklisted, false) = false
            and (
              $1 = any(trade_categories)
              or exists (
                   select 1 from unnest(coalesce(trade_categories, '{}'::text[])) t
                    where lower(t) = lower($1)
                 )
            )
            and (
              coalesce(state,'') = coalesce($2,'')
              or $2 is null
              or $2 = ''
            )
          order by is_preferred desc nulls last,
                   coalesce(reliability_score, 0) desc,
                   coalesce(responsiveness_score, 0) desc,
                   company_name asc
          limit $3`,
        [trade, opp.location_state ?? null, Math.min(perTrade, 8)]
      );

      let rank = 0;
      for (const row of known) {
        rank++;
        reusedFromRoster++;
        totalCandidates++;
        await query(
          `insert into opportunity_subs
             (opportunity_id, subcontractor_id, trade, candidate_rank, verified)
           values ($1,$2,$3,$4,false)
           on conflict (opportunity_id, subcontractor_id, trade)
           do update set candidate_rank = least(opportunity_subs.candidate_rank, excluded.candidate_rank)`,
          [opportunityId, row.id, trade, rank]
        );
        if (rank <= verifyTopN) {
          enqueued.push({
            agent: "sub-verify",
            payload: { opportunityId, subcontractorId: row.id, trade },
            opts: {
              singletonKey: `verify:${opportunityId}:${row.id}:${trade}`,
              singletonSeconds: 3600,
            },
          });
        }
      }

      if (known.length > 0) {
        await logAgent({
          agent: "sub-finder",
          action: "reuse-roster",
          opportunityId,
          message: `Trade "${trade}": reused ${known.length} known sub(s) from the roster before Places search.`,
        });
      }

      const placesLimit = Math.max(perTrade - known.length, 4);
      const search = await googleMaps.findContractors({
        trade,
        location,
        limit: placesLimit,
      });

      if (search.disabled) {
        skippedDisabled = true;
        await logAgent({
          agent: "sub-finder",
          action: "find-contractors",
          level: "warn",
          status: "skipped",
          opportunityId,
          message: `Google Places disabled, skipping Places for trade "${trade}".`,
        });
        if (known.length < 2) {
          thinTrades.push(trade);
          humanAction = true;
        }
        continue;
      }

      // Defensive: if the Places client ever returns an unexpected shape,
      // skip the trade with a log instead of crashing the whole run.
      if (!Array.isArray(search.results)) {
        await logAgent({
          agent: "sub-finder",
          action: "find-contractors",
          level: "warn",
          status: "skipped",
          opportunityId,
          message: `Google Places returned an unexpected response for trade "${trade}"; skipping this trade.`,
        });
        if (known.length < 2) {
          thinTrades.push(trade);
          humanAction = true;
        }
        continue;
      }

      // Score + rank the candidates for this trade.
      const ranked = search.results
        .map((c) => ({ candidate: c, score: scoreCandidate(c) }))
        .sort((a, b) => b.score - a.score);

      if (known.length + ranked.length < 2) {
        thinTrades.push(trade);
        humanAction = true;
      }

      for (const { candidate } of ranked) {
        rank++;
        const subId = await upsertSubcontractor(candidate, trade, opp);
        if (!subId) continue;
        totalCandidates++;

        await query(
          `insert into opportunity_subs
             (opportunity_id, subcontractor_id, trade, candidate_rank, verified)
           values ($1,$2,$3,$4,false)
           on conflict (opportunity_id, subcontractor_id, trade)
           do update set candidate_rank = least(
             coalesce(opportunity_subs.candidate_rank, excluded.candidate_rank),
             excluded.candidate_rank
           )`,
          [opportunityId, subId, trade, rank]
        );

        if (rank <= verifyTopN) {
          enqueued.push({
            agent: "sub-verify",
            payload: { opportunityId, subcontractorId: subId, trade },
            opts: {
              singletonKey: `verify:${opportunityId}:${subId}:${trade}`,
              singletonSeconds: 3600,
            },
          });
        }
      }

      await logAgent({
        agent: "sub-finder",
        action: "rank-trade",
        opportunityId,
        message: `Trade "${trade}": ${known.length} known + ${ranked.length} Places candidates (top Places score ${
          ranked[0]?.score ?? 0
        }).`,
        reasoning: `Roster-first, then Google Places; top ${verifyTopN} sent to Sub Verify.`,
      });
    }

    await query(
      `update opportunities set stage='sub_research', human_action_required=$2 where id=$1`,
      [opportunityId, humanAction]
    );

    const summaryParts = [
      `Found ${totalCandidates} candidate subs across ${trades.length} trade(s)`,
    ];
    if (reusedFromRoster > 0)
      summaryParts.push(`${reusedFromRoster} reused from existing relationships`);
    if (thinTrades.length)
      summaryParts.push(`thin coverage on: ${thinTrades.join(", ")}`);
    if (skippedDisabled) summaryParts.push("Google Places disabled for some trades");

    return {
      ok: true,
      summary: summaryParts.join("; ") + ".",
      reasoning: `Sourced from roster + Google Places for [${trades.join(
        ", "
      )}] in "${location}"; deduped subs and enqueued verification for the top ${verifyTopN} per trade.`,
      data: {
        trades: trades.length,
        candidates: totalCandidates,
        reusedFromRoster,
        thinTrades,
        verifyEnqueued: enqueued.length,
      },
      enqueued,
      humanActionRequired: humanAction,
    };
  },
};

/**
 * Upsert a Google Places candidate into subcontractors.
 * Dedupe order: google_place_id → lower(company_name) + state.
 * Refreshes stale contact fields and merges the trade into trade_categories.
 */
async function upsertSubcontractor(
  c: Contractor,
  trade: string,
  opp: Opportunity
): Promise<string | null> {
  const name = c.name?.trim();
  if (!name) return null;
  const state = opp.location_state ?? null;
  const placeId = c.place_id?.trim() || null;

  let existing: { id: string } | null = null;
  if (placeId) {
    existing = await queryOne<{ id: string }>(
      `select id from subcontractors where google_place_id = $1`,
      [placeId]
    );
  }
  if (!existing) {
    existing = await queryOne<{ id: string }>(
      `select id from subcontractors
       where lower(company_name) = lower($1)
         and coalesce(state,'') = coalesce($2,'')`,
      [name, state]
    );
  }

  if (existing) {
    await query(
      `update subcontractors set
         phone = coalesce(nullif(phone, ''), $2),
         website = coalesce(nullif(website, ''), $3),
         google_rating = coalesce($4, google_rating),
         review_count = coalesce($5, review_count),
         google_place_id = coalesce(google_place_id, $6),
         trade_categories = (
           select array_agg(distinct x)
             from unnest(
               coalesce(trade_categories, '{}'::text[]) || array[$7]::text[]
             ) as x
         ),
         updated_at = now()
       where id = $1`,
      [
        existing.id,
        c.phone ?? null,
        c.website ?? null,
        c.rating ?? null,
        c.review_count ?? null,
        placeId,
        trade,
      ]
    );
    return existing.id;
  }

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
      placeId,
    ]
  );
  return inserted?.id ?? null;
}
