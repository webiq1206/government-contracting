/**
 * Pure helpers for solicitation identity / dedupe. Used by Opportunity Monitor
 * ingest and unit-tested independently of the database.
 */

/** Trim; empty string becomes null (never store blank source ids). */
export function normalizeSourceId(
  value: string | null | undefined
): string | null {
  const s = (value ?? "").trim();
  return s || null;
}

/** Trim; empty string becomes null. */
export function normalizeSolicitationNumber(
  value: string | null | undefined
): string | null {
  const s = (value ?? "").trim();
  return s || null;
}

/** Canonical compare key for solicitation numbers (case-insensitive). */
export function solicitationNumberKey(
  value: string | null | undefined
): string | null {
  const n = normalizeSolicitationNumber(value);
  return n ? n.toLowerCase() : null;
}

export type OpportunityDedupeReason = "source_id" | "solicitation_number";

/**
 * Prefer source_id match over solicitation-number match when both are present
 * in lookup results (exact notice identity beats soft sol-number identity).
 */
export function preferDedupeMatch(opts: {
  bySourceId: { id: string } | null;
  bySolicitationNumber: { id: string } | null;
}): { id: string; reason: OpportunityDedupeReason } | null {
  if (opts.bySourceId) return { id: opts.bySourceId.id, reason: "source_id" };
  if (opts.bySolicitationNumber) {
    return {
      id: opts.bySolicitationNumber.id,
      reason: "solicitation_number",
    };
  }
  return null;
}
