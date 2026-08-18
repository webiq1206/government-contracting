/**
 * Matching a required official form to the actual blank form in the
 * solicitation package.
 *
 * When the solicitation mandates a specific government form, the operator has
 * to sign THAT form, not a generated worksheet that looks like it. So the
 * builder tries to find the real file among the attachments and point them at
 * it. The original matcher was `filename.includes(formId)` after stripping
 * punctuation, which is wrong in both directions:
 *
 *   - "SF 30" matched "SF3000_Wage_Determination.pdf", because "sf30" is a
 *     prefix of "sf3000". The operator is told to sign a wage determination.
 *   - "SF-1449" matched "SF1449_Instructions_DO_NOT_SUBMIT.pdf", so the form
 *     the package points at is the one the agency explicitly says not to
 *     return.
 *   - "SF-1449" did NOT match "Standard Form 1449.pdf", the actual form,
 *     because the words are spelled out.
 *
 * Pure and tested: this decides which document a person is told to sign.
 */

export interface FormCandidate {
  name: string;
  path?: string | null;
}

/** Files an agency attaches ABOUT a form, which must never be mistaken for it. */
const NOT_THE_FORM =
  /\b(instructions?|instructional|guidance|how\s*to|sample|example|specimen|completed\s*copy|do\s*not\s*submit|for\s*reference|reference\s*only|read\s*me|cover\s*sheet\s*only)\b/;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "for", "to", "form", "forms", "the",
  "gov", "government", "agency", "official", "please", "pdf", "docx", "doc",
  "xlsx", "xls", "attachment", "attach", "copy", "blank", "fillable",
]);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A standard-form identifier as family + number, e.g. "SF-1449" and
 * "Standard Form 1449" both parse to {family:"sf", number:"1449"}.
 */
export function parseFormNumber(
  formId: string
): { family: string; number: string } | null {
  const n = normalize(formId);
  const m =
    n.match(/\b(sf|of|dd|gsa|hud|va|dol|wh)\s*0*(\d{1,5})\b/) ??
    n.match(/\b(standard|optional)\s*form\s*0*(\d{1,5})\b/);
  if (!m) return null;
  const family = m[1] === "standard" ? "sf" : m[1] === "optional" ? "of" : m[1];
  return { family, number: m[2] };
}

function familyPattern(family: string): string {
  if (family === "sf") return "(?:sf|standard\\s*form)";
  if (family === "of") return "(?:of|optional\\s*form)";
  return family;
}

function significantWords(s: string): string[] {
  return [...new Set(normalize(s).split(" "))].filter(
    (w) => w.length > 1 && !STOPWORDS.has(w)
  );
}

/**
 * Find the attachment that IS the required form. Returns null when nothing is
 * a confident match, which is the right answer: the operator then works from
 * the solicitation itself rather than from a file we guessed at.
 */
export function matchOfficialForm<T extends FormCandidate>(
  formId: string | null | undefined,
  files: T[]
): T | null {
  const id = (formId ?? "").trim();
  if (!id) return null;

  const usable = files.filter((f) => f.path && f.name);
  const parsed = parseFormNumber(id);

  const scored: { file: T; score: number }[] = [];
  for (const f of usable) {
    const name = normalize(f.name);
    if (NOT_THE_FORM.test(name)) continue;

    if (parsed) {
      // The trailing boundary is the whole point: "sf 30" must not match
      // "sf3000". \b after the digits refuses the longer number.
      const re = new RegExp(
        `\\b${familyPattern(parsed.family)}\\s*0*${parsed.number}\\b`
      );
      if (re.test(name)) {
        scored.push({ file: f, score: 100 - name.length / 1000 });
      }
      continue;
    }

    // No form number (e.g. "agency pricing worksheet Attachment 3"): match on
    // the words instead, and require most of them, not just one.
    const want = significantWords(id);
    if (want.length === 0) continue;
    const have = new Set(normalize(f.name).split(" "));
    const hits = want.filter((w) => have.has(w)).length;
    if (hits >= 2 && hits / want.length >= 0.6) {
      scored.push({ file: f, score: hits + (want.length ? hits / want.length : 0) });
    }
  }

  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  return scored[0].file;
}
