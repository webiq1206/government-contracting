/**
 * What a feedback report may contain, and what it may never contain.
 *
 * The rule this enforces: the product decides what it attaches, and the
 * person decides whether it attaches anything at all. A form that quietly
 * ships the session, the URL with its query string, and whatever was in the
 * console is a form that eventually ships a customer's search terms or a
 * token to somebody who only wanted to say a button was confusing.
 *
 * Pure. No database, no browser.
 */

export const FEEDBACK_CATEGORIES = [
  {
    key: "bug",
    label: "Something is broken",
    hint: "It failed, hung, or did nothing when it should have done something.",
  },
  {
    key: "wrong_number",
    label: "A number looks wrong",
    hint: "A count, a total or a rate that does not match what you can see elsewhere. Say which screen and which figure.",
  },
  {
    key: "confusing",
    label: "This is confusing",
    hint: "It works and you could not tell what it meant, or what would happen if you pressed it.",
  },
  {
    key: "feature",
    label: "I want it to do something it does not",
    hint: "A report, a control or a step that is missing.",
  },
  { key: "other", label: "Something else", hint: "Anything that does not fit above." },
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]["key"];

export function isFeedbackCategory(v: string): v is FeedbackCategory {
  return FEEDBACK_CATEGORIES.some((c) => c.key === v);
}

export function categoryLabel(key: string): string {
  return FEEDBACK_CATEGORIES.find((c) => c.key === key)?.label ?? key.replace(/_/g, " ");
}

/** Long enough to act on. Short enough that nobody pastes a database into it. */
export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 4000;

export function messageProblem(message: string): string | null {
  const t = message.trim();
  if (t.length === 0) return "Say what happened. Nobody can act on an empty report.";
  if (t.length < MESSAGE_MIN) {
    return "A few more words, please. A report has to say enough to be acted on.";
  }
  if (t.length > MESSAGE_MAX) {
    return `That is longer than ${MESSAGE_MAX} characters. Trim it to the part somebody has to read.`;
  }
  return null;
}

/**
 * The path, with everything after it removed.
 *
 * Which screen somebody was on is the useful half. A query string is where
 * the search terms, the filters, and on some routes a token live, and none of
 * that is any of this feature's business.
 */
export function safePage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let path = trimmed;
  // Accept a full URL or a bare path, and keep only the path either way.
  try {
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
  } catch {
    return null;
  }
  path = path.split("?")[0].split("#")[0];
  if (!path.startsWith("/")) return null;
  return path.slice(0, 200);
}

/** What the browser is, in a form somebody can act on. */
export function safeBrowser(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const ua = userAgent.trim().slice(0, 400);
  return ua.length > 0 ? ua : null;
}

/**
 * The diagnostic fields this product is willing to keep, and no others.
 *
 * An allow-list rather than a deny-list, because a deny-list is a promise
 * about everything nobody has thought of yet. Anything the browser sends that
 * is not named here is dropped, which is the only version of this that is
 * still true after somebody adds a field to the client.
 */
const DIAGNOSTIC_FIELDS = [
  "viewportWidth",
  "viewportHeight",
  "screenWidth",
  "screenHeight",
  "devicePixelRatio",
  "timezone",
  "language",
  "theme",
  "reducedMotion",
] as const;

export type Diagnostics = Partial<Record<(typeof DIAGNOSTIC_FIELDS)[number], string | number | boolean>>;

/** Plain-language list of what the checkbox actually attaches. */
export const DIAGNOSTIC_SUMMARY =
  "Your screen and window size, your timezone and language, and whether you are in light or dark mode. Nothing you have typed, no record contents, and no credentials.";

export function sanitizeDiagnostics(raw: unknown): Diagnostics | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const out: Diagnostics = {};
  for (const field of DIAGNOSTIC_FIELDS) {
    const v = src[field];
    if (typeof v === "number" && Number.isFinite(v)) out[field] = v;
    else if (typeof v === "boolean") out[field] = v;
    else if (typeof v === "string" && v.length > 0) out[field] = v.slice(0, 80);
  }
  return Object.keys(out).length > 0 ? out : null;
}
