/**
 * Keeping the analyst's long-form fields in the shape the prompt asks for.
 *
 * The prompt now asks for one work item per line rather than paragraphs, and
 * a model mostly complies. Mostly is the problem: the same solicitation can
 * come back as a clean list one run and as "the contractor shall: - demo the
 * ductwork - install new spiral duct - balance the system" the next, all on
 * one line. Both are lists; only one of them renders as a list.
 *
 * So the shape is normalized here, on the way in, once, instead of at each of
 * the four places this text is displayed and the two where it is emailed.
 *
 * Non-destructive by rule. It moves line breaks and strips the bullet glyph
 * that a line break replaces. It never truncates, never reorders, never
 * summarizes, and never drops a word. That is what makes it safe to run over
 * output nobody has read: the worst case is text that looks exactly as it did
 * before.
 */

/** Inline markers a model uses when it means "new item" but keeps typing. */
const INLINE_MARKER = /\s+[\u2022*]\s+|\s+[-\u2013\u2014]\s+(?=[A-Z(])/g;

/** "1. " / "2) " starting a new item mid-line, only when a capital follows. */
const INLINE_NUMBER = /\s+(?=\d+[.)]\s+[A-Z])/g;

/** Enough items to be a list rather than a hyphenated aside. */
const MIN_ITEMS = 2;

/**
 * Remove the marker a line break replaces: bullet glyphs, leading dashes, and
 * "1." / "1)" numbering. Numbering is markup, not content, so it goes the same
 * way the glyph does. A digit that is part of the sentence ("14 rooftop
 * units") is untouched, since the pattern requires the dot or paren.
 */
function stripLeadingMarker(line: string): string {
  return line
    .replace(/^[\s\u2022*]+/, "")
    .replace(/^[-\u2013\u2014]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .trimEnd();
}

/**
 * Put each item on its own line, when the text is a list that was typed as a
 * paragraph. Text that is genuinely prose comes back unchanged.
 */
export function tightenProse(text: string | null | undefined): string {
  const raw = (text ?? "").replace(/\r\n/g, "\n").trim();
  if (!raw) return "";

  // Already multi-line: just tidy the markers and the blank lines.
  if (raw.includes("\n")) {
    return raw
      .split("\n")
      .map(stripLeadingMarker)
      .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1].length > 0))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  for (const marker of [INLINE_MARKER, INLINE_NUMBER]) {
    const parts = raw
      .split(marker)
      .map(stripLeadingMarker)
      .filter((p) => p.length > 0);
    if (parts.length >= MIN_ITEMS) return parts.join("\n");
  }

  return raw;
}

/** Apply to every long-form field on a parsed analysis, in place of the raw. */
export function tightenAnalysisProse<
  T extends {
    project_overview?: string;
    scope_plain_language?: string;
    draft_sow?: string;
    trade_scopes?: { trade: string; work: string }[];
  },
>(analysis: T): T {
  return {
    ...analysis,
    ...(analysis.project_overview != null
      ? { project_overview: tightenProse(analysis.project_overview) }
      : {}),
    ...(analysis.scope_plain_language != null
      ? { scope_plain_language: tightenProse(analysis.scope_plain_language) }
      : {}),
    ...(analysis.draft_sow != null ? { draft_sow: tightenProse(analysis.draft_sow) } : {}),
    ...(analysis.trade_scopes
      ? {
          trade_scopes: analysis.trade_scopes.map((ts) => ({
            ...ts,
            work: tightenProse(ts.work),
          })),
        }
      : {}),
  };
}
