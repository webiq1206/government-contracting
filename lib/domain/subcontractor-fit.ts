import { createHash } from "node:crypto";
import { z } from "zod";
import { resolveSubWork } from "./sub-work";

/** Search position, an address, a category or an email check is discovery, not fit. */
const proof = z.object({
  kind: z.enum(["business_website", "supplier_reply", "confirmed_call", "document"]),
  reference: z.string().trim().min(8).max(1000),
  statement: z.string().trim().min(20).max(2000),
}).strict();

export const FitReviewSchema = z.object({
  serviceArea: proof,
  capability: proof,
  affirmed: z.literal(true),
}).strict();
export type FitReview = z.infer<typeof FitReviewSchema>;

const savedFit = FitReviewSchema.extend({
  version: z.literal(1),
  contextKey: z.string().regex(/^[a-f0-9]{64}$/),
  reviewedBy: z.string().min(1),
  checkedAt: z.string().datetime(),
}).strict();

export interface FitContextInput {
  id: string;
  location_state?: string | null;
  location_text?: string | null;
  solicitation_analysis?: Record<string, unknown> | null;
  description?: string | null;
}

/** Bind the review to this firm, trade, full scope and current place of performance. */
export function fitContext(opp: FitContextInput, subcontractorId: string, trade: string | null | undefined) {
  const tidy = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  const work = resolveSubWork({ trade, analysis: opp.solicitation_analysis, description: opp.description });
  const location = [opp.location_text, opp.location_state,
    typeof opp.solicitation_analysis?.location === "string" ? opp.solicitation_analysis.location : null]
    .map(tidy).filter(Boolean).join(" | ");
  if (!tidy(trade) || !location || !work.tradeSpecific || !work.work.trim()) return null;
  return createHash("sha256").update(JSON.stringify({ opportunity: opp.id, subcontractor: subcontractorId,
    trade: tidy(trade), location, scope: tidy(work.work) })).digest("hex");
}

/** Human source review, not keyword inference. Changed or old evidence holds a new send. */
export function fitSendBlock(verification: unknown, contextKey: string | null, now = new Date()): string | null {
  if (!contextKey) return "The current trade scope and project location must be confirmed before outreach.";
  const raw = verification && typeof verification === "object"
    ? (verification as Record<string, unknown>).outreach_fit : null;
  const parsed = savedFit.safeParse(raw);
  if (!parsed.success) return "Service-area and trade-capability evidence has not been reviewed for this request. Outreach is held.";
  if (parsed.data.contextKey !== contextKey) return "The project location or trade scope changed after fit review. Review this firm's fit again before outreach.";
  const age = now.getTime() - Date.parse(parsed.data.checkedAt);
  if (!Number.isFinite(age) || age < -300_000 || age > 90 * 86_400_000) {
    return "The saved service-area and trade-capability review needs refreshing before outreach.";
  }
  return null;
}

export function reviewedFit(review: FitReview, contextKey: string, actorId: string, now = new Date()) {
  return savedFit.parse({ ...review, version: 1, contextKey, reviewedBy: actorId, checkedAt: now.toISOString() });
}
