/**
 * Google Places client (legacy Text Search + Place Details). Used to source
 * candidate subcontractors/vendors by trade and location.
 *
 * The key belongs to the organization, not the platform: Places is billed per
 * request, so a customer's searches must run on their own key. Resolved per
 * call via orgApiKey; when they have not set one, methods return
 * { disabled: true } rather than falling back to ours.
 * Text Search is called once per query; details are fetched only on demand
 * (enrichTopN) to control cost.
 */
import { config } from "../config";
import { orgApiKey } from "../integration-keys";
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
  status?: string; // "OK" | "ZERO_RESULTS" | "REQUEST_DENIED" | "OVER_QUERY_LIMIT" | ...
  error_message?: string;
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
   * `limit` (default 12) results. Does NOT fetch per-place details, use
   * placeDetails / enrichTopN for phone + website.
   */
  async findContractors(params: {
    trade: string;
    location: string;
    limit?: number;
  }): Promise<{ disabled?: boolean; error?: string; results: Contractor[] }> {
    const apiKey = await orgApiKey("GOOGLE_MAPS_API_KEY");
    if (!apiKey) return { disabled: true, results: [] };
    const { trade, location, limit = 12 } = params;

    try {
      const data = await withRetry(() =>
        fetchJson<TextSearchResponse>(TEXT_SEARCH, {
          query: {
            query: `${trade} contractor in ${location}`,
            key: apiKey,
          },
        })
      );
      // Places returns HTTP 200 with a status field even on failure, a denied
      // or rate-limited key yields empty results that look like "no contractors."
      // Surface it so the misconfig isn't silent.
      if (data.status && !["OK", "ZERO_RESULTS"].includes(data.status)) {
        const detail = `Places status ${data.status}${data.error_message ? ": " + data.error_message : ""}`;
        console.error(`[googleMaps] ${detail}`);
        // A denied or over-quota key returns empty results in a 200; without
        // this, that reads as "no contractors in this area".
        return { results: [], error: detail };
      }
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
    } catch (err) {
      return { results: [], error: (err as Error).message };
    }
  },

  /** Fetch phone/website/address for a single place. Returns null on failure. */
  async placeDetails(
    placeId: string
  ): Promise<{ phone?: string; website?: string; address?: string } | null> {
    const apiKey = await orgApiKey("GOOGLE_MAPS_API_KEY");
    if (!apiKey || !placeId) return null;
    try {
      const data = await withRetry(() =>
        fetchJson<DetailsResponse>(DETAILS, {
          query: {
            place_id: placeId,
            fields: "formatted_phone_number,website,formatted_address",
            key: apiKey,
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
