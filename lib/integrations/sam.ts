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
// v4 is the current Exclusions API (v2 is dead and returns 404 for every call).
const EXCLUSION_BASE = "https://api.sam.gov/entity-information/v4/exclusions";

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

/**
 * One company as SAM knows it, flattened to the fields a profile needs.
 *
 * SAM's shape is deeply nested and inconsistently populated; this is the
 * contract the rest of the app codes against, so a change at SAM lands in the
 * mapper rather than in a settings page.
 */
export interface SamEntity {
  uei: string | null;
  cageCode: string | null;
  legalName: string | null;
  dba: string | null;
  /** "Active", "Expired", ... A stale registration cannot win work. */
  registrationStatus: string | null;
  registrationExpiresAt: string | null;
  physicalAddress: string | null;
  entityState: string | null;
  naicsCodes: string[];
  /** Set-aside certifications SAM records, e.g. 8(a), HUBZone, WOSB, SDVOSB. */
  certifications: string[];
  structure: string | null;
}

/** The subset of SAM's entity payload this maps from. */
interface RawSamEntity {
  entityRegistration?: {
    ueiSAM?: string;
    cageCode?: string;
    legalBusinessName?: string;
    dbaName?: string;
    registrationStatus?: string;
    registrationExpirationDate?: string;
  };
  coreData?: {
    physicalAddress?: {
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      stateOrProvinceCode?: string;
      zipCode?: string;
    };
    entityInformation?: { entityStructureDesc?: string };
    businessTypes?: { businessTypeList?: { businessTypeDesc?: string }[] };
  };
  assertions?: {
    goodsAndServices?: {
      naicsList?: { naicsCode?: string; naicsDescription?: string }[];
    };
  };
}

/**
 * SAM business types that are actually set-aside certifications.
 *
 * The businessTypeList mixes genuine certifications with descriptors like
 * "For Profit Organization" and "Limited Liability Company", which are not
 * certifications and would be wrong to claim as such on a bid.
 */
const CERTIFICATION_HINTS = [
  "8(a)",
  "HUBZone",
  "Women Owned",
  "Woman Owned",
  "Economically Disadvantaged",
  "Veteran Owned",
  "Service Disabled",
  "Small Disadvantaged",
  "Native American",
  "Native Hawaiian",
  "Alaskan Native",
  "Tribally Owned",
  "Minority Owned",
];

export function mapSamEntity(raw: RawSamEntity): SamEntity {
  const reg = raw.entityRegistration ?? {};
  const core = raw.coreData ?? {};
  const addr = core.physicalAddress ?? {};
  const street = [addr.addressLine1, addr.addressLine2].filter(Boolean).join(" ").trim();
  const cityState = [addr.city, addr.stateOrProvinceCode].filter(Boolean).join(", ");
  const physicalAddress =
    [street, cityState, addr.zipCode].filter(Boolean).join(", ").trim() || null;

  const naicsCodes = Array.from(
    new Set(
      (raw.assertions?.goodsAndServices?.naicsList ?? [])
        .map((n) => (n.naicsCode ?? "").trim())
        .filter((c) => /^\d{6}$/.test(c))
    )
  );

  const certifications = Array.from(
    new Set(
      (core.businessTypes?.businessTypeList ?? [])
        .map((b) => (b.businessTypeDesc ?? "").trim())
        .filter((desc) =>
          CERTIFICATION_HINTS.some((h) => desc.toLowerCase().includes(h.toLowerCase()))
        )
    )
  );

  return {
    uei: reg.ueiSAM?.trim() || null,
    cageCode: reg.cageCode?.trim() || null,
    legalName: reg.legalBusinessName?.trim() || null,
    dba: reg.dbaName?.trim() || null,
    registrationStatus: reg.registrationStatus?.trim() || null,
    registrationExpiresAt: reg.registrationExpirationDate?.trim() || null,
    physicalAddress,
    entityState: addr.stateOrProvinceCode?.trim() || null,
    naicsCodes,
    certifications,
    structure: core.entityInformation?.entityStructureDesc?.trim() || null,
  };
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
   * Look a company up in SAM's entity registry, to prefill their profile.
   *
   * Searched by UEI when they know it, otherwise by legal name. Name search
   * can match several entities (subsidiaries, similar names, stale
   * registrations), so every match is returned and the customer picks; we
   * never guess which company someone works for.
   *
   * Everything here is already public record in SAM, and it is the customer's
   * own registration, but it still lands in a review form rather than
   * straight into their profile. A wrong UEI on a bid is a rejected bid.
   */
  async findEntities(input: {
    uei?: string;
    name?: string;
  }): Promise<{
    disabled?: boolean;
    error?: boolean;
    /** HTTP status SAM returned, so a permissions problem is diagnosable. */
    status?: number;
    /** SAM's own words, trimmed. Surfaced because its errors are specific. */
    detail?: string;
    entities: SamEntity[];
  }> {
    if (!config.sam.enabled) return { disabled: true, entities: [] };
    const uei = input.uei?.trim();
    const name = input.name?.trim();
    if (!uei && !name) return { entities: [] };

    /**
     * The Entity Management API is a different product from the Opportunities
     * API, with its own entitlements: a key that polls notices happily can be
     * refused here, and `assertions` (where the NAICS list lives) is the
     * section most often gated. So the sections are attempted in descending
     * order of richness and the first that answers wins, rather than the whole
     * import failing because one optional section was not permitted.
     */
    const sectionSets = [
      "entityRegistration,coreData,assertions",
      "entityRegistration,coreData",
      "entityRegistration",
    ];

    let lastStatus: number | undefined;
    let lastDetail: string | undefined;

    for (const includeSections of sectionSets) {
      try {
        const data = await withRetry(() =>
          fetchJson<{ entityData?: RawSamEntity[] }>(ENTITY_BASE, {
            query: {
              api_key: config.sam.apiKey,
              includeSections,
              ...(uei ? { ueiSAM: uei } : { legalBusinessName: name as string }),
            },
          })
        );
        return { entities: (data.entityData ?? []).slice(0, 10).map(mapSamEntity) };
      } catch (err) {
        const e = err as { status?: number; body?: unknown; message?: string };
        lastStatus = e.status;
        lastDetail =
          typeof e.body === "string"
            ? e.body.slice(0, 300)
            : e.body
              ? JSON.stringify(e.body).slice(0, 300)
              : e.message;
        // 401/403 means this key is not entitled to the sections requested;
        // dropping to a smaller set is worth trying. Anything else (a bad
        // UEI, an outage) will fail the same way for every set, so stop.
        if (e.status !== 401 && e.status !== 403) break;
      }
    }

    return { error: true, status: lastStatus, detail: lastDetail, entities: [] };
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
