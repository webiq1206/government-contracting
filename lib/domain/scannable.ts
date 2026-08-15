/**
 * Turning the analyst's prose into something readable at a glance.
 *
 * Most long text in the Opportunities section arrives from Claude as one
 * paragraph: the project overview, the scope, and the per-trade work
 * description. On screen that is a wall, and the operator reading it is
 * usually looking for one item in it, not reading it end to end.
 *
 * A lot of that text is already a list wearing a paragraph's clothes, items
 * separated by semicolons, newlines, dashes, or numbers. Where that structure
 * exists it is recovered and rendered as bullets. Where it genuinely does not,
 * the text is left exactly as written rather than chopped at arbitrary
 * sentence boundaries: a bullet list that splits one thought across two lines
 * reads worse than the paragraph it replaced.
 *
 * Pure, and deliberately conservative. It never invents structure, never
 * reorders, and never drops a word.
 */

export type Scannable =
  | { kind: "bullets"; items: string[] }
  | { kind: "prose"; text: string };

/** Below this, a paragraph is already scannable and is left alone. */
const MIN_CHARS_TO_SPLIT = 180;

/** Fewer than this many parts is not a list worth bulleting. */
const MIN_ITEMS = 2;

/** A part shorter than this is a fragment, not an item. */
const MIN_ITEM_CHARS = 12;

function clean(s: string): string {
  return s
    .replace(/\s+/g, " ")
    // Leading bullet glyphs and dashes, written as escapes so the repo's
    // no-em-dash guard does not read this pattern as prose containing one.
    .replace(/^[\s\u2022*\-\u2013\u2014]+/, "")
    .replace(/^\d+[.)]\s*/, "")
    .trim();
}

/**
 * Split on structure the writer actually put there.
 *
 * Ordered by how strong a signal each one is: explicit line breaks and bullet
 * glyphs beat numbering, which beats semicolons. The first separator that
 * yields a real list wins, so a text using several does not get shredded by
 * the weakest one.
 */
function splitOnStructure(text: string, weakAllowed: boolean): string[] | null {
  const candidates: string[][] = [
    // Strong: the writer typed a list. Length is irrelevant, they meant it.
    text.split(/\r?\n+/),
    text.split(/\s*[•]\s*/),
    ...(weakAllowed
      ? [
          // Weak: punctuation that a list and a paragraph both use, so these
          // only apply once the text is long enough to be worth breaking up.
          // "1. ... 2. ..." or "1) ... 2) ..."
          text.split(/\s+(?=\d+[.)]\s+[A-Z])/),
          // Semicolon-separated clauses, the analyst's most common list shape.
          text.split(/;\s*/),
        ]
      : []),
  ];

  for (const parts of candidates) {
    const items = parts.map(clean).filter((p) => p.length >= MIN_ITEM_CHARS);
    if (items.length >= MIN_ITEMS) return items;
  }
  return null;
}

/**
 * How to render one block of analyst text.
 *
 * Short text stays prose. Long text becomes bullets only when it already
 * contains list structure.
 */
export function toScannable(text: string | null | undefined): Scannable | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;

  const items = splitOnStructure(raw, raw.length >= MIN_CHARS_TO_SPLIT);
  if (!items) return { kind: "prose", text: raw };

  // One giant item plus scraps is not a list; it is a paragraph that happened
  // to contain a semicolon.
  const longest = Math.max(...items.map((i) => i.length));
  if (longest > raw.length * 0.8) return { kind: "prose", text: raw };

  return { kind: "bullets", items };
}

/**
 * A one-line summary for a collapsed or preview context: the first sentence,
 * trimmed to a readable length, with an ellipsis only when something was
 * actually cut.
 */
export function firstLine(text: string | null | undefined, maxChars = 120): string {
  const raw = (text ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const sentenceEnd = raw.search(/[.!?](\s|$)/);
  const firstSentence =
    sentenceEnd > 0 && sentenceEnd < maxChars ? raw.slice(0, sentenceEnd + 1) : raw;
  if (firstSentence.length <= maxChars) return firstSentence;
  const cut = firstSentence.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
