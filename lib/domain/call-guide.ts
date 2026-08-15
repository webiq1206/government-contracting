/**
 * The call guide: one ordered, deduplicated, typed set of questions for one
 * call.
 *
 * The workspace used to hold three separate places a question could live: a
 * fixed set of steps hard-coded in the component, whatever Claude generated
 * for the job, and the analyst's questions_for_subs, which fed the generated
 * list and so arrived a second time. They overlapped constantly, most often on
 * price, schedule and insurance, which are also fixed fields on the form. An
 * operator on a live call read the same question twice and typed the answer
 * once, into a single textarea shared by every job-specific question.
 *
 * So the assembly happens here, once, before anything renders:
 *
 *   - core questions, the ones every subcontractor call needs, in the order a
 *     real conversation takes them
 *   - job-specific questions merged in at the point they belong, never after
 *     the wrap-up
 *   - anything duplicating a core question dropped, because the core one has a
 *     structured field and the generated one does not
 *   - anything this opportunity does not need dropped: no bonding question on
 *     a job with no bonding requirement, no project-history question for a sub
 *     whose history is already on file
 *   - every question carries the answer type it deserves, so the operator taps
 *     Yes rather than typing the word
 *
 * Pure. No DB, no I/O, fully unit-tested.
 */

/** How the operator answers. Chosen per question, never one-size-fits-all. */
export type AnswerType =
  | "yes_no"
  | "choice"
  | "money"
  | "number"
  | "date"
  | "short_text"
  | "notes";

export interface CallQuestion {
  /** Stable key the answer is stored under. */
  id: string;
  /** The question, as the operator will say it. One sentence. */
  ask: string;
  type: AnswerType;
  /** For `choice`: the options, shortest first so they fit on one row. */
  options?: { value: string; label: string }[];
  /** Placeholder for text and number inputs. Never a second question. */
  placeholder?: string;
  /** Optional one-line aside for the operator. Never spoken. */
  note?: string;
  /**
   * True for questions the platform needs to price a bid. Used to show what is
   * still outstanding without making everything feel mandatory.
   */
  key?: boolean;
}

export interface CallSection {
  id: string;
  /** Short label, scannable at a glance mid-call. */
  title: string;
  questions: CallQuestion[];
}

export interface CallGuide {
  /** One opening line to read. Not a paragraph. */
  opener: string;
  sections: CallSection[];
  /** One closing line to read. */
  closer: string;
}

export interface CallGuideInput {
  companyName: string;
  ownerName?: string | null;
  trade?: string | null;
  opportunityTitle?: string | null;
  agency?: string | null;
  locationLabel?: string | null;
  /** 'reply' = they answered our email; 'outreach' = cold follow-up. */
  source?: string | null;
  /** Plain-English description of the work, already resolved for this trade. */
  work?: string | null;
  /** Requirements this solicitation actually imposes. */
  requires?: {
    insurance?: boolean;
    bonding?: boolean;
    licenses?: boolean;
    certifications?: boolean;
  };
  /** True when we still need past-performance examples from this sub. */
  needsProjectHistory?: boolean;
  /** Whatever Call Prep stored: typed questions, or legacy plain strings. */
  generated?: unknown;
  /** A price their email mentioned, to confirm rather than ask cold. */
  emailMentionedPrice?: number | null;
}

// ---------------------------------------------------------------------------
// Legacy + generated question coercion
// ---------------------------------------------------------------------------

/**
 * Wording that means a question is already covered by a core field. A
 * generated "what's your price for this scope" is the same question as the
 * quote amount field, and asking it twice is how the old card got long.
 */
const COVERED_BY_CORE: { topic: string; patterns: RegExp[] }[] = [
  {
    topic: "price",
    patterns: [/\b(price|pricing|quote|cost|charge|bid amount|how much)\b/i],
  },
  {
    topic: "schedule",
    patterns: [/\b(start date|when could you start|timeline|schedule|lead time|availability)\b/i],
  },
  {
    topic: "quals",
    patterns: [/\b(insurance|bonded|bonding|licensed|license|certification|certified)\b/i],
  },
  {
    topic: "interest",
    patterns: [/\b(interested|want (this|the) (work|job)|able to (do|perform)|capable)\b/i],
  },
  {
    topic: "history",
    patterns: [/\b(past performance|recent projects|project history|similar projects)\b/i],
  },
];

/** True when a generated question repeats something the form already captures. */
export function duplicatesCoreQuestion(ask: string): boolean {
  return COVERED_BY_CORE.some((c) => c.patterns.some((p) => p.test(ask)));
}

/**
 * Pick an answer type from the wording, for questions that arrive untyped.
 *
 * Deliberately conservative: a wrong guess that lands on short_text costs a
 * few keystrokes, while a wrong yes_no throws away the answer entirely.
 */
export function inferAnswerType(ask: string): AnswerType {
  const q = ask.toLowerCase();
  if (/\bhow much|what.*(cost|price|charge)|\$/.test(q)) return "money";
  if (/\bhow many|how long|number of\b/.test(q)) return "number";
  if (/\bwhat date|when (can|could|would|will)\b/.test(q)) return "date";
  if (/^(do|does|are|is|can|could|will|would|have|has|did)\b/.test(q.trim())) {
    return "yes_no";
  }
  if (/\bdescribe|explain|walk me through|tell me about\b/.test(q)) return "notes";
  return "short_text";
}

interface RawQuestion {
  id?: unknown;
  ask?: unknown;
  question?: unknown;
  type?: unknown;
  options?: unknown;
  placeholder?: unknown;
  note?: unknown;
}

const ANSWER_TYPES: AnswerType[] = [
  "yes_no",
  "choice",
  "money",
  "number",
  "date",
  "short_text",
  "notes",
];

function slug(text: string, i: number): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return base ? `q_${base}` : `q_${i}`;
}

/**
 * Normalize whatever is stored on the card into typed questions.
 *
 * Accepts both shapes on purpose: cards written before this module exists hold
 * an array of plain strings, and they must keep working without a backfill.
 */
export function coerceQuestions(raw: unknown): CallQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: CallQuestion[] = [];
  raw.forEach((item, i) => {
    if (typeof item === "string") {
      const ask = item.trim();
      if (!ask) return;
      out.push({ id: slug(ask, i), ask, type: inferAnswerType(ask) });
      return;
    }
    if (!item || typeof item !== "object") return;
    const r = item as RawQuestion;
    const ask = String(r.ask ?? r.question ?? "").trim();
    if (!ask) return;
    const type = ANSWER_TYPES.includes(r.type as AnswerType)
      ? (r.type as AnswerType)
      : inferAnswerType(ask);
    const options = Array.isArray(r.options)
      ? r.options
          .map((o) =>
            typeof o === "string"
              ? { value: o, label: o }
              : o && typeof o === "object"
                ? {
                    value: String((o as { value?: unknown }).value ?? ""),
                    label: String(
                      (o as { label?: unknown; value?: unknown }).label ??
                        (o as { value?: unknown }).value ??
                        ""
                    ),
                  }
                : { value: "", label: "" }
          )
          .filter((o) => o.value)
      : undefined;
    out.push({
      id: typeof r.id === "string" && r.id ? r.id : slug(ask, i),
      ask,
      // A choice with no options is not a choice; fall back rather than
      // rendering an empty dropdown mid-call.
      type: type === "choice" && !options?.length ? "short_text" : type,
      ...(options?.length ? { options } : {}),
      ...(typeof r.placeholder === "string" ? { placeholder: r.placeholder } : {}),
      ...(typeof r.note === "string" ? { note: r.note } : {}),
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// The guide
// ---------------------------------------------------------------------------

const PROJECT_HISTORY_QUESTION: CallQuestion = {
  id: "project_history",
  ask: "Two or three recent similar projects we could reference?",
  type: "notes",
  placeholder: "Name, rough value, year",
  note: "Only needed because we have nothing on file for them.",
};

function firstName(name?: string | null): string {
  const raw = (name ?? "").trim();
  if (!raw) return "";
  return raw.split(/\s+/)[0] ?? "";
}

/**
 * Assemble the guide for one call.
 *
 * Section order is the order a call actually goes: confirm they can and want
 * to do it, pin down anything specific to this job, get the number, get the
 * dates, confirm the paperwork. Nothing that belongs after the call, notes and
 * the operator's own read, is mixed into the questions they are asking.
 */
export function buildCallGuide(input: CallGuideInput): CallGuide {
  const who = firstName(input.ownerName);
  const trade = (input.trade ?? "").toLowerCase();
  const replied = input.source === "reply";
  const requires = input.requires ?? {};

  const opener =
    `Hi${who ? ` ${who}` : ""}, this is [your name] with [your company]. ` +
    (replied
      ? `Thanks for replying about the ${trade || "work"}`
      : `I emailed you about a ${trade || ""} job we're bidding`) +
    `${input.locationLabel ? ` in ${input.locationLabel}` : ""}. ` +
    `We win the contract and you do the work at your price. Two minutes?`;

  const fit: CallQuestion[] = [
    {
      id: "can_perform",
      ask: "Is this the kind of work your crew does?",
      type: "yes_no",
      key: true,
    },
    {
      id: "interested",
      ask: "Would you want it if we win?",
      type: "yes_no",
      key: true,
    },
    {
      id: "bid_submitted",
      ask: "Have you already bid this project yourselves?",
      type: "yes_no",
      note: "Catches a collision before we price them in.",
    },
  ];

  // Job-specific questions, minus anything the core already asks with a real
  // input behind it, minus exact-duplicate wording.
  const seen = new Set<string>();
  const specific = coerceQuestions(input.generated).filter((q) => {
    const norm = q.ask.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(norm)) return false;
    seen.add(norm);
    return !duplicatesCoreQuestion(q.ask);
  });

  if (input.needsProjectHistory) specific.push(PROJECT_HISTORY_QUESTION);

  const pricing: CallQuestion[] = [
    {
      id: "quote_amount",
      ask: "What would you charge for that scope, all in?",
      type: "money",
      key: true,
      ...(input.emailMentionedPrice
        ? {
            note: `Their email mentioned $${input.emailMentionedPrice.toLocaleString()}. Confirm it.`,
          }
        : {}),
    },
    {
      id: "price_type",
      ask: "Firm number or an estimate?",
      type: "choice",
      options: [
        { value: "firm", label: "Firm" },
        { value: "estimate", label: "Estimate" },
      ],
      key: true,
    },
    {
      id: "assumptions",
      ask: "Anything that price leaves out?",
      type: "notes",
      placeholder: "Permits, access, materials",
    },
  ];

  const schedule: CallQuestion[] = [
    { id: "start_date", ask: "If we win, when could you start?", type: "date" },
    {
      id: "availability",
      ask: "Anything on the calendar that could get in the way?",
      type: "short_text",
      placeholder: "Booked through September",
    },
  ];

  // Only the paperwork this solicitation actually demands. Asking a sub to
  // confirm bonding on a job with no bonding requirement wastes call time and
  // teaches the operator to skim the section.
  const quals: CallQuestion[] = [];
  if (requires.insurance !== false) {
    quals.push({
      id: "insurance_confirmed",
      ask: "Do you carry current general liability insurance?",
      type: "yes_no",
      key: true,
    });
  }
  if (requires.bonding) {
    quals.push({
      id: "bonding_confirmed",
      ask: "Can you be bonded for this?",
      type: "yes_no",
      key: true,
    });
  }
  if (requires.licenses || requires.certifications) {
    quals.push({
      id: "certs_confirmed",
      ask: "Do you hold the licenses and certifications this job calls for?",
      type: "yes_no",
      key: true,
    });
  }

  const sections: CallSection[] = [
    { id: "fit", title: "Fit", questions: fit },
    ...(specific.length ? [{ id: "job", title: "This job", questions: specific }] : []),
    { id: "pricing", title: "Price", questions: pricing },
    { id: "schedule", title: "Timing", questions: schedule },
    ...(quals.length ? [{ id: "quals", title: "Paperwork", questions: quals }] : []),
  ];

  const closer =
    `That's everything, thank you. I'll price your number into our bid` +
    `${input.agency ? ` to ${input.agency}` : ""} and email you either way.`;

  return { opener, sections, closer };
}

/** Every question in the guide, flattened, for counting and validation. */
export function allQuestions(guide: CallGuide): CallQuestion[] {
  return guide.sections.flatMap((s) => s.questions);
}

/**
 * How much of the call is captured. Counts only the questions the platform
 * needs to price a bid, so an operator is never chased for an optional note.
 */
export function guideProgress(
  guide: CallGuide,
  answers: Record<string, unknown>
): { answered: number; total: number } {
  const key = allQuestions(guide).filter((q) => q.key);
  const answered = key.filter((q) => {
    const v = answers[q.id];
    return v != null && v !== "" && v !== false;
  }).length;
  return { answered, total: key.length };
}
