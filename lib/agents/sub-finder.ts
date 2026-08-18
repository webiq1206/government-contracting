/**
 * SUB FINDER, triggered when an opportunity advances to sub_research.
 * For each required trade (from the Solicitation Analyst, falling back to the
 * profile's primary trades) it:
 *   1. Reuses known subcontractors already on the roster that have a contact
 *      pathway (email, phone, or website) — empty shells are never reused.
 *   2. Searches Google Places, enriches top results with Place Details
 *      (phone/website), scores contactable candidates higher, and skips any
 *      candidate with no phone and no website (automation cannot reach them).
 * Records the candidate set in opportunity_subs and enqueues Sub Verify for the
 * top N per trade. Trades that turn up fewer than two contactable candidates
 * flag the opportunity for human review.
 */
import { query, queryOne } from "../db";
import { getProfileJson } from "../ai/companyProfile";
import { logAgent } from "../logger";
import { LEGACY_ORG_ID, runWithOrg } from "../tenant-context";
import {
  contactabilityBonus,
  hasContactPathway,
} from "../domain/sub-contactability";
import { googleMaps, type Contractor } from "../integrations/googleMaps";
import { stateCodeFromAddress, stateCodeFromText } from "../us-states";
import type { AgentDefinition } from "./types";
import type { AgentResult, Opportunity } from "../types";

/** Score a Google Places candidate 0-100 from available signals. */
export function scoreCandidate(c: Contractor): number {
  const rating = c.rating ?? 0;
  const reviews = c.review_count ?? 0;
  const ratingPts = (rating / 5) * 35;
  const reviewPts = Math.min(reviews / 50, 1) * 15;
  const basePts = 25; // license/age/SB confirmed later by Sub Verify
  const contactPts = Math.min(contactabilityBonus(c), 25);
  return Math.round(ratingPts + reviewPts + basePts + contactPts);
}

export const subFinder: AgentDefinition = {
  name: "sub-finder",
  label: "Sub Finder",
  description:
    "Sources contactable subcontractors per required trade via known roster + Google Places (enriched), ranks them, records candidates, and triggers verification.",
  worksWithoutClaude: true, // sourcing + scoring is rule-based
  async handler(ctx): Promise<AgentResult> {
    const opportunityId = ctx.payload.opportunityId as string;
    if (!opportunityId) return { ok: false, summary: "no opportunityId in payload" };

    const opp = await queryOne<Opportunity>(`select * from opportunities where id = $1`, [
      opportunityId,
    ]);
    if (!opp) return { ok: false, summary: `opportunity ${opportunityId} not found` };

    // The opportunity owns the run: every sub sourced here is attached to it,
    // so its org is the only org this agent may read or write. Without the
    // context the profile lookup falls back to the founding org, which would
    // source subs against another company's trades and standards. Raw SQL
    // below still passes orgId explicitly; the context only reaches code that
    // resolves the tenant itself.
    const orgId = opp.org_id ?? LEGACY_ORG_ID;
    return runWithOrg(orgId, () => sourceSubs(opp, orgId));
  },
};

async function sourceSubs(opp: Opportunity, orgId: string): Promise<AgentResult> {
  const opportunityId = opp.id;
  const profile = await getProfileJson();
  if (!profile) return { ok: false, summary: "no active Company Profile" };

  const analysis = opp.solicitation_analysis;
  const trades =
    analysis?.required_trades?.length
      ? analysis.required_trades
      : profile.primary_trades ?? [];
  // Where the work is, as specifically as we know it. City + state beats a
  // bare state code in a Places query ("mowing contractor in Yigo, GU" finds
  // local firms; "in GU" finds whoever ranks island-wide).
  const location =
    analysis?.geographic_area ||
    [opp.location_text, opp.location_state].filter(Boolean).join(", ");
  // The one state the work is in. Everything downstream keys off this: the
  // roster reuse, the Places filter, and the address written onto new subs.
  // Null means we genuinely do not know, and not knowing means not pairing:
  // a sub sourced without a place is a sub from anywhere.
  const targetState =
    (opp.location_state ?? "").trim().toUpperCase() ||
    stateCodeFromText(analysis?.geographic_area ?? null);

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
  let skippedNoContact = 0;
  let skippedDisabled = false;
  let humanAction = false;

  for (const trade of trades) {
    // 1) Prefer known relationships that we can actually reach.
    //
    // org_id is the first condition on purpose: a match here is written
    // straight into opportunity_subs, so an unscoped roster does not just
    // disclose another customer's subcontractor, it attaches them to this
    // customer's opportunity and sends them to Sub Verify and outreach.
    // Only subs recorded in the working state. The old clause fell open to
    // EVERY state when the opportunity had none, which paired firms from
    // anywhere in the country with a job they could never mobilize for.
    const known = targetState
      ? await query<{ id: string; company_name: string }>(
      `select id, company_name from subcontractors
        where org_id = $4
          and coalesce(blacklisted, false) = false
          and (
            $1 = any(trade_categories)
            or exists (
                 select 1 from unnest(coalesce(trade_categories, '{}'::text[])) t
                  where lower(t) = lower($1)
               )
          )
          and upper(coalesce(state,'')) = $2
          and (
            nullif(btrim(coalesce(email, '')), '') is not null
            or nullif(btrim(coalesce(phone, '')), '') is not null
            or nullif(btrim(coalesce(website, '')), '') is not null
          )
        order by
                 case
                   when nullif(btrim(coalesce(email, '')), '') is not null
                        and email_verified then 0
                   when nullif(btrim(coalesce(email, '')), '') is not null then 1
                   when nullif(btrim(coalesce(phone, '')), '') is not null then 2
                   else 3
                 end,
                 is_preferred desc nulls last,
                 coalesce(reliability_score, 0) desc,
                 coalesce(responsiveness_score, 0) desc,
                 company_name asc
        limit $3`,
      [trade, targetState, Math.min(perTrade, 8), orgId]
    )
      : [];

    let rank = 0;
    let contactableForTrade = 0;
    for (const row of known) {
      rank++;
      reusedFromRoster++;
      totalCandidates++;
      contactableForTrade++;
      await query(
        `insert into opportunity_subs
           (opportunity_id, subcontractor_id, trade, candidate_rank, verified)
         values ($1,$2,$3,$4,false)
         on conflict (opportunity_id, subcontractor_id, trade)
         do update set candidate_rank = least(
           coalesce(opportunity_subs.candidate_rank, excluded.candidate_rank),
           excluded.candidate_rank
         )`,
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
        message: `Trade "${trade}": reused ${known.length} contactable sub(s) from the roster before Places search.`,
      });
    }

    const placesLimit = Math.max(perTrade - known.length, 4);

    // Never search without a known place AND a known state to check results
    // against. "electrical contractor in " returns whoever Google ranks
    // anywhere; and even with a location string, results cannot be verified
    // as local without a state to compare their addresses to. A wrong-area
    // sub who quotes anyway poisons the pricing.
    if (!location.trim() || !targetState) {
      await logAgent({
        agent: "sub-finder",
        action: "find-contractors",
        level: "warn",
        status: "skipped",
        opportunityId,
        message: `Trade "${trade}": the place of performance on this opportunity is missing or does not name a state, so no subs were paired (searching without one returns firms from anywhere in the country). Add the location, then re-run Sub Finder.`,
      });
      if (contactableForTrade < 2) {
        thinTrades.push(trade);
        humanAction = true;
      }
      continue;
    }

    const search = await googleMaps.findContractors({
      trade,
      location,
      limit: Math.max(placesLimit * 2, 12), // over-fetch; many lack contact after enrich
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
      if (contactableForTrade < 2) {
        thinTrades.push(trade);
        humanAction = true;
      }
      continue;
    }

    if (search.error) {
      // The search FAILED; an empty result here is not "no contractors in
      // this area", and blaming the local market for an API outage sends the
      // operator hunting subs that the next run would have found itself.
      await logAgent({
        agent: "sub-finder",
        action: "find-contractors",
        level: "error",
        status: "error",
        opportunityId,
        message: `Google Places search failed for trade "${trade}": ${search.error}. No conclusion about local coverage was drawn; test the Maps key in Settings, then Integrations, and re-run Sub Finder.`,
      });
      if (contactableForTrade < 2) {
        thinTrades.push(trade);
        humanAction = true;
      }
      continue;
    }

    if (!Array.isArray(search.results)) {
      await logAgent({
        agent: "sub-finder",
        action: "find-contractors",
        level: "warn",
        status: "skipped",
        opportunityId,
        message: `Google Places returned an unexpected response for trade "${trade}"; skipping this trade.`,
      });
      if (contactableForTrade < 2) {
        thinTrades.push(trade);
        humanAction = true;
      }
      continue;
    }

    // Place Details recovers phone/website — Text Search never returns them.
    // Enrich before scoring so contactable firms rank first and empty shells
    // never enter the roster.
    const enriched = await googleMaps.enrichTopN(
      search.results,
      search.results.length
    );

    // Drop firms whose own address puts them in a different state. Google
    // treats "in <place>" as a preference, not a promise, and will happily
    // pad thin local results with whoever ranks nationally. A firm with no
    // parseable address is kept (many list only a service area), but one that
    // SAYS it is somewhere else is out.
    let skippedWrongArea = 0;
    const ranked = enriched
      .map((c) => ({ candidate: c, score: scoreCandidate(c) }))
      .filter(({ candidate }) => {
        const candState = stateCodeFromAddress(candidate.address);
        if (candState && candState !== targetState) {
          skippedWrongArea++;
          return false;
        }
        if (hasContactPathway(candidate)) return true;
        skippedNoContact++;
        return false;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, placesLimit);

    if (skippedWrongArea > 0) {
      await logAgent({
        agent: "sub-finder",
        action: "find-contractors",
        opportunityId,
        message: `Trade "${trade}": dropped ${skippedWrongArea} search result(s) located outside ${targetState}. Only firms in the working area are approached.`,
      });
    }

    for (const { candidate } of ranked) {
      const subId = await upsertSubcontractor(candidate, trade, orgId, targetState);
      if (!subId) {
        skippedNoContact++;
        continue;
      }
      rank++;
      totalCandidates++;
      contactableForTrade++;

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

    if (contactableForTrade < 2) {
      thinTrades.push(trade);
      humanAction = true;
    }

    await logAgent({
      agent: "sub-finder",
      action: "rank-trade",
      opportunityId,
      message: `Trade "${trade}": ${known.length} known + ${ranked.length} contactable Places candidates (skipped empty-contact shells). Top score ${
        ranked[0]?.score ?? 0
      }.`,
      reasoning: `Roster-first (contactable only), then Places + Details enrichment; top ${verifyTopN} sent to Sub Verify.`,
    });
  }

  await query(
    `update opportunities set stage='sub_research', human_action_required=$2 where id=$1`,
    [opportunityId, humanAction]
  );

  const summaryParts = [
    `Found ${totalCandidates} contactable candidate sub(s) across ${trades.length} trade(s)`,
  ];
  if (reusedFromRoster > 0)
    summaryParts.push(`${reusedFromRoster} reused from existing relationships`);
  if (skippedNoContact > 0)
    summaryParts.push(`skipped ${skippedNoContact} with no phone/website/email`);
  if (thinTrades.length)
    summaryParts.push(`thin coverage on: ${thinTrades.join(", ")}`);
  if (skippedDisabled) summaryParts.push("Google Places disabled for some trades");

  return {
    ok: true,
    summary: summaryParts.join("; ") + ".",
    reasoning: `Sourced contactable subs from roster + enriched Google Places for [${trades.join(
      ", "
    )}] in "${location}"; empty-contact shells are never paired.`,
    data: {
      trades: trades.length,
      candidates: totalCandidates,
      reusedFromRoster,
      skippedNoContact,
      thinTrades,
      verifyEnqueued: enqueued.length,
    },
    enqueued,
    humanActionRequired: humanAction,
  };
}

/**
 * Upsert a Google Places candidate into subcontractors.
 * Dedupe order: google_place_id → lower(company_name) + state.
 * Refuses to create or return a row with zero contact pathways.
 *
 * Both dedupe lookups are scoped to the opportunity's org. The same real firm
 * legitimately appears on several customers' rosters, so an unscoped match
 * would hand back another org's row, update that row with this run's contact
 * details, and pair it with this org's opportunity. Rosters are per customer
 * even when the underlying business is the same one.
 */
/** The city segment of a Google formatted address ("... , Yigo, GU 96929, ..."). */
function cityFromAddress(address: string | null | undefined): string | null {
  const parts = (address ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  // The state+zip segment follows the city segment; find it and step back.
  for (let i = parts.length - 1; i > 0; i--) {
    if (/^[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/.test(parts[i])) {
      return parts[i - 1] || null;
    }
  }
  return null;
}

async function upsertSubcontractor(
  c: Contractor,
  trade: string,
  orgId: string,
  /** The state the search targeted, for name-dedupe when the address gives none. */
  targetState: string | null
): Promise<string | null> {
  const name = c.name?.trim();
  if (!name) return null;
  // The FIRM's own location, from its own address. This used to be the
  // opportunity's state and city, which stamped the job's location onto the
  // company record: a wrong-area firm Google slipped into the results was
  // permanently recorded as local, and every future job in that state
  // "reused" it from the roster.
  const state = stateCodeFromAddress(c.address);
  const city = cityFromAddress(c.address);
  const placeId = c.place_id?.trim() || null;

  let existing: {
    id: string;
    email: string | null;
    phone: string | null;
    website: string | null;
  } | null = null;
  if (placeId) {
    existing = await queryOne(
      `select id, email, phone, website from subcontractors
       where org_id = $2 and google_place_id = $1`,
      [placeId, orgId]
    );
  }
  if (!existing) {
    // Same name, compatible state, same org = the same firm. "Compatible"
    // means the roster row's state equals the candidate's own, or the state
    // this search targeted, or is unknown; requiring strict equality here
    // minted a duplicate row whenever Google returned no parseable address.
    existing = await queryOne(
      `select id, email, phone, website from subcontractors
       where org_id = $2
         and lower(company_name) = lower($1)
         and (coalesce(state,'') = '' or upper(state) in ($3, $4))
       order by (google_place_id is not null) desc, created_at asc
       limit 1`,
      [name, orgId, state ?? "", targetState ?? ""]
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
         state = coalesce(nullif(state, ''), $8),
         city = coalesce(nullif(city, ''), $9),
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
        state,
        city,
      ]
    );
    const merged = {
      email: existing.email,
      phone: c.phone || existing.phone,
      website: c.website || existing.website,
    };
    if (!hasContactPathway(merged)) return null;
    return existing.id;
  }

  // Never insert a brand-new shell with no way to reach them.
  if (!hasContactPathway({ phone: c.phone, website: c.website })) {
    return null;
  }

  // subcontractors is a root table, so 042's derive-org triggers do not reach
  // it and org_id must be set here. A null-org row belongs to nobody: the
  // roster lookup above would never find it again and the customer would never
  // see the sub they just paid a Places lookup for.
  const inserted = await queryOne<{ id: string }>(
    `insert into subcontractors
       (org_id, company_name, trade_categories, state, city, phone, website,
        google_rating, review_count, google_place_id)
     values ($10,$1,$2,$3,$4,$5,$6,$7,$8,$9)
     returning id`,
    [
      name,
      [trade],
      state,
      city,
      c.phone ?? null,
      c.website ?? null,
      c.rating ?? null,
      c.review_count ?? null,
      placeId,
      orgId,
    ]
  );
  return inserted?.id ?? null;
}
