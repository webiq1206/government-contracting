/**
 * USAspending.gov client, federal award search and incumbent detection.
 * Public API (no key required); base URL from config.usaspending.baseUrl.
 * Non-ok responses degrade gracefully to empty result sets so agents log a
 * skip instead of crashing.
 */
import { config } from "../config";
import { fetchJson, HttpError, withRetry } from "./http";
import { serviceAreaStateCodes } from "../us-states";

const base = config.usaspending.baseUrl;

/** A single normalized award row returned by searchAwards. */
export interface UsaAward {
  award_amount: number;
  action_date: string;
  recipient_name: string;
  awarding_agency: string;
  award_id: string;
}

export interface SearchAwardsParams {
  naics?: string;
  state?: string;
  fromDate?: string; // YYYY-MM-DD
  toDate?: string; // YYYY-MM-DD
  limit?: number;
}

/** Raw row shape from spending_by_award (keys are the requested field labels). */
interface RawAwardRow {
  "Award Amount"?: unknown;
  // "Action Date" is NOT a valid spending_by_award field (it's transaction-level)
  // and always returned null, which broke CPI adjustment. These are the valid
  // award-level date fields; Base Obligation Date is closest to the award date.
  "Base Obligation Date"?: unknown;
  "Start Date"?: unknown;
  "Recipient Name"?: unknown;
  "Awarding Agency"?: unknown;
  "Award ID"?: unknown;
}

function toStr(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const usaspending = {
  /**
   * Search prime awards (contract types A/B/C/D) by NAICS, state, and date
   * window. Defaults to the last 36 months when no dates are supplied.
   * A failure comes back as { results: [], error }: an outage that read as
   * "no award history" once fed zeroed comp stats and $0 target bids into
   * live pricing guidance.
   */
  async searchAwards(
    params: SearchAwardsParams = {}
  ): Promise<{ results: UsaAward[]; error?: string; skippedReason?: string }> {
    const { naics, state, fromDate, toDate, limit = 100 } = params;
    const normalizedState = state?.trim()
      ? serviceAreaStateCodes([state])?.values().next().value
      : undefined;
    if (state?.trim() && !normalizedState) {
      // SAM also supplies foreign subdivision codes (e.g. Seoul's KR-11).
      // Do not submit those as US states or silently broaden to unrelated comps.
      return {
        results: [],
        skippedReason: `The location "${state.trim()}" is not a supported U.S. state or territory. Automatic pricing comparisons currently require a U.S. location. Review pricing manually, or correct the location if this is a U.S. opportunity.`,
      };
    }
    const now = new Date();
    const start = fromDate ?? isoDate(new Date(now.getTime() - 36 * 30 * 86_400_000));
    const end = toDate ?? isoDate(now);

    const body = {
      filters: {
        award_type_codes: ["A", "B", "C", "D"],
        naics_codes: naics ? [naics] : undefined,
        place_of_performance_locations: normalizedState
          ? [{ country: "USA", state: normalizedState }]
          : undefined,
        time_period: [{ start_date: start, end_date: end }],
      },
      fields: [
        "Award Amount",
        "Base Obligation Date",
        "Start Date",
        "Recipient Name",
        "Awarding Agency",
        "Award ID",
      ],
      page: 1,
      limit,
    };

    try {
      const data = await withRetry(() =>
        fetchJson<{ results?: RawAwardRow[] }>(
          `${base}/api/v2/search/spending_by_award/`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        )
      );
      const rows = data.results ?? [];
      const results: UsaAward[] = rows.map((r) => ({
        award_amount: toNum(r["Award Amount"]),
        // Prefer Base Obligation Date (award timing); fall back to Start Date.
        action_date: toStr(r["Base Obligation Date"] || r["Start Date"]),
        recipient_name: toStr(r["Recipient Name"]),
        awarding_agency: toStr(r["Awarding Agency"]),
        award_id: toStr(r["Award ID"]),
      }));
      return { results };
    } catch (err) {
      const detail = err instanceof HttpError && [400, 422].includes(err.status)
        && err.body && typeof err.body === "object" && "detail" in err.body
        && typeof err.body.detail === "string" ? err.body.detail.slice(0, 400) : null;
      return { results: [], error: `${(err as Error).message}${detail ? `: ${detail}` : ""}` };
    }
  },

  /** Count of awards in the given NAICS (+optional state) over the last 36 months. */
  async awardFrequency(naics: string, state?: string): Promise<number> {
    const { results } = await this.searchAwards({ naics, state, limit: 100 });
    return results.length;
  },

  /**
   * Most recent award in a NAICS+state, used to identify a likely incumbent.
   * Returns null when nothing is found.
   */
  async findIncumbent(
    naics: string,
    state: string
  ): Promise<{ recipient_name: string; award_amount: number; action_date: string } | null> {
    const { results } = await this.searchAwards({ naics, state, limit: 100 });
    if (results.length === 0) return null;
    const mostRecent = results.reduce((latest: UsaAward, cur: UsaAward) =>
      cur.action_date > latest.action_date ? cur : latest
    );
    return {
      recipient_name: mostRecent.recipient_name,
      award_amount: mostRecent.award_amount,
      action_date: mostRecent.action_date,
    };
  },
};
