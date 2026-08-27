/**
 * How much of each solicitation document reaches the analysis prompt.
 *
 * There is a fixed number of characters the prompt can carry, and a
 * solicitation can carry more text than that. Something has to be left out.
 * The only question is whether the product knows what, and says so.
 *
 * Two ways it did not:
 *
 * The attachment list was cut at forty files with `.slice(0, 40)`, and the log
 * line then reported `attachments.length` as the number processed. A notice
 * with fifty-seven attachments logged fifty-seven processed and analysed
 * forty. Amendments and Q and A responses are appended to a SAM notice AFTER
 * the base documents, so the seventeen that vanished were the ones most
 * likely to have changed the requirements.
 *
 * And the per-document share had a floor of 8,000 characters with no ceiling
 * on the total, so past thirty documents the shares summed past the budget and
 * a final `.slice()` on the joined text dropped whole documents off the end.
 * The sharing that was meant to stop tail-dropping reintroduced it at scale.
 *
 * This allocates by water-filling: every document is offered an equal share,
 * a document shorter than its share takes only what it needs, and what it
 * leaves is redistributed to the documents that are longer. That fits the most
 * text under a fixed budget, and it means a one-page wage determination cannot
 * squeeze a two-hundred-page specification.
 *
 * Pure, so the agent, the tests and the coverage report all read the same
 * arithmetic.
 */

export interface BudgetDocument {
  /** Stable identifier, so an allocation can be traced back to a file. */
  id: string;
  name: string;
  /** Characters of text extracted from this document. */
  chars: number;
}

export interface BudgetAllocation extends BudgetDocument {
  /** Characters that fit. */
  included: number;
  /** Some of the document was left out. */
  trimmed: boolean;
  /**
   * None of it fit, or so little that including it would be misleading
   * rather than useful. Never silent: this is what the coverage line counts.
   */
  omitted: boolean;
}

export interface BudgetPlan {
  allocations: BudgetAllocation[];
  totalExtracted: number;
  totalIncluded: number;
  trimmed: BudgetAllocation[];
  omitted: BudgetAllocation[];
  /** True when every document reached the prompt whole. */
  complete: boolean;
}

/**
 * Below this, an excerpt is not a sample of a document, it is the first
 * paragraph of one. Reading a requirement out of that is worse than knowing
 * the document was not read.
 */
export const MIN_USEFUL_CHARS = 2_000;

export function allocateExtractionBudget(
  docs: readonly BudgetDocument[],
  budget: number,
  minUseful: number = MIN_USEFUL_CHARS
): BudgetPlan {
  const totalExtracted = docs.reduce((a, d) => a + Math.max(0, d.chars), 0);
  const included = new Map<string, number>();

  // Water-fill: shortest first, so every document that fits entirely releases
  // its unused share to the ones that do not.
  const ascending = [...docs].sort((a, b) => a.chars - b.chars);
  let remaining = Math.max(0, budget);
  let left = ascending.length;
  for (const doc of ascending) {
    const share = left > 0 ? Math.floor(remaining / left) : 0;
    const take = Math.min(Math.max(0, doc.chars), share);
    included.set(doc.id, take);
    remaining -= take;
    left--;
  }

  const allocations: BudgetAllocation[] = docs.map((d) => {
    const chars = Math.max(0, d.chars);
    const got = included.get(d.id) ?? 0;
    // A document with no text is not omitted by the budget. It failed to
    // extract, which is a different problem with a different answer, and
    // counting it here would blame the budget for it.
    const omitted = chars > 0 && got < Math.min(chars, minUseful);
    return {
      ...d,
      chars,
      included: omitted ? 0 : got,
      trimmed: !omitted && got < chars,
      omitted,
    };
  });

  return {
    allocations,
    totalExtracted,
    totalIncluded: allocations.reduce((a, x) => a + x.included, 0),
    trimmed: allocations.filter((a) => a.trimmed),
    omitted: allocations.filter((a) => a.omitted),
    complete: allocations.every((a) => !a.trimmed && !a.omitted),
  };
}

/**
 * One line an operator can read, and the analyst can log, saying what the
 * model actually got to see.
 *
 * Deliberately not "processed N attachments". That was the old line, and it
 * counted files the code had already thrown away.
 */
export function coverageSummary(plan: BudgetPlan): string {
  const whole = plan.allocations.filter((a) => !a.trimmed && !a.omitted).length;
  const parts = [`${whole} of ${plan.allocations.length} document(s) read in full`];
  if (plan.trimmed.length > 0) {
    parts.push(`${plan.trimmed.length} shortened to fit`);
  }
  if (plan.omitted.length > 0) {
    parts.push(
      `${plan.omitted.length} left out entirely (${plan.omitted.map((o) => o.name).join(", ")})`
    );
  }
  return parts.join("; ");
}

export interface ExtractionInput {
  name: string;
  /** The text block this document contributes to the prompt. */
  context: string;
}

export interface AssembledContext {
  text: string;
  plan: BudgetPlan;
}

/**
 * Characters held back per document for the note that says a document was not
 * read. Reserved up front so the assembled text lands inside the budget rather
 * than being cut again at the end, which is what dropped whole documents off
 * the tail before.
 */
export const OMISSION_NOTE_CHARS = 260;

/**
 * Assemble the attachment text the analysis prompt carries, naming whatever
 * did not fit.
 *
 * A document left out is named in the text rather than dropped from it,
 * because a document silently absent reads exactly like a document that never
 * existed, and that is how a requirement gets invented from the portal summary
 * instead of read from the file.
 */
export function assembleAttachmentContext(
  items: readonly ExtractionInput[],
  budget: number,
  minUseful: number = MIN_USEFUL_CHARS
): AssembledContext {
  const reserved = items.length * OMISSION_NOTE_CHARS;
  const plan = allocateExtractionBudget(
    items.map((p, i) => ({ id: String(i), name: p.name, chars: p.context.length })),
    Math.max(0, budget - reserved),
    minUseful
  );
  const byIndex = new Map(plan.allocations.map((a) => [a.id, a]));
  const text = items
    .map((p, i) => {
      const a = byIndex.get(String(i));
      if (!a || a.omitted) {
        return `- ${p.name}: STORED BUT NOT READ. There was not enough room in this analysis to include it. Do NOT state or assume anything about its contents.`;
      }
      if (a.trimmed) {
        return `${p.context.slice(0, a.included)}\n[... ${p.name} continues past this point and was NOT read. Do NOT assume anything about the rest of it.]`;
      }
      return p.context;
    })
    .join("\n\n");
  return { text, plan };
}
