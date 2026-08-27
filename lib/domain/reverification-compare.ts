/**
 * Turning "what the source says now" and "what the record says" into a list of
 * differences a person can act on.
 *
 * This is where a re-check earns its name. Fetching the notice again is
 * plumbing; the question that matters is what counts as a difference, and the
 * two ways of getting that wrong are opposite and both bad.
 *
 * Too sensitive and every run reports thirty changes, mostly whitespace and
 * reordering, and people stop reading the report. Too forgiving and a
 * requirement that gained the word "not" reads as unchanged.
 *
 * So text is normalised before comparison and never before storage: what is
 * shown as before and after is what was actually written, and only the
 * matching is loosened. Dates and amounts are compared as values rather than
 * as strings, because "April 1" and "2026-04-01" are the same deadline and
 * "$20,000" and "$2,000" are not the same money however similar they look.
 *
 * Pure.
 */
import type { Finding, VerificationScope } from "./reverification";

/**
 * Loosened only where looseness is safe: case, surrounding space, runs of
 * whitespace, and the punctuation that varies between a PDF's text layer and
 * an HTML rendering of the same sentence.
 *
 * Deliberately does NOT strip negations, numbers, or anything else that
 * carries meaning.
 */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .replace(/[ \t]*([.,;:])[ \t]*/g, "$1 ")
    .trim();
}

function sameText(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return a === b;
  return normalizeText(a) === normalizeText(b);
}

export interface MetadataField {
  /** The name a person reads, not the column. */
  label: string;
  before: string | null;
  after: string | null;
  /**
   * True when this field is only a description of the notice: an agency name,
   * a contact, a source URL. Everything else is material by default, which is
   * the safe direction for a flag that decides whether a person has to look.
   */
  cosmetic?: boolean;
}

/**
 * Metadata differences.
 *
 * A field that is absent on both sides produces nothing. A field that has
 * gained or lost a value is an addition or a removal rather than a change,
 * because "we did not know and now we do" and "it was replaced" are different
 * things and only the second implies the source moved.
 */
export function compareMetadata(fields: MetadataField[]): Finding[] {
  const out: Finding[] = [];
  for (const f of fields) {
    const before = f.before?.trim() || null;
    const after = f.after?.trim() || null;
    if (before == null && after == null) continue;
    if (sameText(before, after)) {
      out.push({
        scope: "source_and_amendments",
        subject: f.label,
        kind: "unchanged",
        impact: "safe_metadata",
        before,
        after,
      });
      continue;
    }
    const kind = before == null ? "added" : after == null ? "removed" : "changed";
    out.push({
      scope: "source_and_amendments",
      subject: f.label,
      kind,
      impact: f.cosmetic ? "safe_metadata" : "material",
      before,
      after,
      note:
        after == null
          ? "The source no longer publishes this. The value on file is kept and is no longer confirmed."
          : null,
    });
  }
  return out;
}

export interface DeadlineComparison {
  label: string;
  before: Date | null;
  after: Date | null;
  beforeTimezone: string | null;
  afterTimezone: string | null;
}

/**
 * A deadline, compared as a moment rather than as a string.
 *
 * Earlier is blocking, and that is the entire reason this function is separate
 * from `compareMetadata`. Every other change costs attention; this one costs
 * the bid, because everything scheduled against the old date is now late and
 * nobody finds out from a row in a table of differences.
 *
 * A timezone change with the same wall time is a real change of moment and is
 * reported as one, not as cosmetic.
 */
export function compareDeadline(c: DeadlineComparison): Finding[] {
  const out: Finding[] = [];
  const beforeMs = c.before?.getTime() ?? null;
  const afterMs = c.after?.getTime() ?? null;

  if (beforeMs == null && afterMs == null) return out;
  if (beforeMs != null && afterMs != null && beforeMs === afterMs) {
    if (!sameText(c.beforeTimezone, c.afterTimezone)) {
      out.push({
        scope: "requirements_and_deadlines",
        subject: `${c.label} timezone`,
        kind: "changed",
        impact: "material",
        before: c.beforeTimezone,
        after: c.afterTimezone,
        note: "Same clock time, different zone. Check which one the close is measured in.",
      });
      return out;
    }
    out.push({
      scope: "requirements_and_deadlines",
      subject: c.label,
      kind: "unchanged",
      impact: "safe_metadata",
      before: c.before?.toISOString() ?? null,
      after: c.after?.toISOString() ?? null,
    });
    return out;
  }

  const earlier = beforeMs != null && afterMs != null && afterMs < beforeMs;
  out.push({
    scope: "requirements_and_deadlines",
    subject: c.label,
    kind: beforeMs == null ? "added" : afterMs == null ? "removed" : "changed",
    impact: earlier || afterMs == null ? "blocking" : "material",
    before: c.before?.toISOString() ?? null,
    after: c.after?.toISOString() ?? null,
    note: earlier
      ? "The close moved earlier. Everything scheduled against the old date is already late."
      : afterMs == null
        ? "The source no longer publishes a close date. Treat the record's date as unconfirmed."
        : "The close moved later. Quote due dates can move with it.",
  });
  return out;
}

export interface DocumentFacts {
  /** The stable identity: the source's own id where there is one, else name. */
  key: string;
  name: string;
  contentHash: string | null;
  pageCount: number | null;
  /** False when the file could not be opened on this run. */
  readable: boolean;
  version?: number | null;
}

/**
 * The attachment manifest, compared.
 *
 * The inventory on file is deliberately not trusted as complete: the `after`
 * side is enumerated from the source afresh, and anything only on the `before`
 * side is a removal rather than an omission of the new enumeration.
 *
 * A file whose name is unchanged and whose hash moved is the case this exists
 * for. Agencies re-upload attachments under the same filename constantly, and
 * a manifest keyed on names alone reports that nothing happened.
 */
export function compareDocuments(before: DocumentFacts[], after: DocumentFacts[]): Finding[] {
  const out: Finding[] = [];
  const byKey = new Map(before.map((d) => [d.key, d]));
  const seen = new Set<string>();

  for (const now of after) {
    seen.add(now.key);
    const was = byKey.get(now.key);
    if (!was) {
      out.push({
        scope: "documents",
        subject: now.name,
        kind: "added",
        impact: "material",
        before: null,
        after: now.contentHash ?? "new file",
        note: "A document the record has never seen. Nothing extracted so far includes it.",
      });
      continue;
    }
    if (!now.readable) {
      out.push({
        scope: "documents",
        subject: now.name,
        kind: "unreadable",
        impact: "material",
        before: was.contentHash,
        after: null,
        note: "The file could not be opened on this run, so its contents are unconfirmed rather than unchanged.",
      });
      continue;
    }
    /*
     * Unknown hashes on both sides do not make a match.
     *
     * Two nulls compare equal in JavaScript and mean "nobody hashed either
     * one", which is the absence of evidence rather than evidence of sameness.
     * Treating that as unchanged is how a re-check reports a clean result on
     * a document nothing has actually compared.
     */
    if (was.contentHash == null || now.contentHash == null) {
      out.push({
        scope: "documents",
        subject: now.name,
        kind: "unreadable",
        impact: "material",
        before: was.contentHash,
        after: now.contentHash,
        note: "No content hash on one side, so this file has not actually been compared.",
      });
      continue;
    }
    if (was.contentHash !== now.contentHash) {
      out.push({
        scope: "documents",
        subject: now.name,
        kind: "changed",
        impact: "material",
        before: was.contentHash,
        after: now.contentHash,
        note:
          was.pageCount != null && now.pageCount != null && was.pageCount !== now.pageCount
            ? `The file changed and its length moved from ${was.pageCount} to ${now.pageCount} pages.`
            : "Same filename, different contents. Everything read out of it is from the old version.",
      });
      continue;
    }
    out.push({
      scope: "documents",
      subject: now.name,
      kind: "unchanged",
      impact: "safe_metadata",
      before: was.contentHash,
      after: now.contentHash,
    });
  }

  for (const was of before) {
    if (seen.has(was.key)) continue;
    out.push({
      scope: "documents",
      subject: was.name,
      kind: "removed",
      impact: "material",
      before: was.contentHash,
      after: null,
      note: "The source no longer lists this document. It stays in history, labelled as superseded rather than deleted.",
    });
  }

  return out;
}

export interface RequirementFacts {
  /** Stable slug where the record has one, else the normalised title. */
  id: string;
  title: string;
  mandatory: boolean;
  /** Where it was read, so the claim can be checked. */
  citation?: string | null;
}

/**
 * Requirements, compared.
 *
 * A requirement that changed from optional to mandatory is a change even when
 * the words are identical, and it is the change most likely to lose a bid: the
 * package is assembled from what is mandatory, so a silently promoted item is
 * one that never gets collected.
 */
export function compareRequirements(
  before: RequirementFacts[],
  after: RequirementFacts[],
  scope: VerificationScope = "requirements_and_deadlines"
): Finding[] {
  const out: Finding[] = [];
  const byId = new Map(before.map((r) => [r.id, r]));
  const seen = new Set<string>();

  for (const now of after) {
    seen.add(now.id);
    const was = byId.get(now.id);
    if (!was) {
      out.push({
        scope,
        subject: now.title,
        kind: "added",
        impact: now.mandatory ? "blocking" : "material",
        before: null,
        after: now.mandatory ? "Mandatory" : "Optional",
        citation: now.citation ?? null,
        note: now.mandatory
          ? "A mandatory item the package does not currently include."
          : null,
      });
      continue;
    }
    if (was.mandatory !== now.mandatory) {
      out.push({
        scope,
        subject: now.title,
        kind: "changed",
        impact: now.mandatory ? "blocking" : "material",
        before: was.mandatory ? "Mandatory" : "Optional",
        after: now.mandatory ? "Mandatory" : "Optional",
        citation: now.citation ?? null,
        note: now.mandatory
          ? "This became mandatory. The package is assembled from what is mandatory, so it was not being collected."
          : "This is no longer mandatory. It stays in the package unless somebody removes it.",
      });
      continue;
    }
    if (!sameText(was.title, now.title)) {
      out.push({
        scope,
        subject: now.title,
        kind: "changed",
        impact: "material",
        before: was.title,
        after: now.title,
        citation: now.citation ?? null,
      });
      continue;
    }
    out.push({
      scope,
      subject: now.title,
      kind: "unchanged",
      impact: "safe_metadata",
      before: was.title,
      after: now.title,
      citation: now.citation ?? null,
    });
  }

  for (const was of before) {
    if (seen.has(was.id)) continue;
    out.push({
      scope,
      subject: was.title,
      kind: "removed",
      impact: was.mandatory ? "material" : "safe_metadata",
      before: was.mandatory ? "Mandatory" : "Optional",
      after: null,
      note: "The independent read did not find this. It is kept and flagged rather than dropped.",
    });
  }

  return out;
}

/**
 * Trades, compared.
 *
 * Matched on the normalised name, because the two readings are two pieces of
 * free text describing the same work and an exact match would report a change
 * every time the wording moved.
 */
export function compareTrades(before: string[], after: string[]): Finding[] {
  const out: Finding[] = [];
  const norm = (t: string) => normalizeText(t).replace(/[^a-z0-9 ]/g, "").trim();
  const wasByKey = new Map(before.map((t) => [norm(t), t]));
  const nowByKey = new Map(after.map((t) => [norm(t), t]));

  for (const [key, trade] of nowByKey) {
    if (wasByKey.has(key)) {
      out.push({
        scope: "trade_scopes",
        subject: trade,
        kind: "unchanged",
        impact: "safe_metadata",
        before: wasByKey.get(key) ?? trade,
        after: trade,
      });
      continue;
    }
    out.push({
      scope: "trade_scopes",
      subject: `Required trade: ${trade}`,
      kind: "added",
      impact: "blocking",
      before: null,
      after: trade,
      note: "Nobody has been asked to price this. It has no coverage and no quote.",
    });
  }

  for (const [key, trade] of wasByKey) {
    if (nowByKey.has(key)) continue;
    out.push({
      scope: "trade_scopes",
      subject: `Required trade: ${trade}`,
      kind: "removed",
      impact: "material",
      before: trade,
      after: null,
      note: "Subcontractors were asked to price this and it may no longer be in scope. Do not chase it further until somebody confirms.",
    });
  }

  return out;
}

/**
 * Where two independent readings of the same document disagree.
 *
 * This is the one finding a re-check cannot resolve on its own, and the
 * temptation is to prefer the newer reading because it is newer. That is not a
 * reason: both readings came from the same kind of process on the same
 * document, and the second one being more recent makes it more current, not
 * more correct. So the disagreement is reported with both sides intact and a
 * person decides.
 */
export function conflictsBetween(
  ours: RequirementFacts[],
  independent: RequirementFacts[]
): Finding[] {
  const out: Finding[] = [];
  const byId = new Map(independent.map((r) => [r.id, r]));
  for (const mine of ours) {
    const theirs = byId.get(mine.id);
    if (!theirs) continue;
    if (mine.mandatory === theirs.mandatory) continue;
    out.push({
      scope: "requirements_and_deadlines",
      subject: mine.title,
      kind: "conflict",
      impact: "blocking",
      before: mine.mandatory ? "Mandatory on file" : "Optional on file",
      after: theirs.mandatory ? "Read as mandatory" : "Read as optional",
      citation: theirs.citation ?? mine.citation ?? null,
      note: "Two readings of the same document disagree. The newer one is more current, not more correct.",
    });
  }
  return out;
}
