/**
 * Where each submission requirement has got to, and who says so.
 *
 * The checklist could say what the solicitation asks for and could not say
 * whether anybody had done it. Everything downstream inherited that: the
 * readiness figure counted documents rather than obligations, and an operator
 * looking at forty extracted requirements had no way to record that eleven
 * were handled last Tuesday.
 *
 * The rule this module exists to enforce is the one the brief states outright:
 * never mark an unverified extracted requirement complete automatically when a
 * human signature, credential, upload, or portal action is required. Automation
 * can tell you a form is attached. It cannot tell you somebody signed it, holds
 * the licence, or logged into the portal and pressed submit, and a checklist
 * that ticks those on its own is a checklist that gets a bid thrown out while
 * reading as complete.
 */

export const REQUIREMENT_STATES = [
  /** Nobody has touched it. The honest default. */
  "not_started",
  "in_progress",
  /**
   * The requirement itself is unclear or two sources disagree about it.
   *
   * Its own state rather than a flavour of blocked, because the action is
   * different: a blocked item needs work, and this one needs somebody to ask
   * the contracting officer a question.
   */
  "needs_clarification",
  /** Something outside this requirement is stopping it. */
  "blocked",
  "done",
  /**
   * Read from the solicitation and found not to apply here.
   *
   * Kept rather than deleted, because "we considered it and it does not apply"
   * and "nobody ever looked at it" are different states and the second one is
   * what an empty list means.
   */
  "not_applicable",
] as const;

export type RequirementState = (typeof REQUIREMENT_STATES)[number];

export const REQUIREMENT_STATE_LABEL: Record<RequirementState, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  needs_clarification: "Needs clarification",
  blocked: "Blocked",
  done: "Done",
  not_applicable: "Does not apply",
};

/**
 * Fails to not_started.
 *
 * An unrecognised state must never become `done`. Getting it wrong in that
 * direction is a requirement nobody does; the other direction is a bid
 * submitted without it.
 */
export function parseRequirementState(raw: unknown): RequirementState {
  return (REQUIREMENT_STATES as readonly string[]).includes(String(raw))
    ? (raw as RequirementState)
    : "not_started";
}

/**
 * What proving this requirement actually takes.
 *
 * The four that need a person are exactly the four the brief names. `none`
 * means the platform can establish it from what it holds: a generated document
 * is attached, a field is filled, a count is met.
 */
export const VERIFICATION_KINDS = [
  "none",
  "signature",
  "credential",
  "upload",
  "portal_action",
] as const;

export type VerificationKind = (typeof VERIFICATION_KINDS)[number];

export const VERIFICATION_LABEL: Record<VerificationKind, string> = {
  none: "The platform can check this",
  signature: "Needs a signature",
  credential: "Needs a credential we hold",
  upload: "Needs a document uploaded",
  portal_action: "Needs somebody to act in the portal",
};

/**
 * Fails to `upload`, not to `none`.
 *
 * An unrecognised verification kind must not be read as "nothing to prove".
 * The safe direction here is to ask a person for something that turns out to
 * be unnecessary; the unsafe one is to stop asking.
 */
export function parseVerification(raw: unknown): VerificationKind {
  return (VERIFICATION_KINDS as readonly string[]).includes(String(raw))
    ? (raw as VerificationKind)
    : "upload";
}

export function needsAPerson(kind: VerificationKind): boolean {
  return kind !== "none";
}

export interface AutoCompleteInput {
  verification: VerificationKind;
  /**
   * Whether a person has confirmed the requirement was read correctly.
   *
   * An extracted requirement is a model's reading of a document. Acting on it
   * is fine; closing it out automatically on the strength of the same reading
   * that produced it is a system marking its own homework.
   */
  humanVerified: boolean;
}

export interface AutoCompleteVerdict {
  allowed: boolean;
  /** Why not, in the words the row will show. */
  reason?: string;
}

/**
 * May automation close this requirement out?
 *
 * Two ways to be refused, and they are different refusals.
 *
 * The first is the brief's rule: a signature, a credential, an upload or a
 * portal action is something only a person can attest to. Automation can see
 * that a file exists and cannot see that the right person signed it.
 *
 * The second is subtler and matters as much: a requirement nobody has verified
 * is a model's reading of a document, and completing it automatically means
 * the same reading both created the obligation and discharged it.
 */
export function canAutoComplete(i: AutoCompleteInput): AutoCompleteVerdict {
  if (needsAPerson(i.verification)) {
    return {
      allowed: false,
      reason: `${VERIFICATION_LABEL[i.verification]}, so a person has to close this one.`,
    };
  }
  if (!i.humanVerified) {
    return {
      allowed: false,
      reason:
        "This was read out of the solicitation and nobody has confirmed the reading, so it cannot close itself.",
    };
  }
  return { allowed: true };
}

export interface StateChangeInput {
  from: RequirementState;
  to: RequirementState;
  by: "person" | "automation";
  verification: VerificationKind;
  humanVerified: boolean;
}

export interface StateChangeVerdict {
  ok: boolean;
  reason?: string;
}

/**
 * Whether a state change is allowed, and by whom.
 *
 * A person may move a requirement anywhere: they can see the document. The
 * only refusals here are automation's, and they are the rule above applied at
 * the moment it matters rather than at the moment somebody reads the docs.
 */
export function checkStateChange(i: StateChangeInput): StateChangeVerdict {
  if (i.from === i.to) return { ok: true };
  if (i.by === "person") return { ok: true };
  if (i.to === "done") {
    const verdict = canAutoComplete({
      verification: i.verification,
      humanVerified: i.humanVerified,
    });
    return verdict.allowed ? { ok: true } : { ok: false, reason: verdict.reason };
  }
  if (i.to === "not_applicable") {
    return {
      ok: false,
      // Deciding a requirement does not apply is a judgement about this
      // company and this solicitation, and getting it wrong looks identical
      // to getting it right until the bid is rejected.
      reason: "Only a person can decide a requirement does not apply.",
    };
  }
  return { ok: true };
}

/**
 * Which requirements belong in the Needs clarification group.
 *
 * Its own group rather than a filter, because these are the only items whose
 * next action is a question to somebody outside this company, and a deadline
 * makes that urgent in a way a normal blocker is not.
 */
export function needsClarification<T extends { state: RequirementState }>(items: T[]): T[] {
  return items.filter((r) => r.state === "needs_clarification");
}

/**
 * Progress that counts obligations rather than documents.
 *
 * `not_applicable` counts as settled, because it is a decision somebody made.
 * Nothing else does: an in-progress requirement is not half a requirement, and
 * a percentage that says so is a percentage that reads as reassurance.
 */
export function requirementProgress(items: { state: RequirementState }[]): {
  settled: number;
  total: number;
  percent: number | null;
} {
  const total = items.length;
  if (total === 0) {
    // Not zero percent. Nothing extracted is not "no progress", it is no
    // checklist, and the two must not render the same way.
    return { settled: 0, total: 0, percent: null };
  }
  const settled = items.filter((r) => r.state === "done" || r.state === "not_applicable").length;
  return { settled, total, percent: Math.round((settled / total) * 100) };
}

/**
 * What the checklist assumes it takes to prove a requirement, before anybody
 * has said.
 *
 * Read off the extraction rather than guessed at: a requirement the analysis
 * marked signature_required needs a signature, and one the platform generates
 * itself is one the platform can check. Everything else defaults to needing a
 * document, which is the conservative reading and the same direction
 * `parseVerification` fails in.
 */
export interface RequirementFacts {
  needsSignature?: boolean;
  /** True when the platform produces this item rather than the operator. */
  producedByPlatform: boolean;
}

export function defaultVerification(r: RequirementFacts): VerificationKind {
  if (r.needsSignature) return "signature";
  if (r.producedByPlatform) return "none";
  return "upload";
}

/**
 * How many of these need somebody outside this company to answer a question.
 *
 * Counted rather than inferred from a filter, because the number is what
 * belongs next to a deadline: three items waiting on the contracting officer
 * eleven days out is a different morning from three items waiting on him
 * eleven hours out.
 */
export function clarificationCount(items: { state: RequirementState }[]): number {
  return items.filter((r) => r.state === "needs_clarification").length;
}

/**
 * A requirement's due date against the bid's.
 *
 * Its own date is not the bid's: a licence that has to be current at award and
 * a form due with the proposal are different deadlines, and the earlier one is
 * not always the obvious one. Returns null when there is nothing to say, which
 * is not the same as "on track" and must not render as it.
 */
export function requirementDueState(
  dueAt: Date | null,
  now: Date
): "overdue" | "due_soon" | "later" | null {
  if (!dueAt) return null;
  const hours = (dueAt.getTime() - now.getTime()) / 3_600_000;
  if (hours < 0) return "overdue";
  if (hours <= 48) return "due_soon";
  return "later";
}

/**
 * One requirement's tracked state, in the shape a page hands to a browser.
 *
 * Dates as ISO strings rather than Date objects: this crosses the server and
 * client boundary, and a Date that survives that trip only by accident is a
 * bug waiting for the first field somebody forgets to convert.
 */
export interface RequirementStateView {
  state: RequirementState;
  verification: VerificationKind;
  humanVerified: boolean;
  owner: { id: string; name: string } | null;
  dueAt: string | null;
  blockingReason: string | null;
  note: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  /**
   * True when nothing has ever been recorded.
   *
   * Not the same as `not_started`, which is somebody saying they have not
   * begun. This one is nobody having said anything, and a checklist that
   * renders the two identically is a checklist claiming a decision that was
   * never made.
   */
  untouched: boolean;
}

/** One line of a requirement's audit history, likewise serialised. */
export interface RequirementAudit {
  id: string;
  fromState: RequirementState | null;
  toState: RequirementState;
  actorKind: "person" | "automation";
  actorLabel: string | null;
  note: string | null;
  at: string;
}
