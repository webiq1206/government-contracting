/**
 * SAM.gov client — opportunity ingestion, award/registration monitoring,
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
  naicsCodes?: string[];
  ptype?: string; // notice type filter
  states?: string[];
  setAside?: string;
  limit?: number;
  offset?: number;
  title?: string;
}

function mmddyyyy(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

export const sam = {
  enabled: () => config.sam.enabled,

  async searchOpportunities(
    params: SearchParams = {}
  ): Promise<{ disabled?: boolean; total: number; items: SamOpportunity[] }> {
    if (!config.sam.enabled) return { disabled: true, total: 0, items: [] };
    const now = new Date();
    const from = params.postedFrom ?? mmddyyyy(new Date(now.getTime() - 3 * 86_400_000));
    const to = params.postedTo ?? mmddyyyy(now);
    const query: Record<string, string | number | undefined> = {
      api_key: config.sam.apiKey,
      postedFrom: from,
      postedTo: to,
      limit: params.limit ?? 100,
      offset: params.offset ?? 0,
      ptype: params.ptype,
      ncode: params.naicsCodes?.join(","),
      state: params.states?.join(","),
      typeOfSetAside: params.setAside,
      title: params.title,
    };
    const data = await withRetry(() =>
      fetchJson<{ totalRecords: number; opportunitiesData: SamOpportunity[] }>(OPP_BASE, {
        query,
      })
    );
    return {
      total: data.totalRecords ?? 0,
      items: data.opportunitiesData ?? [],
    };
  },

  /** Sources Sought notices specifically (routed to the high-priority sub-queue). */
  async searchSourcesSought(naicsCodes: string[]): Promise<SamOpportunity[]> {
    const res = await this.searchOpportunities({
      naicsCodes,
      ptype: "r", // 'r' = Sources Sought in SAM's ptype codes
      limit: 50,
    });
    return res.items;
  },

  /** Entity registration status + expiry — used by Compliance Monitor. */
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

  /** Check whether a company appears on the SAM exclusions (debarment) list. */
  async isExcluded(name: string): Promise<{ disabled?: boolean; excluded: boolean }> {
    if (!config.sam.enabled || !name) return { disabled: true, excluded: false };
    try {
      const data = await withRetry(() =>
        fetchJson<{ totalRecords?: number }>(EXCLUSION_BASE, {
          query: { api_key: config.sam.apiKey, exclusionName: name },
        })
      );
      return { excluded: (data.totalRecords ?? 0) > 0 };
    } catch {
      return { excluded: false };
    }
  },

  /** Award notices for post-submission tracking (win/loss detection). */
  async getAwardNotices(solicitationNumber: string): Promise<SamOpportunity[]> {
    if (!config.sam.enabled || !solicitationNumber) return [];
    const res = await this.searchOpportunities({
      title: solicitationNumber,
      ptype: "a", // 'a' = Award Notice
      limit: 10,
    });
    return res.items.filter(
      (i) => i.solicitationNumber === solicitationNumber || i.type === "Award Notice"
    );
  },
};
