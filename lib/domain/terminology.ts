/**
 * One word per concept, everywhere.
 *
 * Two kinds of confusion this exists to end, and they are different problems.
 *
 * The first is vagueness. "Open", "Processing", "Pending", "Connected", "On
 * track" and "Complete" were used across this product to mean a dozen
 * different things, and every one of them leaves the reader with the same
 * question: open to whom, processing what, on track against which date. A
 * status is only worth showing if it names the next thing that has to happen
 * or the thing that is stopping it.
 *
 * The second is homonyms, and it is the expensive one. A solicitation has two
 * deadlines -- the agency's, and the one we give subcontractors so their
 * numbers arrive before the agency's -- and calling both of them "the
 * deadline" is how a subcontractor was once told the government's date as if
 * it were theirs. There are four different words for the money on a bid and
 * they are not synonyms; a bid priced against the wrong one loses either the
 * job or the margin.
 *
 * Pure. Vocabulary and formatting only, no queries and no policy.
 */

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

/**
 * The two dates, named so they cannot be read as each other.
 *
 * Never "the deadline" on its own anywhere a subcontractor could see it, and
 * never in an operator view where both exist. The suffixes are deliberate:
 * "submission" and "quote" are the words the two audiences already use.
 */
export const DEADLINE_TERMS = {
  government: {
    label: "Government submission deadline",
    short: "Submission deadline",
    description:
      "The date and time the agency must have our bid. Set by the solicitation and cannot be moved.",
  },
  quote: {
    label: "Subcontractor quote deadline",
    short: "Quote deadline",
    description:
      "The date and time we ask subcontractors for their pricing. Always earlier than the submission deadline, to leave time to build the bid.",
  },
} as const;

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Four different numbers people call "the margin".
 *
 * Markup and margin are computed from the same two figures and are never
 * equal: 20% markup on a $100 cost is a 16.7% margin. Quoting one as the
 * other is a real and recurring way to lose money on a won job.
 */
export const MONEY_TERMS = {
  cost: {
    label: "Cost",
    description: "What the work costs us: subcontractor quotes plus our own labour, materials and overhead.",
  },
  markup: {
    label: "Markup",
    description: "What we add on top of cost, as a percentage OF COST. 20% markup on $100 of cost gives a $120 bid.",
  },
  margin: {
    label: "Margin",
    description: "What we keep, as a percentage OF THE BID PRICE. A $120 bid on $100 of cost is a 16.7% margin, not 20%.",
  },
  grossProfit: {
    label: "Gross profit",
    description: "Bid price minus cost, in dollars. The number markup and margin are two different percentages of.",
  },
  bidPrice: {
    label: "Bid price",
    description: "What we tell the agency. Cost plus gross profit.",
  },
} as const;

/**
 * How much a dollar figure can be trusted.
 *
 * The distinction the interface kept dropping: a contract value the
 * solicitation states outright and one we inferred from similar awards are
 * both "the value", and only one of them is a fact. Presenting a model as a
 * fact is how a bid/no-bid decision gets made on a number nobody checked.
 */
export type ValueBasis = "known" | "modeled" | "estimated";

export const VALUE_BASIS_TERMS: Record<ValueBasis, { label: string; description: string }> = {
  known: {
    label: "Known",
    description: "Stated in the solicitation or its attachments. A fact, not an inference.",
  },
  modeled: {
    label: "Modeled",
    description: "Derived from comparable awards. An informed guess, and it can be wrong by a lot on an unusual job.",
  },
  estimated: {
    label: "Our estimate",
    description: "Entered by someone here. As good as the person who entered it and the day they entered it.",
  },
};

// ---------------------------------------------------------------------------
// Why a subcontractor did not give us a number
// ---------------------------------------------------------------------------

/**
 * Five outcomes that were being recorded as one.
 *
 * They call for completely different next actions -- one needs a different
 * firm, one needs a corrected address, one needs nothing at all -- and
 * collapsing them into "no response" meant chasing people who had already
 * said no and ignoring addresses that had never worked.
 */
export type NoQuoteReason =
  | "not_interested"
  | "not_qualified"
  | "does_not_perform_trade"
  | "no_response"
  | "delivery_failed";

export const NO_QUOTE_TERMS: Record<
  NoQuoteReason,
  { label: string; description: string; nextAction: string }
> = {
  not_interested: {
    label: "Not interested",
    description: "They can do the work and chose not to bid it, usually because they are busy.",
    nextAction: "Keep them on the roster and try them on the next one.",
  },
  not_qualified: {
    label: "Not qualified",
    description: "They perform this trade but cannot meet a requirement: bonding, clearance, licence or capacity.",
    nextAction: "Record which requirement, so they are not asked again for work that carries it.",
  },
  does_not_perform_trade: {
    label: "Does not perform this trade",
    description: "We had them under the wrong trade. They were never a candidate for this scope.",
    nextAction: "Correct their trades so the mistake is not repeated on every future job.",
  },
  no_response: {
    label: "No response",
    description: "The email was delivered and nobody replied. Silence, not refusal.",
    nextAction: "Follow up, then call. Silence after both usually means the address reaches nobody.",
  },
  delivery_failed: {
    label: "Delivery failed",
    description: "The message never reached a person. A bounce, a block, or a full mailbox.",
    nextAction: "Fix the address or find another contact. This is not a decision they made.",
  },
};

// ---------------------------------------------------------------------------
// Values that are not numbers
// ---------------------------------------------------------------------------

/**
 * The eight things an empty cell can mean.
 *
 * Showing an unknown as `0` is the single most common way this interface used
 * to lie, and it is a quiet one: nobody questions a zero. Zero quotes received
 * and quotes-not-yet-counted look identical on screen and call for opposite
 * actions.
 */
export type ValueState =
  | "zero"
  | "none"
  | "unknown"
  | "not_provided"
  | "not_applicable"
  | "not_calculated"
  | "calculation_failed"
  | "no_permission";

const VALUE_STATE_TEXT: Record<ValueState, string> = {
  zero: "0",
  none: "None",
  unknown: "Unknown",
  not_provided: "Not provided",
  not_applicable: "Not applicable",
  not_calculated: "Not calculated yet",
  calculation_failed: "Could not be calculated",
  no_permission: "Hidden by your permissions",
};

export function valueStateLabel(state: ValueState): string {
  return VALUE_STATE_TEXT[state];
}

/**
 * Render a number, or say honestly why there is not one.
 *
 * The `state` argument is required rather than inferred, because inferring it
 * is exactly the mistake: a null that means "nobody has counted" and a null
 * that means "counted, and the answer was none" arrive at the formatter
 * looking the same, and only the caller knows which it is.
 */
export function formatCount(
  value: number | null | undefined,
  state: ValueState = "unknown"
): string {
  if (value == null) return VALUE_STATE_TEXT[state === "zero" ? "unknown" : state];
  if (value === 0 && state !== "zero") return VALUE_STATE_TEXT[state];
  return String(value);
}

// ---------------------------------------------------------------------------
// Vague words, and what to say instead
// ---------------------------------------------------------------------------

/**
 * Statuses that are banned in user-visible text, with the question each one
 * leaves unanswered.
 *
 * Enforced by tests/terminology.test.ts against the pages and components, in
 * the same spirit as the em-dash rule: a convention nothing checks is a
 * convention that lasts one busy afternoon.
 */
export const VAGUE_STATUSES: Record<string, string> = {
  Processing: "Processing what, and how long should it take? Name the step: \"Reading the solicitation\".",
  Pending: "Waiting on whom? \"Waiting for subcontractor pricing\" or \"Waiting for your review\".",
  "On track": "Against what date? If there is no date, this is \"Cannot monitor\", not \"On track\".",
  Issue: "Which issue, and what does it stop? Name the thing that is blocked.",
  Error: "Say what failed and what to do. \"Error\" alone leaves reloading and hoping.",
  "In progress": "Whose progress, and what is the next step? Name the step and who owns it.",
};

/**
 * Precise operational statuses, offered as the vocabulary to reach for.
 *
 * Not exhaustive and not enforced: this is a pattern to copy, not a list to
 * pick from. Every one of them names either who we are waiting for or what
 * has to happen next.
 */
export const OPERATIONAL_STATUSES = [
  "Waiting for subcontractor reply",
  "Quote received, review required",
  "Missing electrical pricing",
  "Email blocked by recipient server",
  "Connected, but automation is blocked",
  "Requirements extracted, human verification required",
  "Ready to build bid package",
  "Submission blocked by missing document",
  "Waiting for your decision",
  "Waiting for the agency's decision",
] as const;
