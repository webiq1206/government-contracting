/**
 * What "submitted" is allowed to mean.
 *
 * The submit endpoint ran `update bids set submitted_at=now()` and that was
 * the whole ceremony. Nothing recorded how the package reached the agency,
 * when, to what address, or whether anybody on the other end acknowledged it.
 *
 * That matters because for almost every solicitation this product handles,
 * Brost Co does not submit anything. A person opens a government portal,
 * uploads the files themselves, and comes back. The button said "Submit bid
 * package", the timestamp said submitted, and the only thing that had actually
 * happened was somebody pressing a button in a different application.
 *
 * A bid recorded as submitted with no evidence is worse than one recorded as
 * ready, because the first stops anybody checking. So the states below
 * separate what the product did from what a person did from what the agency
 * confirmed, and the transitions refuse to skip the middle.
 *
 * Pure.
 */

export const SUBMISSION_STATES = [
  "package_ready",
  "approved",
  "sending",
  "sent",
  "receipt_confirmed",
  "accepted",
  "rejected",
  "withdrawn",
  "failed",
] as const;
export type SubmissionState = (typeof SUBMISSION_STATES)[number];

export const SUBMISSION_STATE_LABEL: Record<SubmissionState, string> = {
  package_ready: "Package ready",
  approved: "Approved to send",
  sending: "Sending",
  sent: "Sent",
  receipt_confirmed: "Receipt confirmed",
  accepted: "Accepted",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  failed: "Send failed",
};

/**
 * What each state actually claims, in the terms somebody would defend it in.
 *
 * Written out because the difference between "we sent it" and "they have it"
 * is the difference between a bid that counts and one that does not, and a
 * label alone does not carry that.
 */
export const SUBMISSION_STATE_MEANING: Record<SubmissionState, string> = {
  package_ready: "Everything is assembled. Nobody has sent it anywhere.",
  approved: "Cleared to go. Still not sent.",
  sending: "A connector is delivering it now.",
  sent: "It left here, or a person uploaded it, and there is evidence of that.",
  receipt_confirmed: "The agency or portal acknowledged receiving it.",
  accepted: "The agency accepted it as a responsive offer.",
  rejected: "The agency refused it. The reason is recorded.",
  withdrawn: "Pulled back on purpose before a decision.",
  failed: "The send did not complete. Nothing reached the agency.",
};

const TRANSITIONS: Record<SubmissionState, SubmissionState[]> = {
  package_ready: ["approved", "withdrawn"],
  // Straight to sent is legal because an external portal upload has no
  // "sending" phase this product can observe: the operator does it elsewhere
  // and comes back with the receipt.
  approved: ["sending", "sent", "withdrawn", "failed"],
  sending: ["sent", "failed"],
  sent: ["receipt_confirmed", "accepted", "rejected", "withdrawn", "failed"],
  receipt_confirmed: ["accepted", "rejected", "withdrawn"],
  // A rejection can be corrected and resubmitted; that is a new send, and the
  // package goes back to being something a person has to approve.
  rejected: ["package_ready", "withdrawn"],
  accepted: [],
  withdrawn: ["package_ready"],
  failed: ["package_ready", "approved", "withdrawn"],
};

export function canSubmit(from: SubmissionState, to: SubmissionState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function parseSubmissionState(v: unknown): SubmissionState {
  const s = String(v ?? "").toLowerCase().trim();
  // An unrecognised value is a package nobody has sent. Reading it as `sent`
  // would claim delivery on the strength of a typo.
  return (SUBMISSION_STATES as readonly string[]).includes(s)
    ? (s as SubmissionState)
    : "package_ready";
}

/** How the package reached, or will reach, the agency. */
export const SUBMISSION_METHODS = ["portal", "email", "connector", "mail", "hand"] as const;
export type SubmissionMethod = (typeof SUBMISSION_METHODS)[number];

export const SUBMISSION_METHOD_LABEL: Record<SubmissionMethod, string> = {
  portal: "Uploaded to a government portal",
  email: "Emailed to the contracting officer",
  connector: "Sent by a connected system",
  mail: "Posted or couriered",
  hand: "Delivered by hand",
};

/**
 * `Submit bid package` or `Mark as sent`?
 *
 * The instruction is explicit and the reason is worth keeping written down: a
 * button that says Submit, on a screen that cannot submit, tells an operator
 * the product did something it did not do. Only a connector actually sends.
 */
export function primaryActionLabel(method: SubmissionMethod | null): string {
  return method === "connector" ? "Submit bid package" : "Mark as sent";
}

export interface SentEvidence {
  method: SubmissionMethod | null;
  /** The portal name, the address, or the connector's destination. */
  destination: string | null;
  sentAt: Date | null;
  /** IANA zone. A deadline argument turns on which clock the time was read on. */
  timezone: string | null;
  confirmationNumber: string | null;
  /** A stored document: the receipt, the screenshot, the confirmation email. */
  proofDocumentId: string | null;
  /** The operator saying, in their own words, what they did. */
  attestation: string | null;
  packageHash: string | null;
}

export type EvidenceGap =
  | "method"
  | "destination"
  | "sent_at"
  | "timezone"
  | "proof"
  | "attestation"
  | "package_hash";

export const EVIDENCE_GAP_LABEL: Record<EvidenceGap, string> = {
  method: "how it was sent",
  destination: "where it was sent",
  sent_at: "the date and time it was sent",
  timezone: "the timezone that time was read in",
  proof: "a receipt, screenshot or confirmation email",
  attestation: "your confirmation of what you did",
  package_hash: "which version of the package went",
};

/**
 * What is missing before this may be called sent.
 *
 * A confirmation number is NOT required: plenty of portals do not issue one,
 * and demanding it would push operators into typing something untrue into a
 * field that is meant to be evidence. Proof is required instead, because every
 * portal produces a screen that can be captured.
 */
export function sentEvidenceGaps(e: SentEvidence): EvidenceGap[] {
  const gaps: EvidenceGap[] = [];
  if (!e.method) gaps.push("method");
  if (!e.destination?.trim()) gaps.push("destination");
  if (!e.sentAt) gaps.push("sent_at");
  if (!e.timezone?.trim()) gaps.push("timezone");
  if (!e.packageHash?.trim()) gaps.push("package_hash");
  /*
   * A connector send proves itself: the request, the response and the
   * provider's own identifier are the evidence, and asking a person to
   * photograph their screen for something they did not do by hand is
   * ceremony. Everything else needs a human to say what happened and show it.
   */
  if (e.method !== "connector") {
    if (!e.proofDocumentId) gaps.push("proof");
    if (!e.attestation?.trim()) gaps.push("attestation");
  }
  return gaps;
}

export function maySend(e: SentEvidence): boolean {
  return sentEvidenceGaps(e).length === 0;
}

/** One sentence naming everything still needed, for the button's helper text. */
export function describeGaps(gaps: readonly EvidenceGap[]): string {
  if (gaps.length === 0) return "Everything needed is recorded.";
  const names = gaps.map((g) => EVIDENCE_GAP_LABEL[g]);
  const last = names.pop()!;
  return names.length === 0
    ? `Still needed: ${last}.`
    : `Still needed: ${names.join(", ")} and ${last}.`;
}

/**
 * Is a follow-up owed on this bid?
 *
 * Sent and never acknowledged is the state that quietly loses bids: the
 * operator uploaded the package, the screen says Sent, and nobody ever checks
 * whether the portal actually took it. A bid in that state before its deadline
 * is worth chasing.
 */
export function needsReceiptFollowUp(
  state: SubmissionState,
  sentAt: Date | null,
  now = new Date(),
  hours = 24
): boolean {
  if (state !== "sent" || !sentAt) return false;
  return now.getTime() - sentAt.getTime() >= hours * 3_600_000;
}

/**
 * What an audit line should say about this state, given the evidence.
 *
 * Deliberately says what is PROVEN rather than what the state is called. "Sent"
 * is a word; "uploaded to SAM.gov at 14:02 America/Chicago, confirmation
 * 4471-A, receipt attached" is a thing somebody can stand behind.
 */
export function proofSummary(state: SubmissionState, e: SentEvidence): string {
  if (state === "package_ready" || state === "approved") {
    return "Nothing has been sent. No evidence of delivery exists.";
  }
  if (!e.sentAt) return "Recorded as sent, but no send time was saved.";
  const when = `${e.sentAt.toISOString()}${e.timezone ? ` (${e.timezone})` : ""}`;
  const how = e.method ? SUBMISSION_METHOD_LABEL[e.method] : "an unrecorded method";
  const bits = [`${how} at ${when}`];
  if (e.destination) bits.push(`to ${e.destination}`);
  bits.push(
    e.confirmationNumber
      ? `confirmation ${e.confirmationNumber}`
      : "no confirmation number was issued"
  );
  bits.push(e.proofDocumentId ? "receipt attached" : "no receipt attached");
  if (state === "sent") {
    bits.push("the agency has not acknowledged it");
  }
  return `${bits.join("; ")}.`;
}
