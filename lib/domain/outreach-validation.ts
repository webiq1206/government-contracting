/**
 * The last check before a quote request leaves the building.
 *
 * Two different questions, deliberately in one file because they share a
 * failure mode: is this TEMPLATE well formed (asked while editing, and again
 * before saving or test-sending), and is this rendered EMAIL fit to send
 * (asked once, immediately before handing bytes to Gmail).
 *
 * The shared failure mode is that a broken outreach email does not look
 * broken. renderTemplate masks an unresolved token and repairs the sentence
 * around it, which is the right behaviour for a missing phone number and
 * exactly the wrong behaviour for a missing quote deadline: the email simply
 * stops asking for a date, reads perfectly, and produces a subcontractor who
 * replies whenever. Nobody reports it, because nothing appears wrong.
 *
 * So the checks here are mechanical and run on the final assembled text rather
 * than on intentions. If a `{{token}}` survived, if a required value is blank,
 * if the word "undefined" is sitting in the body, if the quote deadline is not
 * earlier than the bid deadline, this refuses and says which.
 *
 * Pure.
 */

import { OUTREACH_VARS, unknownVars, type UnknownVar } from "./outreach-vars";

export interface TemplateProblem {
  kind: "unknown_variable" | "empty_body" | "deadline_confusion";
  message: string;
  /** Set for unknown_variable when a live replacement exists. */
  useInstead?: string | null;
}

/**
 * Whether a template body may be saved, published, previewed or test-sent.
 *
 * Blocking on save rather than warning on send is the point. A template with
 * a bad variable in it is a defect that will reach a real subcontractor at
 * 3am when the follow-up scheduler runs, and by then nobody is watching.
 */
export function validateTemplate(input: {
  body: string;
  subject?: string | null;
}): TemplateProblem[] {
  const problems: TemplateProblem[] = [];
  const body = input.body ?? "";

  if (!body.trim()) {
    problems.push({ kind: "empty_body", message: "The template body is empty." });
    return problems;
  }

  const bad: UnknownVar[] = [
    ...unknownVars(body),
    ...unknownVars(input.subject ?? ""),
  ];
  const seen = new Set<string>();
  for (const u of bad) {
    if (seen.has(u.key)) continue;
    seen.add(u.key);
    problems.push({
      kind: "unknown_variable",
      message: u.message,
      useInstead: u.useInstead,
    });
  }

  /*
   * The specific mistake this product shipped for months: telling a
   * subcontractor to reply by the date OUR bid is due. It reads like a
   * deadline, so nobody questions it, and the quote arrives with no time left
   * to do anything with it.
   */
  const replyByDeadline =
    /\b(reply|respond|quote|price|get back|send)\b[^.!?\n]{0,80}\{\{\s*deadline\s*\}\}/i.test(
      body
    ) ||
    /\{\{\s*deadline\s*\}\}[^.!?\n]{0,40}\b(reply|respond|deadline for your|to quote)\b/i.test(
      body
    );
  if (replyByDeadline) {
    problems.push({
      kind: "deadline_confusion",
      message:
        "This asks the subcontractor to reply by {{deadline}}, which is when our bid is due to the agency. Use {{quote_due_date}}: it is calculated to leave time to review the price, chase a replacement if needed, and assemble the package.",
    });
  }

  return problems;
}

export interface SendProblem {
  kind:
    | "unresolved_token"
    | "missing_required"
    | "placeholder_text"
    | "sample_data"
    | "deadline_order"
    | "no_attachments";
  message: string;
}

/** Strings that mean a value was missing and something rendered it anyway. */
const LEAKED_VALUE_RE = /(^|[\s>(])(null|undefined|NaN|\[object Object\])([\s<).,;:]|$)/;

/**
 * Whether an assembled email may actually be sent.
 *
 * Runs on the final text, after substitution and after the generated sections
 * have been appended, because that is the only artefact that is definitely
 * what the recipient will see.
 */
export function validateOutboundEmail(input: {
  subject: string;
  body: string;
  vars: Record<string, string>;
  missingRequired: string[];
  /** Filenames actually attached to the message. */
  attachedNames: string[];
  /** Documents offered as a link because they were too large to attach. */
  linkNames?: string[];
  /** True when this opportunity has documents that ought to be included. */
  documentsExpected: boolean;
  /** ISO instants, for the ordering check. */
  quoteDueAt?: string | null;
  deadlineAt?: string | null;
  /** Sample values, so a preview's data can never be posted to a real inbox. */
  sampleValues?: Record<string, string>;
}): SendProblem[] {
  const problems: SendProblem[] = [];
  const whole = `${input.subject}\n${input.body}`;

  // A token that survived substitution is about to be read by a person.
  const leftover = whole.match(/\{\{\s*\w+\s*\}\}/g);
  if (leftover) {
    problems.push({
      kind: "unresolved_token",
      message: `The email still contains ${[...new Set(leftover)].join(", ")}, which would be sent as raw text.`,
    });
  }

  if (input.missingRequired.length) {
    const labels = input.missingRequired.map(
      (key) => OUTREACH_VARS.find((v) => v.key === key)?.label ?? key
    );
    problems.push({
      kind: "missing_required",
      message: `Missing values this email cannot do without: ${labels.join(", ")}.`,
    });
  }

  if (LEAKED_VALUE_RE.test(whole)) {
    problems.push({
      kind: "placeholder_text",
      message:
        'The email contains "null", "undefined" or similar, which means a value was missing and was written out instead of being handled.',
    });
  }

  /*
   * Preview data reaching a real inbox is a small, specific, humiliating
   * failure: the editor's sample values are realistic on purpose, so nobody
   * notices "W912DR-26-R-0042" is fictional until the subcontractor asks about
   * a solicitation that does not exist.
   */
  for (const [key, sample] of Object.entries(input.sampleValues ?? {})) {
    if (!sample.trim() || sample.length < 8) continue;
    if (whole.includes(sample) && input.vars[key] !== sample) {
      problems.push({
        kind: "sample_data",
        message: `The email contains the editor's example value for ${key}, not a real one.`,
      });
      break;
    }
  }

  // The invariant, checked once more on the way out: their date is before ours.
  if (input.quoteDueAt && input.deadlineAt) {
    const q = new Date(input.quoteDueAt).getTime();
    const d = new Date(input.deadlineAt).getTime();
    if (Number.isFinite(q) && Number.isFinite(d) && q >= d) {
      problems.push({
        kind: "deadline_order",
        message:
          "The quote deadline is not earlier than our bid deadline, so this email asks for a price that would arrive too late to use.",
      });
    }
  }

  if (
    input.documentsExpected &&
    input.attachedNames.length === 0 &&
    (input.linkNames ?? []).length === 0
  ) {
    problems.push({
      kind: "no_attachments",
      message:
        "This solicitation has documents but none are attached or linked, so the subcontractor would be pricing blind.",
    });
  }

  return problems;
}

/** One line per problem, for an agent log or an operator-facing banner. */
export function describeProblems(
  problems: { message: string }[]
): string {
  return problems.map((p) => p.message).join(" ");
}
