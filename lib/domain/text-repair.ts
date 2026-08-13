/**
 * Shared "remove a value and repair the prose around it" engine.
 *
 * Two different problems produce the same failure mode in outbound email:
 *
 *   1. A government contact is stripped from solicitation text.
 *   2. A template token has no value (no phone on file, no company name).
 *
 * In both cases the naive fix — substituting a marker or an empty string —
 * ships something embarrassing: "call me at [CONTACT REDACTED]" or
 * "call me at ." The correct behaviour is identical for both: take the value
 * out and then remove whatever prose existed only to introduce it.
 *
 * The caller masks the removed value with OMISSION and calls `repairOmissions`.
 *
 * Invariant: text containing no OMISSION is returned byte-for-byte unchanged,
 * and only lines that actually contained an OMISSION are rewritten. Clean copy
 * is never reflowed, re-punctuated, or otherwise touched.
 */

/**
 * Sentinel standing in for a removed value. Deliberately a control character:
 * it cannot appear in solicitation text or operator-authored templates, and it
 * contains no digits or periods, so masking before sentence/clause splitting
 * prevents a phone number or email from being mistaken for a sentence boundary.
 */
export const OMISSION = "\u0000";

/**
 * Clause separators. `,` `;` `|` and " or " only.
 *
 * " and " and " with " are deliberately NOT separators. "I'm Jared with
 * {{company_name}}." must collapse entirely when the company is unknown —
 * treating " with " as a separator would leave the fragment "I'm Jared."
 */
const SEPARATOR_RE = /(\s*[;|]\s*|\s*,\s*|\s+or\s+)/;

/** A surviving fragment shorter than this reads as a sentence fragment. */
const MIN_PROSE_WORDS = 4;

/** Words that clearly wanted an object; left dangling they read as broken. */
const DANGLING_TAIL_RE =
  /\b(?:at|to|with|from|on|by|for|of|in|and|or|call|email|contact|reach|phone|number|via)$/i;

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

function endsDangling(text: string): boolean {
  const stripped = text.trim().replace(/[.,;:!?]+$/, "").trim();
  return DANGLING_TAIL_RE.test(stripped);
}

/**
 * Split a line into sentences, preserving each sentence's terminal punctuation
 * and trailing whitespace so an untouched line rejoins byte-identically.
 */
function splitSentences(line: string): { body: string; tail: string }[] {
  const out: { body: string; tail: string }[] = [];
  const re = /([.!?]+)(\s*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    out.push({ body: line.slice(last, m.index), tail: m[1] + m[2] });
    last = re.lastIndex;
  }
  if (last < line.length) out.push({ body: line.slice(last), tail: "" });
  return out;
}

/** Tidy punctuation residue left behind after dropping a clause. */
function tidy(text: string): string {
  return text
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([,;:.!?])/g, "$1")
    .replace(/\|\s*\|/g, "|")
    .replace(/,\s*,/g, ",")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[\s|,;:]+/, "")
    .replace(/[\s|,;]+$/, "")
    .trim();
}

/**
 * Rebuild one sentence that contained an omission, dropping the clauses that
 * introduced the missing value. Returns "" when nothing worth sending is left.
 */
function repairSentence(body: string): string {
  // A parenthetical that exists only to carry the missing value goes wholesale,
  // so "(deadline {{deadline}})" does not become "()".
  let working = body.replace(
    new RegExp(`\\s*\\([^()]*${OMISSION}[^()]*\\)`, "g"),
    ""
  );
  if (!working.includes(OMISSION)) return tidy(working);

  const parts = working.split(SEPARATOR_RE);
  const clauses: { text: string; sep: string }[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    clauses.push({ text: parts[i] ?? "", sep: i === 0 ? "" : (parts[i - 1] ?? "") });
  }

  const survivors = clauses.filter((c) => !c.text.includes(OMISSION));
  if (survivors.length === 0) return "";

  // A pipe-delimited line is a list (a signature or identity block), not prose:
  // "BROSTCO | (800) 555-0199 | jared@..." losing its middle field is still
  // correct output. Prose held to a higher bar below.
  const isList =
    clauses.length > 1 &&
    clauses.slice(1).every((c) => /^\s*\|\s*$/.test(c.sep));

  const rebuilt = survivors
    .map((c, i) => (i === 0 ? c.text : c.sep + c.text))
    .join("");
  const cleaned = tidy(rebuilt);

  if (!isList && (countWords(cleaned) < MIN_PROSE_WORDS || endsDangling(cleaned))) {
    return "";
  }
  return cleaned;
}

/**
 * Remove every OMISSION along with the prose that introduced it.
 *
 * Lines with no omission are preserved exactly. Lines reduced to nothing are
 * dropped, and the blank lines around them collapse so the result has no
 * orphaned gaps.
 */
export function repairOmissions(text: string): string {
  if (!text.includes(OMISSION)) return text;

  const lines: string[] = [];
  for (const line of text.split("\n")) {
    // Blank lines that were always blank are paragraph structure — keep them.
    if (!line.includes(OMISSION)) {
      lines.push(line);
      continue;
    }

    const rebuilt = splitSentences(line)
      .map(({ body, tail }) => {
        if (!body.includes(OMISSION)) return body + tail;
        const kept = repairSentence(body);
        return kept ? kept + tail : "";
      })
      .join("");

    const cleaned = tidy(rebuilt);
    // A line reduced to nothing, or to punctuation alone (a lone "," left by
    // "{{co_name}},"), is dropped outright rather than left behind as a blank.
    if (/[A-Za-z0-9]/.test(cleaned)) lines.push(cleaned);
  }

  return lines
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    // Belt and braces: a sentinel must never reach a recipient.
    .split(OMISSION)
    .join("")
    .trim();
}
