/**
 * Overriding a warning, with your name on it.
 *
 * `force: true` was a boolean in a request body. It got a package past the
 * submit-lead-hours rule and past a package that was not marked ready, and it
 * left behind a log line saying somebody submitted. Nothing recorded which
 * warning was overridden, why, or what the person believed at the time.
 *
 * That is the difference between a decision and a bypass. A contracting
 * officer asking six weeks later why a bid went out ninety minutes before
 * close has a fair question, and "somebody passed force" is not an answer.
 *
 * Hard blockers are not overridable at all and never reach this file: a
 * missing mandatory form is not a judgement call. This is only for the
 * warnings, where a person genuinely may know something the rules do not.
 *
 * Pure.
 */

export interface OverrideRequest {
  /** The specific warning being overridden, not "the checks". */
  requirement: string;
  /** In the operator's own words. */
  reason: string;
}

export type OverrideProblem =
  | "no_requirement"
  | "no_reason"
  | "reason_too_short"
  | "reason_is_filler";

export const OVERRIDE_PROBLEM_MESSAGE: Record<OverrideProblem, string> = {
  no_requirement: "Say which warning you are overriding.",
  no_reason: "Say why. An override with no reason is a bypass with a timestamp.",
  reason_too_short:
    "Write a sentence somebody could act on six weeks from now. A word or two will not mean anything by then.",
  reason_is_filler:
    "That does not say anything. Write what you know that the check does not.",
};

/**
 * Below this, a reason is a keystroke rather than a sentence.
 *
 * Twenty characters is deliberately low. The point is not to make overriding
 * hard, it is to make it recorded: somebody with a genuine reason types it in
 * a few seconds, and somebody trying to get past a dialog has to at least
 * decide what to claim.
 */
const MIN_REASON_CHARS = 20;

/**
 * Words that fill a box without saying anything.
 *
 * Not a spam filter and not exhaustive: it catches the reflex answers, which
 * is what it is for. Anybody determined to write nonsense will, and the record
 * will show they did, which is the point.
 */
const FILLER_WORDS = /^(ok(ay)?|fine|n\/?a|none|no reason|test|asdf|yes|do it|approved?|urgent)\b/i;
/*
 * Punctuation-only answers need their own test: a trailing `\b` cannot match
 * after a full stop, so folding these into the word list above silently made
 * "..." fall through to the length check and report the wrong problem.
 */
const FILLER_PUNCTUATION = /^[^a-z0-9]+$/i;

export function overrideProblem(req: OverrideRequest): OverrideProblem | null {
  if (!req.requirement?.trim()) return "no_requirement";
  const reason = req.reason?.trim() ?? "";
  if (!reason) return "no_reason";
  if (FILLER_PUNCTUATION.test(reason) || FILLER_WORDS.test(reason)) return "reason_is_filler";
  if (reason.length < MIN_REASON_CHARS) return "reason_too_short";
  return null;
}

export function mayOverride(req: OverrideRequest): boolean {
  return overrideProblem(req) === null;
}

/**
 * How serious this override is, which decides whether one signature is enough.
 *
 * Deliberately coarse. The distinction that matters is between "we are cutting
 * it fine" and "we are sending something the checks say is incomplete", and a
 * finer scale would invite arguing about the boundary rather than about the
 * decision.
 */
export type OverrideRisk = "notable" | "serious";

export function overrideRisk(requirement: string): OverrideRisk {
  const r = requirement.toLowerCase();
  // Timing is a judgement about the clock. Completeness is a judgement about
  // whether the bid is responsive, and getting that wrong loses the bid
  // outright rather than making it tight.
  if (/deadline|lead|hours|timing/.test(r)) return "notable";
  return "serious";
}

/** One line for the audit trail, written so it still reads in six weeks. */
export function overrideSummary(
  req: OverrideRequest,
  actor: string,
  at: Date
): string {
  return `${actor} overrode "${req.requirement}" on ${at.toISOString()}: ${req.reason.trim()}`;
}
