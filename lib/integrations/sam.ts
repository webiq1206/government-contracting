/**
 * SAM.gov client, opportunity ingestion, award/registration monitoring,
 * exclusions list. Uses the public Opportunities v2 and Entity/Exclusions APIs.
 * Requires SAM_API_KEY. When missing, methods return empty results + disabled:true
 * so agents log a skip instead of crashing.
 */
import { config } from "../config";
import { fetchJson, withRetry } from "./http";

const OPP_BASE = "https://api.sam.gov/opportunities/v2/search";
const ENTITY_BASE = "https://api.sam.gov/entity-information/v3/entities";
const EXCLUSION_BASE = "https://api.sam.gov/entity-information/v2/exclusions";

export interface SamOpportunity {
  noticeId: string;
  title: string;
  solicitationNumber?: string;
  fullParentPathName?: string;
  department?: string;
  subTier?: string;
  naicsCode?: string;
  classificationCode?: string;
  typeOfSetAside?: string;
  typeOfSetAsideDescription?: string;
  type?: string; // "Solicitation" | "Sources Sought" | "Presolicitation" | ...
  postedDate?: string;
  responseDeadLine?: string;
  placeOfPerformance?: {
    state?: { code?: string; name?: string };
    city?: { name?: string };
  };
  pointOfContact?: { fullName?: string; email?: string; phone?: string }[];
  resourceLinks?: string[];
  description?: string;
  award?: { amount?: string; awardee?: { name?: string } };
  uiLink?: string;
}

export interface SearchParams {
  postedFrom?: string; // MM/DD/YYYY
  postedTo?: string; // MM/DD/YYYY
  /** SINGLE NAICS code. SAM's `ncode` accepts one value only, never a list. */
  naics?: string;
  /** SINGLE procurement type code (o/p/k/r/a/...). SAM's `ptype` is single-value. */
  ptype?: string;
  /** SINGLE place-of-performance state code. SAM's `state` is single-value. */
  state?: string;
  setAside?: string;
  limit?: number;
  offset?: number;
  title?: string;
  solnum?: string; // solicitation-number lookup (exact), for award tracking
}

function mmddyyyy(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

/**
 * Build the SAM Opportunities v2 query string. CRITICAL: SAM's `ncode`, `ptype`,
 * and `state` each accept a SINGLE value only (per the official API docs), so
 * this never comma-joins them. Multi-NAICS coverage is achieved by calling the
 * search once per code (see the Opportunity Monitor), not by joining. Kept pure
 * and exported so the mapping is unit-tested.
 */
export function buildOpportunityQuery(
  params: SearchParams,
  apiKey: string | undefined,
  now: Date = new Date()
): Record<string, string | number | undefined> {
  const from = params.postedFrom ?? mmddyyyy(new Date(now.getTime() - 3 * 86_400_000));
  const to = params.postedTo ?? mmddyyyy(now);
  return {
    api_key: apiKey,
    postedFrom: from,
    postedTo: to,
    limit: params.limit ?? 100,
    offset: params.offset ?? 0,
    ptype: params.ptype, // single value only
    ncode: params.naics, // single value only
    state: params.state, // single value only
    typeOfSetAside: params.setAside,
    title: params.title,
    solnum: params.solnum,
  };
}

/**
 * Which SAM notice types the pipeline ingests: the biddable solicitations
 * (Solicitation, Presolicitation, Combined Synopsis/Solicitation, which is how
 * RFQs/RFPs/IFBs arrive) plus Sources Sought (routed to the SS Responder).
 * Excludes Award Notices, Special Notices, Justifications, Surplus sales, and
 * Intent-to-Bundle. Matches on SAM's full type strings.
 */
export function wantNoticeType(type: string | undefined): boolean {
  const t = (type ?? "").toLowerCase();
  return t.includes("solicitation") || t.includes("sources sought");
}

export const sam = {
  enabled: () => config.sam.enabled,

  async searchOpportunities(
    params: SearchParams = {}
  ): Promise<{ disabled?: boolean; total: number; items: SamOpportunity[] }> {
    if (!config.sam.enabled) return { disabled: true, total: 0, items: [] };
    const query = buildOpportunityQuery(params, config.sam.apiKey);
    // Never throw on a SAM outage / rate-limit (SAM keys are ~1000/day): the
    // Opportunity Monitor's primary ingestion path must log a skip, not crash.
    try {
      const data = await withRetry(() =>
        fetchJson<{ totalRecords: number; opportunitiesData: SamOpportunity[] }>(OPP_BASE, {
          query,
        })
      );
      return {
        total: data.totalRecords ?? 0,
        items: data.opportunitiesData ?? [],
      };
    } catch {
      return { total: 0, items: [] };
    }
  },

  /**
   * Sources Sought notices specifically (routed to the high-priority sub-queue).
   * One request per NAICS code, since `ncode` is single-value; deduped by noticeId.
   */
  async searchSourcesSought(naicsCodes: string[]): Promise<SamOpportunity[]> {
    const byId = new Map<string, SamOpportunity>();
    for (const code of naicsCodes) {
      const res = await this.searchOpportunities({
        naics: code,
        ptype: "r", // 'r' = Sources Sought in SAM's ptype codes
        limit: 50,
      });
      if (res.disabled) return [];
      for (const o of res.items) if (o.noticeId) byId.set(o.noticeId, o);
    }
    return [...byId.values()];
  },

  /** Entity registration status + expiry, used by Compliance Monitor. */
  async getEntityRegistration(
    uei: string
  ): Promise<{ disabled?: boolean; status?: string; expiresAt?: string } | null> {
    if (!config.sam.enabled || !uei) return { disabled: true };
    try {
      const data = await withRetry(() =>
        fetchJson<{ entityData?: { entityRegistration?: { registrationStatus?: string; registrationExpirationDate?: string } }[] }>(
          ENTITY_BASE,
          { query: { api_key: config.sam.apiKey, ueiSAM: uei } }
        )
      );
      const reg = data.entityData?.[0]?.entityRegistration;
      return {
        status: reg?.registrationStatus,
        expiresAt: reg?.registrationExpirationDate,
      };
    } catch {
      return null;
    }
  },

  /**
   * Check whether a company appears on the SAM exclusions (debarment) list.
   * On error returns `error:true` (NOT a clean `excluded:false`) so a compliance
   * check can treat "unknown" differently from "confirmed clear", a debarment
   * check that silently reads as clear on an API error is a dangerous false
   * negative for a gov-contracting gate.
   */
  async isExcluded(
    name: string
  ): Promise<{ disabled?: boolean; excluded: boolean; error?: boolean }> {
    if (!config.sam.enabled || !name) return { disabled: true, excluded: false };
    try {
      const data = await withRetry(() =>
        fetchJson<{ totalRecords?: number }>(EXCLUSION_BASE, {
          query: { api_key: config.sam.apiKey, exclusionName: name },
        })
      );
      return { excluded: (data.totalRecords ?? 0) > 0 };
    } catch {
      return { excluded: false, error: true };
    }
  },

  /** Award notices for post-submission tracking (win/loss detection). */
  async getAwardNotices(solicitationNumber: string): Promise<SamOpportunity[]> {
    if (!config.sam.enabled || !solicitationNumber) return [];
    // Look up by exact solicitation number (solnum), not a title keyword, award
    // notices rarely carry the solicitation number in their title, so the old
    // title filter returned nothing and win/loss detection never fired.
    const res = await this.searchOpportunities({
      solnum: solicitationNumber,
      ptype: "a", // 'a' = Award Notice
      limit: 10,
    });
    return res.items.filter(
      (i: SamOpportunity) =>
        i.solicitationNumber === solicitationNumber || i.type === "Award Notice"
    );
  },
};
