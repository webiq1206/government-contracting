/**
 * Google Places client (legacy Text Search + Place Details). Used to source
 * candidate subcontractors/vendors by trade and location. Requires
 * config.googleMaps.apiKey; when missing, methods return { disabled: true }.
 * Text Search is called once per query; details are fetched only on demand
 * (enrichTopN) to control cost.
 */
import { config } from "../config";
import { fetchJson, withRetry } from "./http";

const TEXT_SEARCH = "https://maps.googleapis.com/maps/api/place/textsearch/json";
const DETAILS = "https://maps.googleapis.com/maps/api/place/details/json";

/** A contractor candidate from Text Search, optionally enriched with details. */
export interface Contractor {
  name: string;
  place_id: string;
  rating?: number;
  review_count?: number;
  address?: string;
  phone?: string;
  website?: string;
}

interface TextSearchResult {
  name?: string;
  place_id?: string;
  rating?: number;
  user_ratings_total?: number;
  formatted_address?: string;
}

interface TextSearchResponse {
  results?: TextSearchResult[];
}

interface DetailsResponse {
  result?: {
    formatted_phone_number?: string;
    website?: string;
    formatted_address?: string;
  };
}

export const googleMaps = {
  /**
   * Find contractors for a trade in a location via Text Search. Returns up to
   * `limit` (default 12) results. Does NOT fetch per-place details — use
   * placeDetails / enrichTopN for phone + website.
   */
  async findContractors(params: {
    trade: string;
    location: string;
    limit?: number;
  }): Promise<{ disabled?: boolean; results: Contractor[] }> {
    if (!config.googleMaps.enabled) return { disabled: true, results: [] };
    const { trade, location, limit = 12 } = params;

    try {
      const data = await withRetry(() =>
        fetchJson<TextSearchResponse>(TEXT_SEARCH, {
          query: {
            query: `${trade} contractor in ${location}`,
            key: config.googleMaps.apiKey,
          },
        })
      );
      const results: Contractor[] = (data.results ?? [])
        .slice(0, limit)
        .map((r) => ({
          name: r.name ?? "",
          place_id: r.place_id ?? "",
          rating: r.rating,
          review_count: r.user_ratings_total,
          address: r.formatted_address,
        }));
      return { results };
    } catch {
      return { results: [] };
    }
  },

  /** Fetch phone/website/address for a single place. Returns null on failure. */
  async placeDetails(
    placeId: string
  ): Promise<{ phone?: string; website?: string; address?: string } | null> {
    if (!config.googleMaps.enabled || !placeId) return null;
    try {
      const data = await withRetry(() =>
        fetchJson<DetailsResponse>(DETAILS, {
          query: {
            place_id: placeId,
            fields: "formatted_phone_number,website,formatted_address",
            key: config.googleMaps.apiKey,
          },
        })
      );
      const r = data.result;
      if (!r) return null;
      return {
        phone: r.formatted_phone_number,
        website: r.website,
        address: r.formatted_address,
      };
    } catch {
      return null;
    }
  },

  /**
   * Merge Place Details (phone/website) into the first `n` results. Resilient:
   * individual detail lookups that fail leave that contractor unchanged.
   */
  async enrichTopN(results: Contractor[], n: number): Promise<Contractor[]> {
    const top = results.slice(0, n);
    const settled = await Promise.allSettled(
      top.map((c) => this.placeDetails(c.place_id))
    );
    return results.map((c, i) => {
      if (i >= top.length) return c;
      const outcome = settled[i];
      if (outcome.status !== "fulfilled" || !outcome.value) return c;
      const d = outcome.value;
      return {
        ...c,
        phone: d.phone ?? c.phone,
        website: d.website ?? c.website,
        address: d.address ?? c.address,
      };
    });
  },
};
