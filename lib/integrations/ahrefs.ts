/**
 * Ahrefs API v3 client for the Site Authority / backlink module. Direct HTTP so
 * the background workers can run autonomously (the MCP connection is only
 * available in an interactive session). Requires AHREFS_API_KEY; when unset,
 * every method returns a disabled/empty result so agents log a skip instead of
 * crashing, exactly like the other integrations.
 *
 * NOTE ON COST: Ahrefs bills per row and some columns cost extra units (traffic
 * = 10 units/row, several = 5). Methods here keep `select` minimal and bound
 * `limit` so a scheduled run can't blow the monthly quota.
 */
import { config } from "../config";
import { fetchJson, withRetry } from "./http";

const BASE = "https://api.ahrefs.com/v3";

function auth(): Record<string, string> {
  return { Authorization: `Bearer ${config.ahrefs.apiKey}`, Accept: "application/json" };
}

function today(): string {
  // Ahrefs wants YYYY-MM-DD; compute in UTC to stay deterministic.
  return new Date().toISOString().slice(0, 10);
}

export interface RefDomain {
  domain: string;
  domain_rating: number | null;
  traffic_domain: number | null;
  is_spam: boolean | null;
  is_root_domain: boolean | null;
  dofollow_links: number | null;
  links_to_target: number | null;
  first_seen: string | null;
  last_seen: string | null;
}

export interface AuthoritySnapshot {
  domain_rating: number | null;
  referring_domains: number | null;
  backlinks_total: number | null;
}

export interface Competitor {
  competitor_domain: string | null;
  domain_rating: number | null;
  traffic: number | null;
  keywords_common: number | null;
}

export const ahrefs = {
  enabled: () => config.ahrefs.enabled,

  /** Domain Rating for a target (our own DR trend, or a prospect's authority). */
  async domainRating(target: string): Promise<number | null> {
    if (!config.ahrefs.enabled || !target) return null;
    try {
      const data = await withRetry(() =>
        fetchJson<{ domain_rating?: { domain_rating?: number } }>(
          `${BASE}/site-explorer/domain-rating`,
          { headers: auth(), query: { target, date: today(), output: "json" } }
        )
      );
      const dr = data.domain_rating?.domain_rating;
      return typeof dr === "number" ? dr : null;
    } catch {
      return null;
    }
  },

  /** Referring-domains + backlinks totals for a target (authority snapshot). */
  async backlinksStats(target: string): Promise<{ live_refdomains: number | null; live: number | null } | null> {
    if (!config.ahrefs.enabled || !target) return null;
    try {
      const data = await withRetry(() =>
        fetchJson<{ metrics?: { live_refdomains?: number; live?: number } }>(
          `${BASE}/site-explorer/backlinks-stats`,
          { headers: auth(), query: { target, date: today(), mode: "subdomains", output: "json" } }
        )
      );
      return {
        live_refdomains: data.metrics?.live_refdomains ?? null,
        live: data.metrics?.live ?? null,
      };
    } catch {
      return null;
    }
  },

  /** Our combined authority snapshot (DR + referring domains + backlinks). */
  async authoritySnapshot(target: string): Promise<AuthoritySnapshot | null> {
    if (!config.ahrefs.enabled || !target) return null;
    const [dr, stats] = await Promise.all([this.domainRating(target), this.backlinksStats(target)]);
    if (dr == null && !stats) return null;
    return {
      domain_rating: dr,
      referring_domains: stats?.live_refdomains ?? null,
      backlinks_total: stats?.live ?? null,
    };
  },

  /**
   * Referring domains linking to a target (typically a competitor), ranked by
   * domain rating. These become backlink prospects: sites already linking to a
   * peer are the most likely to link to us. Keeps `select` lean and caps `limit`
   * to control unit cost.
   */
  async referringDomains(
    target: string,
    { limit = 100, minDr = 0 }: { limit?: number; minDr?: number } = {}
  ): Promise<{ disabled?: boolean; items: RefDomain[] }> {
    if (!config.ahrefs.enabled || !target) return { disabled: true, items: [] };
    const where =
      minDr > 0
        ? JSON.stringify({ field: "domain_rating", is: ["gte", minDr] })
        : undefined;
    try {
      const data = await withRetry(() =>
        fetchJson<{ refdomains?: RefDomain[] }>(`${BASE}/site-explorer/refdomains`, {
          headers: auth(),
          query: {
            target,
            mode: "subdomains",
            select:
              "domain,domain_rating,traffic_domain,is_spam,is_root_domain,dofollow_links,links_to_target,first_seen,last_seen",
            order_by: "domain_rating:desc",
            limit,
            where,
            history: "live",
            output: "json",
          },
        })
      );
      return { items: data.refdomains ?? [] };
    } catch {
      return { items: [] };
    }
  },

  /**
   * Organic competitors of a target (sites ranking for the same keywords),
   * ranked by keyword overlap. Feeds the competitor list whose backlink profiles
   * we then mine for prospects. Requires a country + date.
   */
  async organicCompetitors(
    target: string,
    { limit = 20, country = "us" }: { limit?: number; country?: string } = {}
  ): Promise<{ disabled?: boolean; items: Competitor[] }> {
    if (!config.ahrefs.enabled || !target) return { disabled: true, items: [] };
    try {
      const data = await withRetry(() =>
        fetchJson<{ competitors?: Competitor[] }>(
          `${BASE}/site-explorer/organic-competitors`,
          {
            headers: auth(),
            query: {
              target,
              mode: "subdomains",
              country,
              date: today(),
              select: "competitor_domain,domain_rating,traffic,keywords_common",
              order_by: "keywords_common:desc",
              limit,
              output: "json",
            },
          }
        )
      );
      return { items: data.competitors ?? [] };
    } catch {
      return { items: [] };
    }
  },
};
