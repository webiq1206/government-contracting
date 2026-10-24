import { z } from "zod";
import { resolveCitation } from "./document-inventory";
import { sourceEvidenceMatches, verifiedSourcePage } from "./source-evidence";

/** Extraction supplies claims; only grounding below may mark their evidence verified. */
export const RequirementApplicabilitySchema = z.object({
  requirement: z.string(),
  source: z.enum(["qualifications", "special_requirements", "submission"]),
  applies_to: z.enum(["prime", "subcontractor", "shared", "unknown"]).catch("unknown"),
  trades: z.array(z.string()).default([]),
  all_trades: z.boolean().default(false),
  mandatory: z.boolean(),
  condition: z.string().optional(),
  source_document: z.string().optional(),
  source_page: z.number().optional(),
  source_quote: z.string(),
});

export type RequirementApplicability = z.infer<typeof RequirementApplicabilitySchema> & {
  source_document_id?: string;
  evidence_verified?: boolean;
};

export interface ApplicabilityDocument {
  id: string;
  name: string;
  text: string;
  pageCount?: number | null;
  pageTexts?: string[];
}

/** No new provider call. Reuse the exact source inventory read for this analysis. */
export function groundRequirementApplicability(
  records: readonly RequirementApplicability[],
  documents: readonly ApplicabilityDocument[],
  notice: string,
): RequirementApplicability[] {
  return records.map(record => {
    const cite = resolveCitation(record.source_document, record.source_page,
      documents.map(d => ({ id: d.id, name: d.name, pageCount: d.pageCount ?? null })));
    const doc = documents.find(d => d.id === cite.documentId);
    const page = verifiedSourcePage(doc?.pageTexts, record.source_quote, cite.page);
    const grounded = doc
      ? page != null || (cite.page == null && !cite.problem && sourceEvidenceMatches(doc.text, record.source_quote))
      : !record.source_document && record.source_page == null && sourceEvidenceMatches(notice, record.source_quote);
    return {
      ...record,
      source_document_id: doc?.id,
      source_page: page,
      // A citation to a real sentence does not support an unrelated paraphrase.
      // The requirement must itself be an excerpt, not an eligibility inference.
      evidence_verified: grounded && normalize(record.requirement).length >= 12 &&
        sourceEvidenceMatches(record.source_quote, record.requirement),
    };
  });
}

const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
const PRIME = /\b(prime(?: contractor)?|offeror|bidder)\b/i;
const SUB = /\b(subcontractors?|subcontract|all trades|every trade|each trade)\b/i;
const ALL = /\b(?:all|every|each)\s+(?:subcontractors?|trades?)\b/i;
const CONDITIONAL = /\b(if|unless|when|provided that|subject to|benefit|preference|similarly situated|except|excluding|other than|not)\b/i;
const REQUIRED = /\b(mandatory|required|must|shall|non-?negotiable)\b/i;

function namesScopedTrade(text: string, trade: string): boolean {
  const escaped = normalize(trade).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Boolean(escaped) && new RegExp(`\\b${escaped}\\s+(?:trade|subcontractors?|subcontract|package)\\b`, "i").test(text);
}

export type ApplicabilityDecision =
  | { kind: "include"; mandatory: boolean }
  | { kind: "prime"; mandatory: boolean }
  | { kind: "other_trade" }
  | { kind: "review"; reason: string };

/** Unknown is a hold, never a credential requirement or an eligibility assurance. */
export function decideRequirementApplicability(input: {
  text: string;
  source: RequirementApplicability["source"];
  trade: string;
  records?: readonly RequirementApplicability[] | null;
}): ApplicabilityDecision {
  const review = (reason: string): ApplicabilityDecision => ({ kind: "review", reason });
  const matches = (input.records ?? []).filter(r => r.source === input.source &&
    normalize(r.requirement) === normalize(input.text));
  if (matches.length !== 1) return review("Confirm who must satisfy this requirement using the governing source.");
  const r = matches[0];
  if (!r.evidence_verified) return review("Verify the requirement's exact source before assigning it to a subcontractor.");
  if (r.condition?.trim() || CONDITIONAL.test(r.source_quote)) {
    return review("Confirm the applicable package or conditional restriction; do not infer eligibility.");
  }
  if (r.mandatory !== REQUIRED.test(r.requirement)) {
    return review("Confirm whether this sourced obligation is mandatory; do not infer it from its category.");
  }
  if (r.applies_to === "prime") {
    return PRIME.test(r.requirement) && !SUB.test(r.requirement)
      ? { kind: "prime", mandatory: r.mandatory }
      : review("The cited wording does not establish an exclusively prime obligation.");
  }
  if (r.applies_to !== "subcontractor" && r.applies_to !== "shared") {
    return review("Requirement applicability is unresolved.");
  }
  if (!SUB.test(r.requirement) || (r.applies_to === "subcontractor" && PRIME.test(r.requirement))) {
    return review("The cited wording does not establish this subcontractor's obligation.");
  }
  if (r.all_trades) {
    return ALL.test(r.requirement)
      ? { kind: "include", mandatory: r.mandatory }
      : review("The source does not explicitly apply this condition to every subcontractor or trade.");
  }
  const trade = normalize(input.trade);
  if (!trade || !r.trades.length || r.trades.some(t => !normalize(t) ||
      !namesScopedTrade(r.requirement, t))) {
    return review("Confirm the trade or package to which this sourced requirement applies.");
  }
  return r.trades.some(t => normalize(t) === trade)
    ? { kind: "include", mandatory: r.mandatory }
    : { kind: "other_trade" };
}

/** Prime duties must not enter scope merely because they also say 'provide'. */
export function namesPrimeDuty(text: string): boolean { return PRIME.test(text); }
