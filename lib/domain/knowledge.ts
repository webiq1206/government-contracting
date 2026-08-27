/**
 * The Knowledge Center: what this platform does, said by the code that does it.
 *
 * The page this replaces was 450 lines of hand-written prose describing the
 * pipeline. Prose cannot be wrong loudly. It told every operator that new
 * solicitations arrive "about every 2 hours" while the registry had been
 * running that agent every three for months, and that a follow-up goes out
 * "after about 48 hours" after the follow-up window became a setting the
 * operator can change to anything between 1 and 720. Both sentences were true
 * when they were typed. Neither had any reason to stay true, and nothing in
 * the repository would have noticed.
 *
 * So the numbers are not written here. Cadence comes from the same cron the
 * scheduler reads, limits come from the account's own automation rules, and
 * thresholds come from its company profile. What is written here is the part
 * that genuinely is editorial: what the step is for, what goes in, what comes
 * out, and what to do when it does not happen.
 *
 * Pure. Every input arrives as an argument, so the whole page is testable
 * without a database.
 */

import { GLOSSARY, termLabel } from "./glossary";
import { formatHour } from "./call-queue";
import { can, type Capability } from "./roles";
import type { AutomationRules } from "./intake";

// ---------------------------------------------------------------------------
// The map

export type StepOwner = "auto" | "you" | "subs" | "agency";

/** Said as a sentence, because "auto" on a badge is a category, not an answer. */
export const OWNER_LABEL: Record<StepOwner, string> = {
  auto: "runs on its own",
  you: "needs you",
  subs: "waiting on subcontractors",
  agency: "waiting on the agency",
};

export const OWNER_WHO: Record<StepOwner, string> = {
  auto: "Brost Co",
  you: "You",
  subs: "A subcontractor",
  agency: "The agency",
};

export type PhaseKey = "setup" | "find" | "price" | "submit";

export interface Phase {
  key: PhaseKey;
  eyebrow: string;
  title: string;
  blurb: string;
}

export const PHASES: Phase[] = [
  {
    key: "setup",
    eyebrow: "Before day one",
    title: "Finish setting up",
    blurb:
      "Brost Co can only score, email, and build bids after a few one-time connections are in place. Today shows what is still missing until setup is complete.",
  },
  {
    key: "find",
    eyebrow: "Phase one",
    title: "Find the right work",
    blurb:
      "Brost Co watches federal postings and only asks you to decide when a score is borderline.",
  },
  {
    key: "price",
    eyebrow: "Phase two",
    title: "Understand the job and get pricing",
    blurb:
      "After pursue, Brost Co reads the solicitation, finds subcontractors (including ones you already know), and chases quotes, escalating to you only when a person is needed.",
  },
  {
    key: "submit",
    eyebrow: "Phase three",
    title: "Assemble, check, and submit",
    blurb:
      "Brost Co builds and audits the package. You review, finish anything only a person can do, and submit.",
  },
];

/**
 * How a step starts.
 *
 * `schedule` names the agent, and the cadence is looked up from the registry
 * at render time rather than repeated here. `queuedBy` covers the agents with
 * no cron of their own: they are real work with a real trigger, and "no
 * schedule" would read as "never runs".
 */
export type Trigger =
  | { kind: "schedule"; agent: string; queuedBy?: string }
  | { kind: "after"; after: string }
  | { kind: "reply" }
  | { kind: "person"; verb: string };

/** Which of this account's own records prove the step is actually happening. */
export type EvidenceKey =
  | "profile"
  | "inbox"
  | "found"
  | "scored"
  | "decided"
  | "analyzed"
  | "comps"
  | "subs_found"
  | "emailed"
  | "called"
  | "quoted"
  | "built"
  | "submitted"
  | "outcome";

/** A setting that changes what this step does, named so it can be found. */
export type SettingKey =
  | "thresholds"
  | "review_timer"
  | "lead_time"
  | "followup"
  | "batch"
  | "call_hours"
  | "call_attempts";

export interface WorkflowStep {
  key: string;
  n: number;
  phase: PhaseKey;
  name: string;
  owner: StepOwner;
  /** What happens, in the operator's language. */
  what: string;
  /** What the next step receives once this one finishes. */
  next: string;
  trigger: Trigger;
  input: string;
  output: string;
  /** What to do when this step does not happen, or happens wrongly. */
  recovery: string;
  recoveryHref: string;
  recoveryLabel: string;
  href?: string;
  hrefLabel?: string;
  evidence: EvidenceKey;
  settings: SettingKey[];
  /** Glossary keys this step teaches, so searching a term finds the step. */
  terms: string[];
}

export const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    key: "profile",
    n: 1,
    phase: "setup",
    name: "Company profile and registrations",
    owner: "you",
    what: "Enter your legal company details, industry codes (NAICS), trades, service areas, certifications, target margin, and your UEI and CAGE from SAM.gov. Scoring and eligibility checks use this as the source of truth.",
    next: "Once identity and scope are saved, Brost Co knows which opportunities fit you.",
    trigger: { kind: "person", verb: "you fill it in, once" },
    input: "Your SAM.gov registration and what your company actually does.",
    output: "The profile every score, eligibility check and generated document reads from.",
    recovery:
      "If opportunities look wrong for your company, the profile is almost always the reason: check the industry codes and service areas first, then the score breakdown on any opportunity to see which factor it failed.",
    recoveryHref: "/settings/profile",
    recoveryLabel: "Open company profile",
    href: "/settings/profile",
    hrefLabel: "Open company profile",
    evidence: "profile",
    settings: [],
    terms: ["uei", "cage", "naics", "psc"],
  },
  {
    key: "inbox",
    n: 2,
    phase: "setup",
    name: "Connect email and other tools",
    owner: "you",
    what: "Click Connect Google Inbox and sign in, so outreach sends from your own address and replies come back into the record. Add optional keys for Google Places (finding local subs), SAM.gov, and SMS alerts as needed. Today's Finish Setting Up checklist tracks what is still open.",
    next: "With email connected, outreach and follow-ups can run without you copying messages by hand.",
    trigger: { kind: "person", verb: "you connect it, once" },
    input: "A Google account you send business email from.",
    output: "Outreach that arrives from you, and replies that land back on the opportunity.",
    recovery:
      "A disconnected or expired inbox stops outreach silently from the operator's side, so Integrations names the state rather than showing a green dot: reconnect there and the backlog sends on the next sweep.",
    recoveryHref: "/settings/integrations",
    recoveryLabel: "Open integrations",
    href: "/settings/integrations",
    hrefLabel: "Open integrations",
    evidence: "inbox",
    settings: [],
    terms: [],
  },
  {
    key: "found",
    n: 3,
    phase: "find",
    name: "Find opportunities",
    owner: "auto",
    what: "New federal opportunities that match your industry codes are pulled from SAM.gov into the pipeline (stage: Found).",
    next: "Each new record moves straight into scoring.",
    trigger: { kind: "schedule", agent: "opportunity-monitor" },
    input: "Your NAICS codes, service areas, and the SAM.gov public notice feed.",
    output: "Opportunity records at the Watching stage, deduplicated against what you already have.",
    recovery:
      "If nothing has arrived for a day, the cause is usually the SAM.gov key or its daily quota rather than a quiet market. Automation Health names the last run and its error.",
    recoveryHref: "/agents",
    recoveryLabel: "Open Automation Health",
    evidence: "found",
    settings: ["lead_time"],
    terms: ["naics", "solicitation", "sources_sought", "stage"],
  },
  {
    key: "scored",
    n: 4,
    phase: "find",
    name: "Score every opportunity",
    owner: "auto",
    what: "Each opportunity is scored 0-100 against your company profile (fit, geography, size, set-aside, deadline feasibility, risk, and more). Strong fits (Pursue) continue automatically. Borderline fits (Review) wait for you. Poor fits are set aside.",
    next: "Pursue-tier work starts analysis on its own. Review-tier work appears on Today and in the Review Queue.",
    trigger: { kind: "schedule", agent: "scoring-engine", queuedBy: "each newly found opportunity" },
    input: "The notice, your profile, and your scoring weights.",
    output: "A score, a tier, and a per-factor breakdown you can open on the opportunity.",
    recovery:
      "An opportunity stuck without a score is picked up by a recovery sweep within about fifteen minutes. If a score looks wrong, open its breakdown: it names the factor that cost the points, which is usually a profile field rather than the notice.",
    recoveryHref: "/agents",
    recoveryLabel: "Open Automation Health",
    evidence: "scored",
    settings: ["thresholds"],
    terms: ["score", "tier_pursue", "tier_review", "tier_ignore", "set_aside"],
  },
  {
    key: "decided",
    n: 5,
    phase: "find",
    name: "Decide: pursue or pass",
    owner: "you",
    what: "Borderline opportunities need your judgment. Decide from Today or the Review Queue, or open the opportunity to read the Bid Brief first. If you do nothing before the timer ends, Brost Co auto-dismisses it so the queue stays clean.",
    next: "Pursue starts analysis, pricing research, and subcontractor sourcing automatically.",
    trigger: { kind: "person", verb: "an opportunity scores in your review band" },
    input: "The score breakdown, the deadline, and the brief.",
    output: "A pursued opportunity that starts the rest of the pipeline, or a dismissed one.",
    recovery:
      "An auto-dismissed opportunity is archived, not deleted: find it in Opportunities with the archived filter and pursue it by hand if the timer beat you to it.",
    recoveryHref: "/opportunities?status=archived",
    recoveryLabel: "Open archived opportunities",
    href: "/review",
    hrefLabel: "Open the review queue",
    evidence: "decided",
    settings: ["review_timer", "thresholds"],
    terms: ["tier_review", "score", "overview"],
  },
  {
    key: "analyzed",
    n: 6,
    phase: "price",
    name: "Write the plain-English brief",
    owner: "auto",
    what: "The solicitation and attachments are read into a Bid Brief: what the job is, due date, location, required trades, qualifications, forms, and risks. This is the overview on every opportunity page.",
    next: "Required trades feed subcontractor search. Attention items surface on the opportunity and on Today when they need you.",
    trigger: { kind: "schedule", agent: "solicitation-analyst", queuedBy: "an opportunity being pursued" },
    input: "The solicitation document and every attachment, including scanned ones.",
    output: "The brief, the requirement list, and the trades the job needs subcontractors for.",
    recovery:
      "A brief that reads thin usually means an attachment could not be read. The opportunity's documents section says which file, and re-running analysis from the opportunity picks up a replacement.",
    recoveryHref: "/agents",
    recoveryLabel: "Open Automation Health",
    evidence: "analyzed",
    settings: [],
    terms: ["solicitation", "overview", "documents", "past_performance", "place_of_performance"],
  },
  {
    key: "comps",
    n: 7,
    phase: "price",
    name: "Research pricing comps",
    owner: "auto",
    what: "Brost Co looks up price history for similar work so later quotes can be checked for prices that look unusually high or low.",
    next: "Out-of-range quotes are flagged for your review before submission.",
    trigger: { kind: "schedule", agent: "pricing-research", queuedBy: "an opportunity being pursued" },
    input: "Past federal awards in this industry code, and the state when it is known.",
    output: "An inflation-adjusted band (low, middle, high) shown on the opportunity.",
    recovery:
      "Some industry codes have too few past awards to form a band. The comps card says so rather than inventing one, and quotes are then accepted without a range check.",
    recoveryHref: "/agents",
    recoveryLabel: "Open Automation Health",
    evidence: "comps",
    settings: [],
    terms: ["pricing_comps", "cpi_adjusted", "comp_median", "comp_p25", "comp_p75"],
  },
  {
    key: "subs_found",
    n: 8,
    phase: "price",
    name: "Find subcontractors",
    owner: "auto",
    what: "For each required trade, Brost Co first reuses reliable subcontractors already on your roster (same trade and area), then searches for additional local candidates. Contact info is verified. Thin coverage (almost no options for a trade) is flagged for you.",
    next: "Paired subcontractors show on the opportunity under Coverage and Subs, with status and history.",
    trigger: { kind: "schedule", agent: "sub-finder", queuedBy: "the brief naming the trades this job needs" },
    input: "The required trades, the place of performance, and your existing roster.",
    output: "Candidate subcontractors per trade, each with a verified contact route or a reason there is none.",
    recovery:
      "Thin coverage for a trade is shown on the opportunity's coverage section. Add a subcontractor you already know by hand and it is used first next time.",
    recoveryHref: "/subs",
    recoveryLabel: "Open your subcontractor roster",
    evidence: "subs_found",
    settings: [],
    terms: ["sub_coverage", "contact_status", "place_of_performance"],
  },
  {
    key: "emailed",
    n: 9,
    phase: "price",
    name: "Email subcontractors",
    owner: "auto",
    what: "Verified subcontractors are emailed automatically. If there is no reply, a polite follow-up goes out on the schedule you set. Status updates on the opportunity and on each subcontractor's permanent record (emails sent, last contact, outcome).",
    next: "Replies create prepared call cards. Still-silent subcontractors appear on Today for a human follow-up.",
    trigger: { kind: "schedule", agent: "outreach", queuedBy: "verified subcontractors being paired to a trade" },
    input: "Your outreach template, the job's scope, and the subcontractor's verified address.",
    output: "A sent email from your own inbox, in one thread per subcontractor, with the quote deadline in it.",
    recovery:
      "Nothing sends while the inbox is disconnected. Reconnect it and a recovery sweep clears the backlog; the Email Log shows every attempt, including the ones that bounced.",
    recoveryHref: "/email-log",
    recoveryLabel: "Open the email log",
    evidence: "emailed",
    settings: ["followup", "batch"],
    terms: ["outreach_state", "follow_up_due", "contact_status"],
  },
  {
    key: "called",
    n: 10,
    phase: "price",
    name: "Call when a person is needed",
    owner: "you",
    what: "Today and the Call Queue list calls to make: interested replies first, then follow-ups when email did not get a quote. Each card opens a guided workspace with a script, job details, and a form that saves the conversation and price in one step. You can also skip a call and that choice is recorded.",
    next: "Saving a quote immediately moves pricing forward. Skipped or completed calls update the subcontractor history everywhere.",
    trigger: { kind: "reply" },
    input: "A prepared call card: who, which trade, which job, and what to ask.",
    output: "A logged conversation, and usually a price.",
    recovery:
      "A card for a job you no longer want appears until the opportunity closes. Skip it and the reason is recorded on the subcontractor rather than lost.",
    recoveryHref: "/call-queue",
    recoveryLabel: "Open the call queue",
    href: "/call-queue",
    hrefLabel: "Open the call queue",
    evidence: "called",
    settings: ["call_hours", "call_attempts"],
    terms: ["call_queue", "outreach_state"],
  },
  {
    key: "quoted",
    n: 11,
    phase: "price",
    name: "Enter subcontractor quotes",
    owner: "you",
    what: "Enter each trade's price on the opportunity (or capture it from the call workspace). Brost Co tracks which trades still need coverage. Quotes outside the expected range ask for a quick review.",
    next: "When enough pricing is in, Bid Builder prices the job and assembles the package automatically.",
    trigger: { kind: "person", verb: "a subcontractor gives you a number" },
    input: "A price per trade, from a reply or a call.",
    output: "Priced coverage, and a flag on anything outside the comps band.",
    recovery:
      "A trade with no quote blocks the bid rather than being priced at zero. The opportunity names the missing trade so you can call one more subcontractor or drop the scope.",
    recoveryHref: "/today",
    recoveryLabel: "See quote work on Today",
    href: "/today",
    hrefLabel: "See quote work on Today",
    evidence: "quoted",
    settings: [],
    terms: ["quote_entry", "sub_coverage", "pricing_comps"],
  },
  {
    key: "built",
    n: 12,
    phase: "submit",
    name: "Price and assemble the bid",
    owner: "auto",
    what: "Quotes are rolled up to your target margin and the submission package is assembled: cover letter, pricing, prefilled reps and certs, capability statement, amendment acknowledgments, and files named and ordered for submission.",
    next: "The package appears on the opportunity for your review, with a compliance checklist.",
    trigger: { kind: "schedule", agent: "bid-builder", queuedBy: "every required trade having a price" },
    input: "The quotes, your target margin, and the requirement list from the brief.",
    output: "A complete package on the opportunity, with every file named the way the notice asks for.",
    recovery:
      "Re-analysing a solicitation marks an already-built package stale rather than leaving you to submit the old one. Rebuild from the opportunity.",
    recoveryHref: "/opportunities",
    recoveryLabel: "Open opportunities",
    evidence: "built",
    settings: [],
    terms: ["package_ready", "documents"],
  },
  {
    key: "checked",
    n: 13,
    phase: "submit",
    name: "Run compliance checks",
    owner: "auto",
    what: "Two independent checks run: an eligibility gate (set-aside, NAICS, bonding, SAM status) and an audit that re-reads the solicitation for anything missing. Required agency forms are flagged so you use the real form, never a substitute. Submission stays blocked until checks pass.",
    next: "Anything still needing a person (signatures, attestations, uploads) is listed clearly on the opportunity.",
    trigger: { kind: "schedule", agent: "compliance-auditor", queuedBy: "the package being assembled" },
    input: "The assembled package and the solicitation it was built from.",
    output: "A pass, or a named list of what is missing and who has to fix it.",
    recovery:
      "A failed check names the requirement and the file. Fix it on the opportunity and the check re-runs; it is never dismissed for you.",
    recoveryHref: "/compliance",
    recoveryLabel: "Open compliance",
    evidence: "built",
    settings: [],
    terms: ["package_ready", "set_aside", "naics"],
  },
  {
    key: "submitted",
    n: 14,
    phase: "submit",
    name: "Review and submit",
    owner: "you",
    what: "Open the opportunity's bid package. Clear the remaining human items, give the checklist a final glance against the solicitation, then submit. Deadlines and blockers stay visible on Today until you finish.",
    next: "After submit, Brost Co waits with you for the agency's decision.",
    trigger: { kind: "person", verb: "the package passes its checks" },
    input: "The package, the checklist, and the solicitation itself.",
    output: "A submitted bid, recorded with the time you sent it.",
    recovery:
      "Some agencies only accept bids through their own portal. Brost Co assembles the files for that upload rather than pretending it can submit for you.",
    recoveryHref: "/opportunities",
    recoveryLabel: "Open opportunities",
    evidence: "submitted",
    settings: [],
    terms: ["package_ready", "solicitation"],
  },
  {
    key: "waiting",
    n: 15,
    phase: "submit",
    name: "Wait for the agency",
    owner: "agency",
    what: "The opportunity sits in Submitted while the government evaluates bids. Nothing else is required from you until a decision is announced. Brost Co keeps it on Today under awaiting a decision.",
    next: "When you hear the result, record it in one step.",
    trigger: { kind: "after", after: "submitted" },
    input: "Your submitted bid.",
    output: "An award decision, on the agency's timetable rather than yours.",
    recovery:
      "Agencies frequently miss their own award dates. Nothing is wrong with the record if it sits here for months; record the outcome whenever you hear.",
    recoveryHref: "/opportunities",
    recoveryLabel: "Open opportunities",
    evidence: "submitted",
    settings: [],
    terms: ["stage"],
  },
  {
    key: "outcome",
    n: 16,
    phase: "submit",
    name: "Record win or loss",
    owner: "you",
    what: "Record the outcome on the opportunity. A win creates the contract record with milestones and compliance tracking. A loss (and every win) teaches the scoring system so future Pursue and Review decisions get sharper.",
    next: "Won work is managed on Contracts. Scoring weight suggestions may appear on Today for your approval.",
    trigger: { kind: "person", verb: "the agency tells you" },
    input: "The award notice, or the debrief.",
    output: "A contract record on a win, and a scoring lesson either way.",
    recovery:
      "An outcome recorded by mistake can be changed on the opportunity. The contract it created is kept until you remove it, so nothing is lost by correcting it.",
    recoveryHref: "/contracts",
    recoveryLabel: "Open contracts",
    href: "/contracts",
    hrefLabel: "Open contracts",
    evidence: "outcome",
    settings: [],
    terms: ["stage"],
  },
];

// ---------------------------------------------------------------------------
// What this account's own records say about each step

export interface Evidence {
  /** How many happened in the last 7 days. null when the figure could not be read. */
  recent: number | null;
  /** When this last happened at all. null when it never has. */
  lastAt: string | null;
  /** How many are waiting for a person right now, where the step has a queue. */
  waiting?: number | null;
  /** One real record from this account, named, so the step is not abstract. */
  example?: string | null;
  /**
   * For the steps whose state is a condition rather than a rate.
   *
   * "Connect your inbox" is done or it is not, and an expired token is a third
   * thing that neither a count nor a timestamp can express. The caller holds
   * the integration's real state, so it says the sentence; everything else on
   * the page still computes.
   */
  override?: { word: StatusWord; tone: StepStatus["tone"]; detail: string };
}

export interface Thresholds {
  pursueMin: number | null;
  reviewMin: number | null;
  autoDismissHours: number | null;
}

export interface KnowledgeContext {
  /** Agent name to cron expression, straight from the registry. */
  schedules: Record<string, string | null>;
  rules: AutomationRules;
  thresholds: Thresholds;
  evidence: Partial<Record<EvidenceKey, Evidence>>;
  now: Date;
}

export type StatusWord =
  | "Running"
  | "Waiting on you"
  | "Nothing yet"
  | "Quiet"
  | "Set up"
  | "Needs you"
  | "Turned off"
  | "Not recorded";

export interface StepStatus {
  word: StatusWord;
  tone: "good" | "attention" | "neutral" | "unknown";
  detail: string;
}

export interface SettingNote {
  text: string;
  href: string;
}

export interface StepView {
  step: WorkflowStep;
  triggerText: string;
  settingNotes: SettingNote[];
  status: StepStatus;
}

const DAY_MS = 86_400_000;
const RECENT_DAYS = 7;

function ago(from: string, now: Date): string {
  const then = new Date(from).getTime();
  if (Number.isNaN(then)) return "at an unrecorded time";
  const mins = Math.round((now.getTime() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function withinRecent(from: string, now: Date): boolean {
  const then = new Date(from).getTime();
  if (Number.isNaN(then)) return false;
  return now.getTime() - then <= RECENT_DAYS * DAY_MS;
}

/** True when the calling step is not part of this account's pipeline at all. */
export function stepSkipped(step: WorkflowStep, rules: AutomationRules): boolean {
  return step.key === "called" && !rules.calls_enabled;
}

/**
 * What this step is doing on this account, right now.
 *
 * The one rule that shapes all of it: silence is not health. A step that has
 * never run reads "Nothing yet", a step whose records could not be read reads
 * "Not recorded", and neither of them is allowed to look like a step that is
 * working. The previous page had no status at all, which is the same claim
 * made more quietly.
 */
export function stepStatus(
  step: WorkflowStep,
  ctx: KnowledgeContext
): StepStatus {
  if (stepSkipped(step, ctx.rules)) {
    return {
      word: "Turned off",
      tone: "neutral",
      detail:
        "This account runs on email only, so no call card is prepared and an opportunity moves straight from its outreach email to collecting quotes.",
    };
  }

  const ev = ctx.evidence[step.evidence];
  if (!ev) {
    return {
      word: "Not recorded",
      tone: "unknown",
      detail:
        "This account's records for this step could not be read just now, so whether it is running is unknown.",
    };
  }

  if (ev.override) return ev.override;

  const waiting = ev.waiting ?? null;
  const example = ev.example ? ` Most recent: ${ev.example}.` : "";

  if (waiting != null && waiting > 0) {
    return {
      word: "Waiting on you",
      tone: "attention",
      detail: `${waiting} ${waiting === 1 ? "item is" : "items are"} waiting for you here right now.${example}`,
    };
  }

  if (!ev.lastAt) {
    return {
      word: "Nothing yet",
      tone: "neutral",
      detail: "This has not happened yet on this account.",
    };
  }

  const when = ago(ev.lastAt, ctx.now);
  if (withinRecent(ev.lastAt, ctx.now)) {
    const count =
      ev.recent == null
        ? `Last happened ${when}.`
        : `${ev.recent} in the last ${RECENT_DAYS} days, most recently ${when}.`;
    return { word: "Running", tone: "good", detail: `${count}${example}` };
  }

  return {
    word: "Quiet",
    tone: "neutral",
    detail: `Last happened ${when}, and nothing in the last ${RECENT_DAYS} days.${example}`,
  };
}

/**
 * When this step starts, in English.
 *
 * A scheduled step reads its cadence from the registry through `describe`,
 * which is passed in rather than imported so this module stays free of the
 * cron parser's shape. An agent with no cron is queue-driven, and saying so
 * beats saying nothing: "no schedule" reads as "never runs".
 */
export function triggerText(
  step: WorkflowStep,
  ctx: KnowledgeContext,
  describe: (cron: string | null | undefined) => string | null
): string {
  const t = step.trigger;
  switch (t.kind) {
    case "schedule": {
      const said = describe(ctx.schedules[t.agent] ?? null);
      if (said) return said;
      return t.queuedBy
        ? `Queued by ${t.queuedBy}, with no fixed clock`
        : "Queued as soon as the step before it finishes";
    }
    case "after": {
      const prior = WORKFLOW_STEPS.find((s) => s.key === t.after);
      return `When ${prior ? prior.name.toLowerCase() : "the step before it"} is done`;
    }
    case "reply":
      return "When a subcontractor replies, or when an email gets no answer";
    case "person":
      return `When ${t.verb}`;
  }
}

const SETTING_HREF: Record<SettingKey, string> = {
  thresholds: "/settings/profile#thresholds",
  review_timer: "/settings/profile#thresholds",
  lead_time: "/settings/rules",
  followup: "/settings/rules#outreach",
  batch: "/settings/rules#outreach",
  call_hours: "/settings/rules#calls",
  call_attempts: "/settings/rules#calls",
};

function hours(n: number): string {
  return `${n} hour${n === 1 ? "" : "s"}`;
}

/**
 * The numbers this step is actually using, read from this account's settings.
 *
 * This is the half that used to be prose. "After about 48 hours" was true of
 * the default and false of every account that changed it, and an operator who
 * had set the window to 24 was reading documentation about somebody else's
 * account.
 */
export function settingNotes(step: WorkflowStep, ctx: KnowledgeContext): SettingNote[] {
  const r = ctx.rules;
  const out: SettingNote[] = [];
  for (const key of step.settings) {
    const href = SETTING_HREF[key];
    switch (key) {
      case "thresholds": {
        const pursue = ctx.thresholds.pursueMin;
        const review = ctx.thresholds.reviewMin;
        out.push({
          href,
          text:
            pursue == null || review == null
              ? "Your pursue and review score thresholds are not recorded on this account, so the tier an opportunity lands in cannot be explained here."
              : `Your thresholds: ${pursue} and above is pursued automatically, ${review} to ${pursue - 1} waits for your decision, below ${review} is set aside.`,
        });
        break;
      }
      case "review_timer": {
        const h = ctx.thresholds.autoDismissHours;
        out.push({
          href,
          text:
            h == null
              ? "How long a borderline opportunity waits for your decision is not recorded on this account."
              : `Your timer: a borderline opportunity waits ${hours(h)} for your decision before it is auto-dismissed.`,
        });
        break;
      }
      case "lead_time":
        out.push({
          href,
          text:
            r.min_lead_days > 0
              ? `Your lead-time rule: anything due inside ${r.min_lead_days} day${r.min_lead_days === 1 ? "" : "s"} of arriving is sent to ${r.lead_action === "dismiss" ? "the archive" : "your review queue"} instead of straight into the pipeline.`
              : "Your lead-time rule is off, so an opportunity is worked no matter how close its deadline already is.",
        });
        break;
      case "followup":
        out.push({
          href,
          text:
            r.followup_max === 0
              ? `Your follow-up rule: no follow-up is sent. One email goes out and a silent subcontractor is left for a call.`
              : `Your follow-up rule: ${hours(r.followup_hours)} after the first email, and at most ${r.followup_max} follow-up${r.followup_max === 1 ? "" : "s"} per subcontractor per opportunity.`,
        });
        break;
      case "batch":
        out.push({
          href,
          text: `Your send limit: at most ${r.outreach_batch_limit} outreach email${r.outreach_batch_limit === 1 ? "" : "s"} per run, so one busy day cannot empty your sending reputation.`,
        });
        break;
      case "call_hours":
        out.push({
          href,
          text: `Your calling window: ${formatHour(r.call_hours_start)} to ${formatHour(r.call_hours_end)}, judged in the subcontractor's own time zone rather than yours.`,
        });
        break;
      case "call_attempts":
        out.push({
          href,
          text:
            r.call_max_attempts === 0
              ? "Your attempt limit is off, so a card keeps asking to be called however many times it has been tried."
              : `Your attempt limit: ${r.call_max_attempts} call${r.call_max_attempts === 1 ? "" : "s"} per subcontractor per opportunity.`,
        });
        break;
    }
  }
  return out;
}

export function stepViews(
  ctx: KnowledgeContext,
  describe: (cron: string | null | undefined) => string | null
): StepView[] {
  return WORKFLOW_STEPS.map((step) => ({
    step,
    triggerText: triggerText(step, ctx, describe),
    settingNotes: settingNotes(step, ctx),
    status: stepStatus(step, ctx),
  }));
}

// ---------------------------------------------------------------------------
// Where to start, for the person actually reading it

export interface QuickStartItem {
  key: string;
  label: string;
  hint: string;
  href: string;
  hrefLabel: string;
  /** True when this account has already done it. */
  done: boolean;
  /** True when nothing enters the pipeline until it is done. */
  required: boolean;
  /** Set when the reader's role cannot do this, naming who can. */
  blockedBy: string | null;
}

export interface QuickStartFacts {
  hasOpportunities: boolean;
  hasDecided: boolean;
  hasSubs: boolean;
}

/** One setup item as the setup checklist already computes it. */
export interface SetupItemLike {
  key: string;
  label: string;
  hint: string;
  done: boolean;
  href: string;
  required: boolean;
}

/**
 * Which capability each setup step needs.
 *
 * A read-only account cannot connect an inbox, and a checklist that tells it
 * to is a checklist it can never finish.
 */
/**
 * Which capability each setup step needs, with nulls stated rather than
 * implied.
 *
 * Total on purpose. A key missing from this map used to fall through to no
 * capability at all, so a read-only account was told to connect an inbox it
 * cannot connect. Two of these steps genuinely need no capability, and they
 * say so here rather than by being absent, which is the same value with none
 * of the meaning.
 */
const SETUP_CAPABILITY: Record<string, Capability | null> = {
  // Nothing to do: whoever is reading has an account, or the platform is
  // finding the first opportunity on their behalf.
  account: null,
  first_opportunity: null,
  sender_identity: "manage_profile",
  rules: "manage_rules",
  access: "manage_billing",
  sam: "manage_integrations",
  claude: "manage_integrations",
  googleMaps: "manage_integrations",
  // The checklist calls the connected inbox "email", not "gmail". Keyed wrong,
  // it fell through to no capability at all, which meant a read-only account
  // was told to connect an inbox it cannot connect. tests/knowledge.test.ts
  // now asserts every checklist key is covered.
  email: "manage_integrations",
  naics: "manage_profile",
  service_areas: "manage_profile",
  identity: "manage_profile",
  certifications: "manage_profile",
};

/** The learn-by-doing half, which no setup checklist can tell you is finished. */
const FIRST_RUNS: {
  key: string;
  label: string;
  hint: string;
  href: string;
  hrefLabel: string;
  capability: Capability | null;
  done: (f: QuickStartFacts) => boolean;
}[] = [
  {
    key: "watch",
    label: "Watch the first opportunities arrive",
    hint: "They are pulled from SAM.gov on a schedule rather than on demand, so the first batch is not instant. The workflow map below says how often.",
    href: "/opportunities",
    hrefLabel: "Open opportunities",
    capability: null,
    done: (f) => f.hasOpportunities,
  },
  {
    key: "decide",
    label: "Make one pursue-or-pass decision",
    hint: "Open the score breakdown while you do it. It names the factor that made the score, which is the fastest way to learn what your profile is telling the scoring.",
    href: "/review",
    hrefLabel: "Open the review queue",
    capability: "decide",
    done: (f) => f.hasDecided,
  },
  {
    key: "subs",
    label: "Add a subcontractor you already trust",
    hint: "Subcontractors on your roster are paired to a trade before any that Brost Co finds for you, so the people you already work with get asked first.",
    href: "/subs",
    hrefLabel: "Open your roster",
    capability: "manage_subs",
    done: (f) => f.hasSubs,
  },
  {
    key: "rules",
    label: "Read the automation rules once",
    hint: "They decide how often other people's businesses hear from your company, and how many times a subcontractor is called. Nobody else is going to read them for you.",
    href: "/settings/rules",
    hrefLabel: "Open automation rules",
    capability: "manage_rules",
    // Reading has no record, so this one never marks itself done.
    done: () => false,
  },
];

/**
 * Where to start, for the person actually reading it.
 *
 * The setup half is not re-derived here: it comes from the same checklist
 * Today shows, because two answers to "is setup finished" is one more than the
 * number that can be right.
 *
 * A step the reader's role cannot perform is shown with who can perform it,
 * never hidden. Hiding it produces a checklist that looks finished on a
 * read-only account, and an operator who never learns the step exists.
 */
/**
 * What to call the link, from where it goes.
 *
 * It was a two-way guess between integrations and the company profile, which
 * was right while those were the only two destinations. The rules, billing
 * and opportunities steps would all have been labelled "Open company
 * profile", which is a link that lies about where it lands.
 */
function hrefLabelFor(href: string): string {
  if (href.includes("/settings/integrations")) return "Open integrations";
  if (href.includes("/settings/profile")) return "Open company profile";
  if (href.includes("/settings/rules")) return "Open automation rules";
  if (href.includes("/settings/billing")) return "Open billing";
  if (href.includes("/settings/account")) return "Open your account";
  if (href.includes("/opportunities")) return "Open opportunities";
  return "Open";
}

export function quickStart(
  role: string | null | undefined,
  setupItems: SetupItemLike[],
  facts: QuickStartFacts,
  labelOf: (role: string | null | undefined) => string
): QuickStartItem[] {
  const blocked = (capability: Capability | null): string | null =>
    capability && !can(role, capability)
      ? `${labelOf(role)} cannot do this. Ask an account owner or an administrator.`
      : null;

  const setup: QuickStartItem[] = setupItems.map((item) => ({
    key: `setup:${item.key}`,
    label: item.label,
    hint: item.hint,
    href: item.href,
    hrefLabel: hrefLabelFor(item.href),
    done: item.done,
    required: item.required,
    blockedBy: blocked(SETUP_CAPABILITY[item.key] ?? null),
  }));

  const runs: QuickStartItem[] = FIRST_RUNS.map((item) => ({
    key: `first:${item.key}`,
    label: item.label,
    hint: item.hint,
    href: item.href,
    hrefLabel: item.hrefLabel,
    done: item.done(facts),
    required: false,
    blockedBy: blocked(item.capability),
  }));

  return [...setup, ...runs];
}

// ---------------------------------------------------------------------------
// Finding any of it

export interface Article {
  key: string;
  title: string;
  points: string[];
  href: string;
}

export interface KnowledgeHits {
  steps: WorkflowStep[];
  terms: { key: string; label: string; text: string }[];
  articles: Article[];
  total: number;
  /**
   * True when nothing matched every word and these matched some of them.
   *
   * The page has to say so. A question typed in full sentences ("why did
   * nothing get emailed") shares at most one content word with any single
   * answer, so requiring all of them returns nothing for exactly the phrasing
   * the search box invites. Loosening it silently is the other failure:
   * results that answer half the question, presented as if they answered it.
   */
  partial: boolean;
}

/**
 * Words too common to narrow anything, dropped so "how do I score" still works.
 *
 * The auxiliaries earn their place: "why did nothing get emailed" returned
 * fifteen results because "did" and "get" appear in half the prose on the
 * page, and every one of them was a real match to a word that carries no
 * meaning. Kept out are the nouns and verbs a question is actually about.
 */
const STOP_WORDS = new Set([
  "a", "all", "an", "and", "any", "are", "as", "at", "be", "been", "but", "by",
  "can", "could", "did", "do", "does", "done", "for", "from", "get", "got",
  "had", "has", "have", "how", "i", "in", "is", "it", "its", "me", "my", "no",
  "not", "of", "on", "or", "should", "so", "some", "that", "the", "their",
  "them", "then", "there", "they", "this", "to", "was", "we", "were", "what",
  "when", "where", "which", "who", "why", "will", "with", "would", "you",
  "your",
]);

export function searchTerms(raw: string): string[] {
  return (raw ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/** How many of the query's words appear at all. */
function score(haystack: string, words: string[]): number {
  const h = haystack.toLowerCase();
  return words.reduce((n, w) => (h.includes(w) ? n + 1 : n), 0);
}

/**
 * One search across the three things this page knows: the workflow, the
 * vocabulary, and the per-page guidance.
 *
 * Natural language in the sense that matters here: the question is stripped
 * to its content words, so "why did nothing get emailed" reaches the outreach
 * step. Nothing is scored or ranked cleverly, because a wrong ranking on six
 * results is worse than no ranking.
 */
export function searchKnowledge(raw: string, articles: Article[]): KnowledgeHits {
  const words = searchTerms(raw);
  if (words.length === 0) {
    return { steps: [], terms: [], articles: [], total: 0, partial: false };
  }

  const stepText = (s: WorkflowStep) =>
    [s.name, s.what, s.next, s.input, s.output, s.recovery, ...s.terms.map(termLabel)].join(" ");
  const allTerms = Object.entries(GLOSSARY).map(([key, text]) => ({
    key,
    label: termLabel(key),
    text,
  }));
  const termText = (t: { key: string; label: string; text: string }) =>
    `${t.label} ${t.key.replace(/_/g, " ")} ${t.text}`;
  const articleText = (a: Article) => `${a.title} ${a.points.join(" ")}`;

  const pick = <T>(items: T[], text: (item: T) => string, need: number): T[] =>
    items
      .map((item) => ({ item, hits: score(text(item), words) }))
      .filter((x) => x.hits >= need)
      .sort((a, b) => b.hits - a.hits)
      .map((x) => x.item);

  const gather = (need: number): Omit<KnowledgeHits, "partial"> => {
    const steps = pick(WORKFLOW_STEPS, stepText, need);
    const terms = pick(allTerms, termText, need);
    const found = pick(articles, articleText, need);
    return {
      steps,
      terms,
      articles: found,
      total: steps.length + terms.length + found.length,
    };
  };

  const strict = gather(words.length);
  if (strict.total > 0) return { ...strict, partial: false };

  // Nothing carried every word, which is the normal outcome for a question
  // typed as a sentence. Fall back to anything sharing a word, best match
  // first, and let the page say that is what happened.
  const loose = gather(1);
  return { ...loose, partial: loose.total > 0 };
}

/** What to say when a search finds nothing, without pretending it found something. */
export function noKnowledgeAdvice(raw: string): string {
  const words = searchTerms(raw);
  if (words.length === 0) return "Type a word from the thing you are trying to do.";
  if (words.length > 3) {
    return "Nothing matches all of those words. Try the one word that matters most, for example a stage name, a page name, or a term from a solicitation.";
  }
  return "Nothing here uses that word. The workflow map below covers every step end to end, and the glossary covers the terms a solicitation uses.";
}

/** Every glossary term, in a fixed order, for the reference list. */
export function glossaryList(): { key: string; label: string; text: string }[] {
  return Object.keys(GLOSSARY)
    .map((key) => ({ key, label: termLabel(key), text: GLOSSARY[key] }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
