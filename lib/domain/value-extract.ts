/**
 * Estimated-value extraction. SAM.gov almost never publishes a contract's
 * dollar value on a live solicitation (that field is only populated on AWARD
 * notices), yet the value is one of the biggest decision factors: it drives
 * the scoring rubric's value dimension, the auto-dismiss "too small" rule,
 * and what a human sees at a glance. So the platform reads for it wherever it
 * might appear, deterministically, and always says how sure it is.
 *
 * Three passes, cheapest and most certain first, each only running if the
 * one before it found nothing:
 *   1. listed     - the source's own structured value field (SAM's
 *                    award.amount, or a scraped portal's own value field),
 *                    rare on a live solicitation but authoritative when present
 *   2. extracted  - a regex sweep of the title/description text
 *   3. analysis   - Solicitation Analyst's read of the FULL text +
 *                    attachments (the deepest pass, since it can see the
 *                    IGCE/PWS/budget language the listing text omits)
 *
 * Anything except "listed" is a best-effort estimate, and the UI must say so,
 * never present a regex guess as if the source had published a real number.
 */

export type ValueSource = "listed" | "extracted" | "analysis";

export interface ExtractedValue {
  amount: number;
  source: ValueSource;
}

const MIN_PLAUSIBLE = 1_000; // below this, it's not a contract value (a fee, a fine, a per-unit price)
const MAX_PLAUSIBLE = 50_000_000_000; // above this, it's almost certainly a typo or an unrelated figure

// Context words that raise confidence a nearby dollar figure IS the contract
// value, as opposed to a fee, wage rate, bond amount, or penalty.
const VALUE_CONTEXT = /(estimated|ceiling|not.to.exceed|nte|magnitude|value|IGCE|budget|award|contract\s+(?:value|amount)|total\s+(?:value|amount)|not-to-exceed)/i;

// Context words that mean a dollar figure is almost certainly NOT the
// contract's own value (wage determinations, bonding/insurance minimums,
// liquidated-damages penalties), so a figure near one of these is skipped
// even though it is a real, well-formed dollar amount.
const NEGATIVE_CONTEXT = /(wage|hourly|per\s+hour|bond(?:ing)?\s+(?:amount|requirement|minimum)|insurance\s+(?:minimum|requirement)|liquidated\s+damages|penalty|late\s+fee|per\s+diem|fine\s+of)/i;

/** One "$<number>" match with optional K/M/B suffix, e.g. "$1.2M", "$350,000". */
const MONEY_RE = /\$\s?([\d][\d,]*(?:\.\d+)?)\s?(K|M|B|thousand|million|billion)?\b/gi;

const SUFFIX_MULT: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  m: 1_000_000,
  million: 1_000_000,
  b: 1_000_000_000,
  billion: 1_000_000_000,
};

function plausible(n: number): boolean {
  return Number.isFinite(n) && n >= MIN_PLAUSIBLE && n <= MAX_PLAUSIBLE;
}

/**
 * Sweep free text for the contract's dollar value. Looks at a window of text
 * around each "$" match: a positive context word nearby raises its priority,
 * a negative one excludes it outright. Among the remaining candidates, prefer
 * the one with positive context; if several qualify (e.g. a stated range),
 * take the largest, a ceiling/NTE figure is the number a bid should be
 * judged against. Returns null rather than a low-confidence guess.
 */
export function extractValueFromText(text: string | null | undefined): number | null {
  if (!text) return null;
  const WINDOW = 60;
  const candidates: { amount: number; hasPositive: boolean }[] = [];

  for (const m of text.matchAll(MONEY_RE)) {
    const raw = m[1].replace(/,/g, "");
    let amount = Number(raw);
    if (!Number.isFinite(amount)) continue;
    const suffix = (m[2] ?? "").toLowerCase();
    if (suffix) amount *= SUFFIX_MULT[suffix] ?? 1;
    if (!plausible(amount)) continue;

    const start = Math.max(0, (m.index ?? 0) - WINDOW);
    const end = Math.min(text.length, (m.index ?? 0) + m[0].length + WINDOW);
    const around = text.slice(start, end);
    if (NEGATIVE_CONTEXT.test(around)) continue;

    candidates.push({ amount, hasPositive: VALUE_CONTEXT.test(around) });
  }

  if (candidates.length === 0) return null;
  const withContext = candidates.filter((c) => c.hasPositive);
  const pool = withContext.length > 0 ? withContext : candidates;
  // Prefer the largest: for a stated range ("$50,000 to $75,000") or a
  // ceiling figure, the upper bound is what the contract can actually pay,
  // and it's the safer number to score eligibility against.
  return Math.max(...pool.map((c) => c.amount));
}

/**
 * Resolve the best available value for an opportunity from everything on
 * hand, in the priority order described above. `analysisEstimatedValue` is
 * the Solicitation Analyst's plain-English `estimated_value` string (e.g.
 * "$250,000" or "Not specified"), only consulted once analysis has run.
 */
export function resolveEstimatedValue(input: {
  listedAmount?: number | null;
  title?: string | null;
  description?: string | null;
  analysisEstimatedValue?: string | null;
}): ExtractedValue | null {
  if (input.listedAmount != null && plausible(input.listedAmount)) {
    return { amount: input.listedAmount, source: "listed" };
  }
  const fromListing = extractValueFromText(
    [input.title, input.description].filter(Boolean).join("\n")
  );
  if (fromListing != null) return { amount: fromListing, source: "extracted" };

  const fromAnalysis = extractValueFromText(input.analysisEstimatedValue);
  if (fromAnalysis != null) return { amount: fromAnalysis, source: "analysis" };

  return null;
}
