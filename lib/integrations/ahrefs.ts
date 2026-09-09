/**
 * Ahrefs API v3 client for the Site Authority / backlink module. Direct HTTP so
 * the background workers can run autonomously (the MCP connection is only
 * available in an interactive session). The platform-owner credential and
 * target are resolved through the same per-organization settings store the
 * admin UI writes. When unset, methods return a disabled result. Provider
 * failures throw so a failed scan can never be logged as a successful empty
 * scan.
 *
 * NOTE ON COST: Ahrefs bills per row and some columns cost extra units (traffic
 * = 10 units/row, several = 5). Methods here keep `select` minimal and bound
 * `limit` so a scheduled run can't blow the monthly quota.
 */
import { orgApiKey } from "../integration-keys";
import { recordIntegrationUse } from "../integration-settings";
import { LEGACY_ORG_ID } from "../tenant-context";
import { fetchJson, withRetry, type FetchJsonOptions } from "./http";

const BASE = "https://api.ahrefs.com/v3";
const DEFAULT_TARGET = "brostco.com";

interface AhrefsCredentials {
  apiKey: string;
  target: string;
  orgId: string;
}

export interface AhrefsConfiguration {
  enabled: boolean;
  target: string;
}

export class AhrefsProviderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AhrefsProviderError";
  }
}

function auth(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
}

/** Domain-only form accepted by Ahrefs and safe to place in a public URL. */
export function normalizeAhrefsTarget(raw: string): string | null {
  let value = raw.trim().toLowerCase();
  if (!value) return null;
  try {
    if (/^https?:\/\//i.test(value)) value = new URL(value).hostname;
  } catch {
    return null;
  }
  value = value.replace(/^www\./, "").replace(/\.$/, "");
  if (
    value.length > 253 ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) ||
    !value.includes(".") ||
    value.includes("..")
  ) {
    return null;
  }
  return value;
}

async function credentials(orgId = LEGACY_ORG_ID): Promise<AhrefsCredentials> {
  const [apiKey, savedTarget] = await Promise.all([
    orgApiKey("AHREFS_API_KEY", orgId),
    orgApiKey("AHREFS_TARGET", orgId),
  ]);
  const target = normalizeAhrefsTarget(savedTarget || DEFAULT_TARGET);
  if (!target) {
    throw new Error(
      "The saved Ahrefs target is not a valid domain. Enter a domain such as brostco.com in Settings, Integrations."
    );
  }
  return { apiKey, target, orgId };
}

function providerReason(error: unknown, apiKey: string): string {
  const raw = error instanceof Error ? error.message : "Unknown provider error";
  const redacted = apiKey ? raw.split(apiKey).join("[redacted]") : raw;
  return redacted.replace(/\s+/g, " ").trim().slice(0, 300);
}

async function providerCall<T>(
  creds: AhrefsCredentials,
  path: string,
  options: FetchJsonOptions
): Promise<T> {
  try {
    const data = await withRetry(() =>
      fetchJson<T>(`${BASE}${path}`, {
        ...options,
        metering: { envKey: 'AHREFS_API_KEY', value: creds.apiKey, provider: 'Ahrefs', service: path, feature: 'Website research', orgId: creds.orgId },
        headers: { ...options.headers, ...auth(creds.apiKey) },
      })
    );
    await recordIntegrationUse("AHREFS_API_KEY", { ok: true, orgId: creds.orgId });
    return data;
  } catch (error) {
    const reason = providerReason(error, creds.apiKey);
    await recordIntegrationUse("AHREFS_API_KEY", {
      ok: false,
      error: `Ahrefs request failed: ${reason}`,
      orgId: creds.orgId,
    });
    throw new AhrefsProviderError(
      `Ahrefs could not return live data (${reason}). No empty result was recorded as a successful scan. Check the API key, plan quota, and provider status, then retry.`,
      { cause: error }
    );
  }
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

export interface BrokenBacklink {
  root_name_source: string; // referring domain (the prospect)
  url_from: string; // the page that has the broken link
  domain_rating_source: number | null;
  traffic_domain: number | null;
  is_spam: boolean | null;
  is_dofollow: boolean | null;
  url_to: string; // the now-dead URL it points to (on the competitor)
  anchor: string | null;
  title: string | null;
}

export const ahrefs = {
  async configuration(orgId = LEGACY_ORG_ID): Promise<AhrefsConfiguration> {
    const resolved = await credentials(orgId);
    return { enabled: resolved.apiKey.length > 0, target: resolved.target };
  },

  async enabled(orgId = LEGACY_ORG_ID): Promise<boolean> {
    return (await this.configuration(orgId)).enabled;
  },

  async target(orgId = LEGACY_ORG_ID): Promise<string> {
    return (await this.configuration(orgId)).target;
  },

  /** Domain Rating for a target (our own DR trend, or a prospect's authority). */
  async domainRating(target: string, orgId = LEGACY_ORG_ID): Promise<number | null> {
    const creds = await credentials(orgId);
    if (!creds.apiKey || !target) return null;
    const data = await providerCall<{ domain_rating?: { domain_rating?: number } }>(
      creds,
      "/site-explorer/domain-rating",
      { query: { target, date: today(), output: "json" } }
    );
    const dr = data.domain_rating?.domain_rating;
    return typeof dr === "number" ? dr : null;
  },

  /** Referring-domains + backlinks totals for a target (authority snapshot). */
  async backlinksStats(
    target: string,
    orgId = LEGACY_ORG_ID
  ): Promise<{ live_refdomains: number | null; live: number | null } | null> {
    const creds = await credentials(orgId);
    if (!creds.apiKey || !target) return null;
    const data = await providerCall<{
      metrics?: { live_refdomains?: number; live?: number };
    }>(creds, "/site-explorer/backlinks-stats", {
      query: { target, date: today(), mode: "subdomains", output: "json" },
    });
    return {
      live_refdomains: data.metrics?.live_refdomains ?? null,
      live: data.metrics?.live ?? null,
    };
  },

  /** Our combined authority snapshot (DR + referring domains + backlinks). */
  async authoritySnapshot(
    target: string,
    orgId = LEGACY_ORG_ID
  ): Promise<AuthoritySnapshot | null> {
    const configured = await this.enabled(orgId);
    if (!configured || !target) return null;
    const [dr, stats] = await Promise.all([
      this.domainRating(target, orgId),
      this.backlinksStats(target, orgId),
    ]);
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
    { limit = 100, minDr = 0 }: { limit?: number; minDr?: number } = {},
    orgId = LEGACY_ORG_ID
  ): Promise<{ disabled?: boolean; items: RefDomain[] }> {
    const creds = await credentials(orgId);
    if (!creds.apiKey || !target) return { disabled: true, items: [] };
    const where =
      minDr > 0
        ? JSON.stringify({ field: "domain_rating", is: ["gte", minDr] })
        : undefined;
    const data = await providerCall<{ refdomains?: RefDomain[] }>(
      creds,
      "/site-explorer/refdomains",
      {
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
      }
    );
    return { items: data.refdomains ?? [] };
  },

  /**
   * Organic competitors of a target (sites ranking for the same keywords),
   * ranked by keyword overlap. Feeds the competitor list whose backlink profiles
   * we then mine for prospects. Requires a country + date.
   */
  async organicCompetitors(
    target: string,
    { limit = 20, country = "us" }: { limit?: number; country?: string } = {},
    orgId = LEGACY_ORG_ID
  ): Promise<{ disabled?: boolean; items: Competitor[] }> {
    const creds = await credentials(orgId);
    if (!creds.apiKey || !target) return { disabled: true, items: [] };
    const data = await providerCall<{ competitors?: Competitor[] }>(
      creds,
      "/site-explorer/organic-competitors",
      {
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
    );
    return { items: data.competitors ?? [] };
  },

  /**
   * Broken backlinks pointing at a target (typically a competitor): pages that
   * link to a URL on the competitor that is now dead (404/gone). These are prime
   * broken-link-building prospects — we can offer our live page as a replacement
   * for the dead link. Deduped to one per referring domain to keep it actionable.
   */
  async brokenBacklinks(
    target: string,
    { limit = 20, minDr = 0 }: { limit?: number; minDr?: number } = {},
    orgId = LEGACY_ORG_ID
  ): Promise<{ disabled?: boolean; items: BrokenBacklink[] }> {
    const creds = await credentials(orgId);
    if (!creds.apiKey || !target) return { disabled: true, items: [] };
    const where =
      minDr > 0
        ? JSON.stringify({ field: "domain_rating_source", is: ["gte", minDr] })
        : undefined;
    const data = await providerCall<{ backlinks?: BrokenBacklink[] }>(
      creds,
      "/site-explorer/broken-backlinks",
      {
        query: {
          target,
          mode: "subdomains",
          aggregation: "1_per_domain",
          select:
            "root_name_source,url_from,domain_rating_source,traffic_domain,is_spam,is_dofollow,url_to,anchor,title",
          order_by: "domain_rating_source:desc",
          limit,
          where,
          output: "json",
        },
      }
    );
    return { items: data.backlinks ?? [] };
  },
};
