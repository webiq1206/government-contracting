/**
 * BACKLINK SCOUT, daily cron (07:00). The discovery + qualification half of the
 * autonomous Site Authority module. Every run it:
 *   1. Captures an authority snapshot for our domain (DR + referring domains +
 *      total backlinks) so we can chart the trend toward DR 50.
 *   2. Refreshes our own live backlinks and flags any that disappeared (lost).
 *   3. Auto-discovers organic competitors from Ahrefs and stores them.
 *   4. Mines each competitor's referring domains for prospects, qualifies each
 *      one (quality-over-quantity, spam/off-topic/no-index are hard rejects) and
 *      upserts the keepers.
 *
 * This agent ONLY discovers and qualifies. It never contacts anyone. Outreach is
 * drafted and executed by a separate, human-approval-gated step, so the platform
 * can never send unattended mass outreach (which risks Google penalties and
 * violates CAN-SPAM). Rule-only where possible; degrades gracefully to a logged
 * skip when AHREFS_API_KEY is not set.
 */
import { query, queryOne } from "../db";
import { getProfileJson } from "../ai/companyProfile";
import { logAgent } from "../logger";
import { config } from "../config";
import { ahrefs, type RefDomain } from "../integrations/ahrefs";
import {
  qualifyProspect,
  domainNicheRelevance,
  type LinkType,
} from "../domain/backlink";
import type { AgentDefinition } from "./types";
import type { AgentResult } from "../types";

// Cost governors — Ahrefs bills per row and some columns cost extra units, so
// bound how much each daily run pulls.
const MAX_COMPETITORS = 5; // competitors whose profiles we mine per run
const REFDOMAINS_PER_COMPETITOR = 40; // referring domains pulled per competitor
const OWN_REFDOMAINS = 100; // our own backlinks refreshed per run
const MIN_COMPETITOR_DR = 15; // ignore weak referring domains outright

/** Build the niche-term set used to estimate topical relevance of a domain. */
function nicheTerms(profile: Awaited<ReturnType<typeof getProfileJson>>): string[] {
  const terms = new Set<string>(["construction", "contractor", "government", "procurement"]);
  for (const t of profile?.primary_trades ?? []) terms.add(t);
  for (const s of profile?.service_areas ?? []) terms.add(s);
  return [...terms];
}

function linkTypeOf(rd: RefDomain): LinkType {
  if (rd.dofollow_links == null) return "unknown";
  return rd.dofollow_links > 0 ? "dofollow" : "nofollow";
}

export const backlinkScout: AgentDefinition = {
  name: "backlink-scout",
  label: "Backlink Scout",
  description:
    "Daily: snapshots our Domain Rating, tracks new/lost backlinks, auto-discovers competitors, and mines + qualifies backlink prospects. Discovery only, never contacts anyone.",
  cron: "0 7 * * *",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    if (!config.ahrefs.enabled) {
      await logAgent({
        agent: "backlink-scout",
        action: "skip",
        status: "skipped",
        message: "AHREFS_API_KEY not set; Site Authority scan skipped.",
      });
      return { ok: false, summary: "Ahrefs not configured, scan skipped." };
    }

    const profile = await getProfileJson();
    const target = config.ahrefs.target;
    const terms = nicheTerms(profile);
    const runStart = new Date();

    // --- 1) Authority snapshot. ---
    const snap = await ahrefs.authoritySnapshot(target);
    if (snap) {
      await query(
        `insert into authority_snapshots (domain_rating, referring_domains, backlinks_total)
         values ($1,$2,$3)`,
        [snap.domain_rating, snap.referring_domains, snap.backlinks_total]
      );
    }

    // --- 2) Our own live backlinks: refresh + lost detection. ---
    const ownDomains = new Set<string>();
    let newBacklinks = 0;
    const own = await ahrefs.referringDomains(target, { limit: OWN_REFDOMAINS });
    for (const rd of own.items) {
      const domain = (rd.domain || "").toLowerCase();
      if (!domain) continue;
      ownDomains.add(domain);
      const sourceUrl = `https://${domain}`;
      const existing = await queryOne<{ id: string }>(
        `select id from backlinks where source_url = $1 and coalesce(target_url,'') = $2`,
        [sourceUrl, target]
      );
      if (existing) {
        await query(
          `update backlinks set last_seen_at = now(), lost_at = null, domain_rating = $2,
             link_type = $3 where id = $1`,
          [existing.id, rd.domain_rating, linkTypeOf(rd)]
        );
      } else {
        newBacklinks++;
        await query(
          `insert into backlinks
             (source_domain, source_url, target_url, domain_rating, link_type, raw_json)
           values ($1,$2,$3,$4,$5,$6)
           on conflict (source_url, target_url) do update set last_seen_at = now(), lost_at = null`,
          [domain, sourceUrl, target, rd.domain_rating, linkTypeOf(rd), JSON.stringify(rd)]
        );
      }
    }
    // Anything not refreshed this run (and not already marked lost) has dropped.
    let lostBacklinks = 0;
    if (own.items.length > 0) {
      const lost = await query<{ id: string }>(
        `update backlinks set lost_at = now()
          where coalesce(target_url,'') = $1 and lost_at is null and last_seen_at < $2
          returning id`,
        [target, runStart.toISOString()]
      );
      lostBacklinks = lost.length;
    }

    // --- 3) Auto-discover competitors. ---
    const comp = await ahrefs.organicCompetitors(target, { limit: MAX_COMPETITORS * 2 });
    const competitors = comp.items
      .filter((c) => c.competitor_domain)
      .slice(0, MAX_COMPETITORS);
    for (const c of competitors) {
      await query(
        `insert into backlink_competitors (domain, source, domain_rating, last_scanned_at)
         values ($1,'ahrefs_auto',$2, now())
         on conflict (domain) do update set domain_rating = excluded.domain_rating,
           last_scanned_at = now()`,
        [c.competitor_domain, c.domain_rating]
      );
    }

    // --- 4) Mine + qualify prospects from each competitor's referring domains. ---
    let discovered = 0;
    let qualified = 0;
    let rejected = 0;
    for (const c of competitors) {
      const compRow = await queryOne<{ id: string }>(
        `select id from backlink_competitors where domain = $1`,
        [c.competitor_domain]
      );
      const rds = await ahrefs.referringDomains(c.competitor_domain!, {
        limit: REFDOMAINS_PER_COMPETITOR,
        minDr: MIN_COMPETITOR_DR,
      });
      for (const rd of rds.items) {
        const domain = (rd.domain || "").toLowerCase();
        if (!domain) continue;
        // Skip domains that already link to us — those aren't prospects.
        if (ownDomains.has(domain)) continue;

        const relevance = domainNicheRelevance(domain, terms);
        const linkType = linkTypeOf(rd);
        const q = qualifyProspect({
          opportunityType: "competitor_gap",
          dr: rd.domain_rating,
          relevance,
          traffic: rd.traffic_domain,
          spamScore: rd.is_spam ? 80 : 0, // Ahrefs only flags known-spam; treat as a hard signal
          indexed: true,
          linkType,
        });
        discovered++;
        if (q.tier === "reject") {
          rejected++;
          continue;
        }
        qualified++;
        await query(
          `insert into backlink_prospects
             (domain, opportunity_type, domain_rating, relevance, traffic, spam_score,
              indexed, link_type, priority_score, tier, qualification_json,
              discovered_via, competitor_id, status)
           values ($1,'competitor_gap',$2,$3,$4,$5,true,$6,$7,$8,$9,$10,$11,'qualified')
           on conflict (domain, opportunity_type) do update set
             domain_rating = excluded.domain_rating,
             relevance = excluded.relevance,
             traffic = excluded.traffic,
             spam_score = excluded.spam_score,
             link_type = excluded.link_type,
             priority_score = excluded.priority_score,
             tier = excluded.tier,
             qualification_json = excluded.qualification_json,
             updated_at = now()`,
          [
            domain,
            rd.domain_rating,
            relevance,
            rd.traffic_domain,
            rd.is_spam ? 80 : 0,
            linkType,
            q.score,
            q.tier,
            JSON.stringify({ reasons: q.reasons, metrics: rd }),
            `competitor:${c.competitor_domain}`,
            compRow?.id ?? null,
          ]
        );
      }
    }

    const summary = `DR ${snap?.domain_rating ?? "?"}; ${competitors.length} competitors; ${qualified} prospects qualified (${rejected} rejected); ${newBacklinks} new / ${lostBacklinks} lost backlinks.`;
    await logAgent({
      agent: "backlink-scout",
      action: "scan",
      level: lostBacklinks > 0 ? "warn" : "info",
      message: summary,
      reasoning: `Snapshot + ${own.items.length} own refdomains + ${competitors.length} competitors x ${REFDOMAINS_PER_COMPETITOR} refdomains, qualified via quality-first scoring.`,
      output: {
        domainRating: snap?.domain_rating ?? null,
        referringDomains: snap?.referring_domains ?? null,
        competitors: competitors.length,
        discovered,
        qualified,
        rejected,
        newBacklinks,
        lostBacklinks,
      },
    });

    return {
      ok: true,
      summary,
      data: {
        domainRating: snap?.domain_rating ?? null,
        competitors: competitors.length,
        qualified,
        rejected,
        newBacklinks,
        lostBacklinks,
      },
      // Lost backlinks are worth a human glance; discovery itself needs no action.
      humanActionRequired: lostBacklinks > 0,
    };
  },
};
