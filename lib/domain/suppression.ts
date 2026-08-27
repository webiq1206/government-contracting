/**
 * Telling the platform to stop contacting somebody, and meaning it.
 *
 * The product could already skip a call: it set `status = 'skipped'` with a
 * free-text note. What it could not do is remember. The next Call Prep run
 * built the card again, the next follow-up sweep sent the next email, and the
 * operator's decision lasted exactly as long as the row they clicked on.
 *
 * Worse, a skip and a decline read the same to anyone downstream. "I emailed
 * them this morning, I do not need to ring them" and "they are not interested"
 * are different facts about a business relationship, and collapsing them costs
 * a subcontractor who would have said yes.
 *
 * So the two halves are separated. The skip closes a task. A suppression is
 * what makes the decision survive the next sweep, and it carries its own
 * scope, because "not this one call" and "never ring this firm again" are not
 * the same instruction and a product that treats them alike will do one of
 * them wrong.
 *
 * Pure. The matching rule is the part worth testing exhaustively, and it
 * cannot be while it is welded to a query.
 */

/**
 * Why the operator is stopping.
 *
 * Structured rather than free text because these get counted. "Email response
 * already received" appearing on half the call queue is a scheduling defect
 * worth fixing; the same fact spread across forty differently worded notes is
 * invisible.
 */
export const SKIP_REASONS = [
  "email_response_received",
  "call_not_necessary",
  "duplicate_task",
  "wrong_time",
  "prefer_email",
  "handled_elsewhere",
  "other",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  email_response_received: "They already replied by email",
  call_not_necessary: "The call is not necessary",
  duplicate_task: "Duplicate task",
  wrong_time: "Wrong time to call",
  prefer_email: "They prefer email",
  handled_elsewhere: "The relationship is handled elsewhere",
  other: "Other",
};

export function parseSkipReason(v: unknown): SkipReason | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (SKIP_REASONS as readonly string[]).includes(s) ? (s as SkipReason) : null;
}

/**
 * How far a decision reaches.
 *
 * `once` writes no suppression at all: it closes this task and nothing else,
 * and it is the default because it is the one an operator can undo by simply
 * doing the call.
 */
export const SUPPRESSION_SCOPES = ["once", "opportunity_trade", "subcontractor"] as const;
export type SuppressionScope = (typeof SUPPRESSION_SCOPES)[number];

export const SCOPE_LABEL: Record<SuppressionScope, string> = {
  once: "Just this one",
  opportunity_trade: "This trade on this bid",
  subcontractor: "Every future call to this firm",
};

/** Fails closed toward the narrowest reading. */
export function parseScope(v: unknown): SuppressionScope {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (SUPPRESSION_SCOPES as readonly string[]).includes(s)
    ? (s as SuppressionScope)
    : "once";
}

/**
 * What is being stopped.
 *
 * `all` covers email, follow-ups, clarification requests and calls: it is what
 * "stop outreach for this subcontractor" means. Keeping calls separate matters
 * because a firm that will not take phone calls will often still answer email,
 * and suppressing both because somebody said "do not ring them" would cut off
 * a channel nobody asked to close.
 */
export const CHANNELS = ["call", "email", "all"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABEL: Record<Channel, string> = {
  call: "Calls",
  email: "Emails and follow-ups",
  all: "Every automated approach",
};

export function parseChannel(v: unknown): Channel {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  // Fails toward the widest stop rather than the narrowest, because an
  // unreadable suppression that lets an email out is the failure that reaches
  // a subcontractor's inbox.
  return (CHANNELS as readonly string[]).includes(s) ? (s as Channel) : "all";
}

export interface Suppression {
  id?: string;
  subcontractorId: string;
  /** Null means every opportunity for this organization. */
  opportunityId: string | null;
  /** Null means every trade inside the opportunity scope. */
  trade: string | null;
  channel: Channel;
  reason: string;
  note?: string | null;
  actor?: string;
  createdAt?: Date;
  /** Set when an authorized user removed it. A lifted suppression stops nothing. */
  liftedAt?: Date | null;
  liftedBy?: string | null;
}

export interface ContactAttempt {
  subcontractorId: string;
  opportunityId: string | null;
  trade: string | null;
  channel: Exclude<Channel, "all">;
}

function sameTrade(a: string | null, b: string | null): boolean {
  if (a == null) return true; // A suppression with no trade covers every trade.
  if (b == null) return false; // An attempt with no trade is not covered by a trade-specific stop.
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The suppression that stops this attempt, or null.
 *
 * Returns the record rather than a boolean so the caller can say which
 * decision stopped it, and when, and who made it. "Nothing was sent" with no
 * reason attached is the shape of message that makes people distrust the
 * product and go and send the email themselves.
 */
export function blockingSuppression(
  suppressions: Suppression[],
  attempt: ContactAttempt
): Suppression | null {
  for (const s of suppressions) {
    if (s.liftedAt) continue;
    if (s.subcontractorId !== attempt.subcontractorId) continue;
    if (s.channel !== "all" && s.channel !== attempt.channel) continue;
    // A suppression with no opportunity is account-wide for this firm.
    if (s.opportunityId != null && s.opportunityId !== attempt.opportunityId) continue;
    if (!sameTrade(s.trade, attempt.trade)) continue;
    return s;
  }
  return null;
}

/** One sentence naming the decision that stopped an attempt. */
export function describeSuppression(s: Suppression): string {
  const who =
    s.opportunityId == null
      ? "on every bid"
      : s.trade
        ? `on this bid, for ${s.trade}`
        : "on this bid";
  const what = CHANNEL_LABEL[s.channel].toLowerCase();
  const when = s.createdAt ? ` on ${s.createdAt.toLocaleDateString()}` : "";
  const by = s.actor ? ` by ${s.actor}` : "";
  return `${what} to this subcontractor were stopped ${who}${when}${by}.`;
}

/**
 * The suppression a skip should write, or null when it should write none.
 *
 * `once` deliberately writes nothing. A one-time skip that quietly created a
 * standing rule is how an operator ends up never speaking to a firm again
 * because they were busy on a Tuesday.
 */
export function suppressionForSkip(input: {
  scope: SuppressionScope;
  subcontractorId: string;
  opportunityId: string;
  trade: string | null;
  reason: SkipReason;
  note?: string | null;
}): Suppression | null {
  if (input.scope === "once") return null;
  return {
    subcontractorId: input.subcontractorId,
    opportunityId: input.scope === "subcontractor" ? null : input.opportunityId,
    trade: input.scope === "opportunity_trade" ? input.trade : null,
    channel: "call",
    reason: input.reason,
    note: input.note ?? null,
  };
}

/**
 * What a skip must never do.
 *
 * Named as a list rather than left implicit, because every one of these was a
 * plausible thing for a caller to write and each of them is a lie about a
 * subcontractor who has done nothing wrong.
 */
export const OUTREACH_STATES_A_SKIP_MUST_NOT_SET = [
  "declined",
  "unresponsive",
  "no_response",
  "not_interested",
] as const;

/** True when a proposed outreach-state write is one a skip may not make. */
export function skipMayNotSet(state: string): boolean {
  return (OUTREACH_STATES_A_SKIP_MUST_NOT_SET as readonly string[]).includes(
    state.trim().toLowerCase()
  );
}

/**
 * Whether a skipped call counts as an attempt.
 *
 * Only if somebody actually dialled. A skip inflates the attempt count into
 * the number of times the queue offered a card, which then reads as a firm
 * that has been chased four times and never answered.
 */
export function countsAsAttempt(dialed: boolean): boolean {
  return dialed;
}

export interface StopOutreachScope {
  subcontractorId: string;
  /** Null for every opportunity. */
  opportunityId: string | null;
  /** Null for every trade in scope. */
  trade: string | null;
  channel: Channel;
}

export interface StopImpact {
  queuedEmails: number;
  scheduledFollowUps: number;
  pendingCalls: number;
  openTasks: number;
  clarificationRequests: number;
  /** Trades that lose their only responding subcontractor. */
  uncoveredTrades: string[];
}

/**
 * What the confirmation screen has to say before anything is cancelled.
 *
 * The instruction is that the operator sees exactly what stops. The reason is
 * that the same button, on the same screen, can mean "cancel one follow-up" or
 * "cancel eleven queued messages and leave two trades with nobody quoting
 * them", and nothing in the label distinguishes them.
 */
export function describeStopImpact(impact: StopImpact, scope: StopOutreachScope): string[] {
  const lines: string[] = [];
  const where =
    scope.opportunityId == null
      ? "every bid this firm is on"
      : scope.trade
        ? `${scope.trade} on this bid`
        : "this bid";
  lines.push(`Stopping ${CHANNEL_LABEL[scope.channel].toLowerCase()} for ${where}.`);

  const cancelled: string[] = [];
  if (impact.queuedEmails > 0) cancelled.push(count(impact.queuedEmails, "queued email"));
  if (impact.scheduledFollowUps > 0) {
    cancelled.push(count(impact.scheduledFollowUps, "scheduled follow-up"));
  }
  if (impact.clarificationRequests > 0) {
    cancelled.push(count(impact.clarificationRequests, "automatic clarification request"));
  }
  if (impact.pendingCalls > 0) cancelled.push(count(impact.pendingCalls, "queued call"));
  if (impact.openTasks > 0) cancelled.push(count(impact.openTasks, "open task"));

  lines.push(
    cancelled.length > 0
      ? `This cancels ${list(cancelled)}.`
      : "Nothing is currently queued, so nothing is cancelled today. Future automation will not approach them."
  );

  lines.push(
    "Messages already sent, replies already received, quotes, files and history are all kept."
  );

  if (impact.uncoveredTrades.length > 0) {
    lines.push(
      `${list(impact.uncoveredTrades)} would then have nobody responding on this bid. Source a replacement before the deadline.`
    );
  }
  return lines;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
