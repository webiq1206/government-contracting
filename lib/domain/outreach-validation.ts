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
  kind: "unknown_variable" | "empty_body" | "deadline_confusion" | "sample_data";
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

  /*
   * An example from the palette, pasted into the template as literal text.
   *
   * This is the one way the editor's sample data actually reaches a
   * subcontractor. It cannot arrive through the variables: a real send builds
   * those from the opportunity's own records, and the only code that renders
   * with the samples is the preview, which draws to a screen, and the test
   * send, which is addressed to the operator. What does happen is somebody
   * copying "W912DR-26-R-0042" out of the palette into the body instead of
   * {{solicitation_number}}, and every real send afterwards quotes a
   * solicitation that does not exist.
   *
   * Caught here rather than only at send time because here is where somebody
   * can fix it. The send-side check stays as the last line of defence for
   * templates saved before this existed, but it fires inside the outreach
   * agent overnight and blocks the same email again every night, telling
   * nobody which template to edit.
   *
   * Two things keep this from becoming a nuisance, both learned from the
   * send-side version of this check refusing correct mail for a coincidence:
   *
   * The `sender` category is exempt. Those are the operator's own constants --
   * their company name and phone number -- and writing them out instead of
   * using the variable is a legitimate way to author a template. The example
   * for company_name is a real company's real name.
   *
   * Everything else is opportunity-specific by construction: a title, a
   * solicitation number, an agency, a scope, a date. Literal text from any of
   * them is wrong on the next solicitation whoever wrote it, which is what
   * makes this a property of the variable rather than a guess about the
   * author. And the match is the exact example string, so a sentence somebody
   * wrote themselves does not trip it.
   */
  const text = `${input.subject ?? ""}\n${body}`;
  for (const v of OUTREACH_VARS) {
    if (v.category === "sender") continue;
    // Each line of a multi-line example too: the palette shows those as a
    // block, and one bullet is as copyable as the whole thing.
    const candidates = [v.example, ...v.example.split("\n")]
      .map((c) => c.trim())
      .filter((c) => c.length >= 8);
    if (!candidates.some((c) => text.includes(c))) continue;
    problems.push({
      kind: "sample_data",
      // The variable goes in the message, not only in useInstead: the editor
      // renders these messages as you type and reads nothing else.
      message: `This contains the example value for ${v.label}, which is invented data from the variable list. Use {{${v.key}}} instead, or every email built from this template sends that example as fact.`,
      useInstead: `{{${v.key}}}`,
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
    | "no_attachments"
    | "trade_scope_not_ready";
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
  /** The trade this email is asking about, when it is asking about one. */
  trade?: string | null;
  /**
   * True when the scope in the email is this trade's, not the whole project's.
   *
   * resolveSubWork falls back through draft_sow, scope_plain_language,
   * project_overview and finally the notice description, and reports which one
   * it used. Every one of those describes the WHOLE project.
   */
  tradeSpecific?: boolean;
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
   *
   * The question is whether sample text is present that no real value
   * accounts for. Asking it per key -- "this sample is in the email and THIS
   * key's value is not it" -- gets the answer wrong whenever the text arrived
   * legitimately through a different variable, and every one of these samples
   * is a phrase that can. The example for `estimated_start_date` was
   * "October 1, 2026"; a solicitation whose site visit fell on that date put
   * the string into `special_conditions`, the check found it, blamed a
   * variable that was empty, and refused the send. That refusal happens
   * overnight inside the outreach agent, where nobody sees it.
   *
   * So an appearance any real value explains is not a leak, whichever
   * variable carried it.
   *
   * The inverse -- several values each EQUALLING their own example, read as
   * the preview's variable set having reached the sender -- was tried here and
   * removed. These examples are drawn from realistic procurement data, so a
   * genuine Army Corps solicitation out of Richmond matches five of them at
   * once; the integration fixture is exactly that email, and the check refused
   * to send it. Value equality cannot tell a leak from a common real value,
   * and the cost of guessing wrong is the silent overnight refusal this whole
   * comment is about. Preview data must be kept out of the sender at the
   * source, not inferred here.
   */
  const realValues = Object.values(input.vars).filter((v) => typeof v === "string" && v.trim());
  const samples = Object.entries(input.sampleValues ?? {}).filter(
    // Short samples collide with ordinary prose too readily to be evidence.
    ([, sample]) => sample.trim() && sample.length >= 8
  );

  const unexplained = samples.find(
    ([, sample]) => whole.includes(sample) && !realValues.some((v) => v.includes(sample))
  );
  if (unexplained) {
    problems.push({
      kind: "sample_data",
      message: `The email contains the editor's example value for ${unexplained[0]}, and no real value on this email accounts for it.`,
    });
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

  /*
   * A trade-specific request built from a project-wide scope.
   *
   * This produced a gap, which is a note for the operator, and the send went
   * ahead. So a roofer received a quote request describing the entire job:
   * electrical, mechanical, sitework and all. They either price work three
   * other trades are covering, which makes the number useless, or they read it
   * as sent to the wrong company and stop replying. Both lose the trade, and
   * the second loses the relationship.
   *
   * Only when a trade is actually named. A general request that names no trade
   * is legitimately about the whole project and has nothing to be specific to.
   */
  if (input.trade && input.tradeSpecific === false) {
    problems.push({
      kind: "trade_scope_not_ready",
      message:
        `The analysis has no scope written specifically for ${input.trade}, so this email would describe the whole project instead. ` +
        `A subcontractor pricing from it would be quoting work other trades are covering.`,
    });
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
