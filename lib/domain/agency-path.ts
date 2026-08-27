/**
 * Federal agency names, shortened without being falsified.
 *
 * A buying office arrives as a path: "DEPT OF DEFENSE / DEPT OF THE ARMY /
 * AMC / ACC / 411TH CONTRACTING SUPPORT BRIGADE". Forty to eighty characters,
 * and the first two thirds of it is the same on every row an army contractor
 * will ever see. In a table column that meant every agency cell read
 * "DEPT OF DEFENSE, DEPT OF THE A..." and told the operator nothing.
 *
 * Truncation is the wrong fix twice over. It cuts at a character count rather
 * than at a meaning, so the part it keeps is the part that does not vary; and
 * it leaves the rest reachable only by hovering, which does not exist on the
 * device half these queues are worked from.
 *
 * So the path is split into levels and the LAST one is shown, because the most
 * specific level is the one that distinguishes one row from another. The full
 * path travels with it, for the record page and for a screen reader.
 */

/** How a source separates the levels of a path. */
const SEPARATORS = /\s*(?:\/|\||·|•|>)\s*/;

/**
 * Levels, most general first.
 *
 * Both fields are folded in, because SAM sends the department in `agency` and
 * the service in `sub_agency`, and either can itself contain a path.
 */
export function agencyLevels(
  agency: string | null | undefined,
  subAgency?: string | null
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of [agency, subAgency]) {
    if (!part) continue;
    for (const level of part.split(SEPARATORS)) {
      const clean = level.trim().replace(/\s+/g, " ");
      if (!clean) continue;
      // The same level arriving in both fields is one level, not two.
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(clean);
    }
  }
  return out;
}

export interface AgencyDisplay {
  /** What the row shows. Never empty when anything was known. */
  short: string;
  /** Every level, most general first, joined for reading aloud. */
  full: string;
  /** True when `short` leaves something out, so the caller can offer the rest. */
  shortened: boolean;
  /** How many levels sit above the one shown. */
  hidden: number;
}

/**
 * A path that is not known says so.
 *
 * "Unknown agency" rather than a dash, because a dash in an agency column is
 * indistinguishable from a rendering fault, and this is a field an operator
 * uses to decide whether a solicitation is worth reading.
 */
export const AGENCY_UNKNOWN = "Agency not on the record";

export function shortenAgency(
  agency: string | null | undefined,
  subAgency?: string | null
): AgencyDisplay {
  const levels = agencyLevels(agency, subAgency);
  if (levels.length === 0) {
    return { short: AGENCY_UNKNOWN, full: AGENCY_UNKNOWN, shortened: false, hidden: 0 };
  }
  const full = levels.join(" / ");
  const last = levels[levels.length - 1]!;
  /*
   * One level is usually enough, and sometimes it is not.
   *
   * "ARMY" on its own is not an office, and neither is a bare acronym: where
   * the most specific level is short, the one above it is what makes it mean
   * something. Twenty characters is the line, chosen because it is roughly
   * where a real office name starts ("ACC-Fort Bliss", "NAVFAC SOUTHEAST").
   */
  const needsParent = last.length < 20 && levels.length > 1;
  const short = needsParent ? `${levels[levels.length - 2]} / ${last}` : last;
  const shownLevels = needsParent ? 2 : 1;
  return {
    short,
    full,
    shortened: levels.length > shownLevels,
    hidden: Math.max(0, levels.length - shownLevels),
  };
}
