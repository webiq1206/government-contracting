/**
 * The opportunity journey, one pure module that answers, for any opportunity:
 *   - which steps are done, which is active, which are still ahead
 *   - who the ball is with right now (system / you / subs / agency)
 *   - the single recommended next action, why it matters, and what happens after
 *   - whether the record looks stuck (no movement beyond the stage's norm)
 *
 * The NextStepBanner and the journey tracker on the opportunity page both
 * render from this, and the Today page reuses the waiting-on labels, so the
 * story the operator reads is identical everywhere. Pure functions only, no
 * DB, no I/O, fully unit-tested.
 */

/** Who is expected to move the opportunity forward right now. */
export type Party = "system" | "you" | "subs" | "agency";

export const PARTY_LABEL: Record<Party, string> = {
  system: "the system",
  you: "you",
  subs: "subcontractors",
  agency: "the agency",
};

/** The happy-path journey, in order. Terminal stages are handled separately. */
export const JOURNEY_STAGES = [
  "monitoring",
  "scoring",
  "analysis",
  "sub_research",
  "outreach",
  "call_queue",
  "quote_entry",
  "bid_building",
  "submitted",
] as const;

const STAGE_INDEX = new Map<string, number>(JOURNEY_STAGES.map((s, i) => [s, i]));

export interface JourneyStep {
  stage: string;
  label: string;
  /** Who does the work while this step is active. */
  owner: Party;
  status: "done" | "current" | "upcoming";
}

const STEP_META: Record<(typeof JOURNEY_STAGES)[number], { label: string; owner: Party }> = {
  monitoring: { label: "Found", owner: "system" },
  scoring: { label: "Scored", owner: "system" },
  analysis: { label: "Analyzed", owner: "system" },
  sub_research: { label: "Subs found", owner: "system" },
  outreach: { label: "Subs contacted", owner: "subs" },
  call_queue: { label: "Calls", owner: "you" },
  quote_entry: { label: "Quotes", owner: "you" },
  bid_building: { label: "Bid built", owner: "you" },
  submitted: { label: "Submitted", owner: "agency" },
};

/**
 * The step-tracker model for one opportunity. Terminal stages (won/lost/
 * dismissed) return the full path marked done up to where the record exited.
 */
export function journeySteps(stage: string): JourneyStep[] {
  // Terminal stages: won exits after submitted; lost too; dismissed can exit
  // anywhere, without a recorded exit point we show the whole path as done
  // only for won/lost (they necessarily passed through submission).
  const isTerminal = stage === "won" || stage === "lost" || stage === "dismissed";
  const idx = isTerminal
    ? stage === "dismissed"
      ? -1 // unknown exit point; show nothing as current
      : JOURNEY_STAGES.length // won/lost: every step completed
    : (STAGE_INDEX.get(stage) ?? 0);

  return JOURNEY_STAGES.map((s, i) => ({
    stage: s,
    label: STEP_META[s].label,
    owner: STEP_META[s].owner,
    status: i < idx ? "done" : i === idx ? "current" : "upcoming",
  }));
}

/**
 * Stage-level "who is the ball with", for compact chips (Today rows) where the
 * full StepInput isn't available. bid_building flips to the system while the
 * Bid Builder is still pricing (no bid yet).
 */
export function stageParty(stage: string, opts?: { hasBid?: boolean }): Party | null {
  if (stage === "won" || stage === "lost" || stage === "dismissed") return null;
  if (stage === "bid_building" && opts?.hasBid === false) return "system";
  const meta = STEP_META[stage as (typeof JOURNEY_STAGES)[number]];
  return meta ? meta.owner : null;
}

// ---------------------------------------------------------------------------
// Stall detection
// ---------------------------------------------------------------------------

/**
 * How long a stage may sit with no record activity before it "looks stuck",
 * in hours. Only stages where the SYSTEM owns the work get a threshold; the
 * human-owned and agency-owned stages are legitimately slow.
 */
export const STALL_HOURS: Partial<Record<string, number>> = {
  scoring: 2, // scoring runs within minutes of ingest
  analysis: 6, // the analyst reads attachments; give it headroom
  sub_research: 24, // finder + per-candidate verification
  outreach: 96, // 48h auto follow-up, then replies should exist
  bid_building: 2, // pricing runs the moment quotes are saved
};

/** True when an auto stage has seen no activity beyond its expected window. */
export function isStalled(stage: string, hoursSinceUpdate: number | null): boolean {
  if (hoursSinceUpdate == null) return false;
  const limit = STALL_HOURS[stage];
  return limit != null && hoursSinceUpdate > limit;
}

// ---------------------------------------------------------------------------
// The recommended next step
// ---------------------------------------------------------------------------

export interface StepInput {
  stage: string;
  tier: string | null;
  humanActionRequired: boolean;
  quoteCount: number;
  requiredTradeCount: number;
  hasBid: boolean;
  bidSubmitted: boolean;
  outcome: string | null;
  pastPerfBlocked: boolean;
  /** Operator paused the cron loop (Agents page master switch). */
  automationPaused?: boolean;
  /** Hours since the record last changed; feeds stall detection. */
  hoursSinceUpdate?: number | null;
  /** Deadline passed without submission; the record was auto-archived. */
  expired?: boolean;
}

export interface NextStep {
  title: string;
  why: string;
  /** What the platform does the moment this step is completed. */
  after?: string;
  cta: string;
  href?: string;
  anchor?: string;
  tone: "action" | "warn" | "info";
  /** When set, the banner renders the matching decision buttons inline. */
  decision?: "triage" | "outcome";
  /** Who the ball is with right now. */
  waitingOn: Party;
}

export function deriveStep(s: StepInput): NextStep | null {
  if (s.stage === "won")
    return {
      title: "Nothing, this one is won 🎉",
      why: "The contract record was created. Track milestones and compliance from the Contracts page.",
      cta: "View contracts",
      href: "/contracts",
      tone: "info",
      waitingOn: "system",
    };
  if (s.stage === "lost" || s.stage === "dismissed") return null;

  if (s.expired)
    return {
      title: "Nothing, this one expired",
      why: "The submission deadline passed before a bid went out, so the record was archived automatically. All documents, communications, and history are preserved here for reference.",
      after: "Nothing further happens; archived records are kept per your retention settings.",
      cta: "",
      tone: "info",
      waitingOn: "system",
    };

  if (s.pastPerfBlocked)
    return {
      title: "Decide whether to pursue this as an exception",
      why: "The agency requires past performance from your company itself, which you can't show yet. Automation stopped so you can make the call: pursue anyway or dismiss.",
      after: "Pursue restarts the automatic pipeline from analysis; dismiss archives the record.",
      cta: "See details below",
      anchor: "#attachments",
      tone: "warn",
      decision: "triage",
      waitingOn: "you",
    };

  if (s.tier === "review" && s.humanActionRequired)
    return {
      title: "Decide: pursue or pass",
      why: "This scored in the borderline band. If you don't act before the timer, it auto-dismisses.",
      after: "Pursue kicks off analysis, pricing, and sub research automatically; you'll only hear back when calls are ready.",
      cta: "Read the brief",
      anchor: "#attachments",
      tone: "action",
      decision: "triage",
      waitingOn: "you",
    };

  const step = deriveStageStep(s);
  if (!step) return null;

  // Truth-in-advertising overrides: "the system is working on it" copy is a
  // lie when the operator paused automation or the stage has visibly stalled.
  if (step.waitingOn === "system" || (s.stage === "outreach" && step.waitingOn === "subs")) {
    if (s.automationPaused)
      return {
        title: "Paused, this will not move until you resume automation",
        why: `Normally: ${lcFirst(step.why)} But the automation master switch is off, so no scheduled work is running.`,
        after: "Resuming restarts the schedule; this record picks up exactly where it left off.",
        cta: "Resume automation",
        href: "/agents",
        tone: "warn",
        waitingOn: "you",
      };
    if (isStalled(s.stage, s.hoursSinceUpdate ?? null))
      return {
        title: "This looks stuck, check the automation log",
        why: `No activity for over ${STALL_HOURS[s.stage]} hours in a stage that normally completes sooner. The responsible agent may have hit an error or a missing API key.`,
        after: "The log shows the last run and its reasoning; “Run now” retries the agent immediately.",
        cta: "Open automation log",
        href: `/agents${STAGE_AGENT[s.stage] ? `?agent=${STAGE_AGENT[s.stage]}` : ""}`,
        tone: "warn",
        waitingOn: "you",
      };
  }

  return step;
}

/** Which agent is responsible for moving each auto stage (for log deep links). */
export const STAGE_AGENT: Partial<Record<string, string>> = {
  monitoring: "opportunity-monitor",
  scoring: "scoring-engine",
  analysis: "solicitation-analyst",
  sub_research: "sub-finder",
  outreach: "outreach",
  bid_building: "bid-builder",
};

function deriveStageStep(s: StepInput): NextStep | null {
  switch (s.stage) {
    case "monitoring":
    case "scoring":
      return {
        title: "Nothing yet, scoring is running",
        why: "The system is scoring this against your company profile. It becomes actionable within a few minutes.",
        after: "High scores start analysis automatically; borderline ones come back to you for a decision.",
        cta: "",
        tone: "info",
        waitingOn: "system",
      };
    case "analysis":
      return {
        title: "Nothing yet, the plain-English brief is being written",
        why: "The analyst is reading the solicitation and attachments. When it's done, sub research starts automatically.",
        after: "Sub research finds and verifies local subs for each required trade, then emails them.",
        cta: "",
        tone: "info",
        waitingOn: "system",
      };
    case "sub_research":
      return {
        title: "Nothing yet, finding subcontractors",
        why: "The system is finding and verifying local subs for each required trade. They'll be emailed automatically.",
        after: "Replies create call cards for you; a 48-hour follow-up goes out on its own.",
        cta: "",
        tone: "info",
        waitingOn: "system",
      };
    case "outreach":
      return {
        title: "Wait for replies (or call ahead)",
        why: "Outreach emails are out, with an automatic 48-hour follow-up. Replies create call cards automatically. You can also call subs directly from the Call Queue.",
        after: "Each reply becomes a prepared call card with a script and quote capture.",
        cta: "Open Call Queue",
        href: "/call-queue",
        tone: "info",
        waitingOn: "subs",
      };
    case "call_queue":
      return {
        title: "Call the subcontractors",
        why: "Subs are ready to be called. Each call card opens a guided workspace that captures their price and answers in one pass.",
        after: "Saving a call's quote immediately re-prices the bid, no separate data entry.",
        cta: "Start calling",
        href: "/call-queue",
        tone: "action",
        waitingOn: "you",
      };
    case "quote_entry": {
      const missing = Math.max(0, s.requiredTradeCount - s.quoteCount);
      if (s.hasBid && !s.bidSubmitted)
        return {
          title: "Finish and submit the package",
          why: "The bid is priced and the submission package is assembled. Clear any remaining items (signatures, provided documents), then submit.",
          after: "Submitting starts outcome tracking; the platform reminds you when the agency announces.",
          cta: "Go to submission",
          anchor: "#submission",
          tone: "action",
          waitingOn: "you",
        };
      return {
        title:
          missing > 0 && s.requiredTradeCount > 0
            ? `Enter the remaining quote${missing === 1 ? "" : "s"} (${s.quoteCount} of ${s.requiredTradeCount} trades quoted)`
            : "Enter subcontractor quotes",
        why: "Type each sub's price into the Quote Entry card. The bid is priced automatically the moment quotes are saved.",
        after: "The Bid Builder assembles the full package (pricing, narrative, QA checklist) for your review.",
        cta: "",
        tone: "action",
        waitingOn: "you",
      };
    }
    case "bid_building":
      return s.hasBid
        ? {
            title: "Review the package and submit",
            why: "The bid is priced and the submission package is assembled with a compliance checklist. Clear any remaining required items, then submit.",
            after: "Submitting starts outcome tracking; the platform reminds you when the agency announces.",
            cta: "Go to submission",
            anchor: "#submission",
            tone: "action",
            waitingOn: "you",
          }
        : {
            title: "Nothing yet, pricing the bid",
            why: "The Bid Builder is aggregating quotes and pricing to your target margin. Refresh in a minute.",
            after: "You'll review the finished package and submit it.",
            cta: "",
            tone: "info",
            waitingOn: "system",
          };
    case "submitted":
      return {
        title: "Record the result when the agency announces",
        why: "A win sets up the contract automatically; a loss teaches the scoring system.",
        after: "Won creates the contract record with milestones; lost feeds the weekly Learning Loop.",
        cta: "",
        tone: "action",
        decision: "outcome",
        waitingOn: "agency",
      };
    default:
      return null;
  }
}

function lcFirst(s: string): string {
  return s.length ? s[0].toLowerCase() + s.slice(1) : s;
}
