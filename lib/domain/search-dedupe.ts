/**
 * Collapsing duplicate records in search results.
 *
 * Lives here rather than in the route because a Next.js route module may only
 * export its HTTP handlers, and because this rule is worth testing on its own.
 */
export interface OppHit {
  id: string;
  title: string | null;
  agency: string | null;
  solicitation_number: string | null;
  stage: string;
  status: string;
}

/**
 * Collapse rows that are the same solicitation ingested more than once.
 *
 * The same notice can enter twice -- re-posted by the agency, or fetched
 * again before dedupe was tightened -- and search then showed the same job
 * two or three times, with different stages, and no way to tell which one the
 * work had actually been done on. Picking one at random would be worse than
 * the duplicates, so the rule is explicit: an open record beats an archived
 * one, and the most recently touched wins a tie. That is the record the
 * operator has been working, which is the one they meant.
 *
 * Keyed on the solicitation number, which is the government's own identifier
 * for the notice. Records without one are never merged: two untitled manual
 * entries that happen to share a name are not evidence of anything.
 */
export function dedupeOpportunityHits(rows: OppHit[]): (OppHit & { duplicates: number })[] {
  const byKey = new Map<string, OppHit & { duplicates: number }>();
  const out: (OppHit & { duplicates: number })[] = [];

  for (const r of rows) {
    const key = (r.solicitation_number ?? "").trim().toLowerCase();
    if (!key) {
      out.push({ ...r, duplicates: 0 });
      continue;
    }
    const seen = byKey.get(key);
    if (!seen) {
      const entry = { ...r, duplicates: 0 };
      byKey.set(key, entry);
      out.push(entry);
      continue;
    }
    seen.duplicates += 1;
    // The incoming row wins only if it is open and the kept one is not. The
    // query already orders open-first then newest, so anything else keeps the
    // row we have.
    if (r.status === "open" && seen.status !== "open") {
      Object.assign(seen, r, { duplicates: seen.duplicates });
    }
  }
  return out;
}

/**
 * Global search across the three record types an operator hunts for by name:
 * opportunities (title / solicitation # / agency), subcontractors (company /
 * owner), and contracts (contract #). Case-insensitive substring match,
 * capped per type, newest-relevant first. Powers the ⌘K palette.
 */
