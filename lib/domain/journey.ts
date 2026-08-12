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
  system: "Brost Co",
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

/** done = past tense for completed chips; current = present tense while active. */
const STEP_META: Record<
  (typeof JOURNEY_STAGES)[number],
  { done: string; current: string; owner: Party }
> = {
  monitoring: { done: "Found", current: "Watching", owner: "system" },
  scoring: { done: "Scored", current: "Scoring", owner: "system" },
  analysis: { done: "Analyzed", current: "Analyzing", owner: "system" },
  sub_research: { done: "Subs found", current: "Finding subs", owner: "system" },
  outreach: { done: "Subs contacted", current: "Contacting subs", owner: "subs" },
  call_queue: { done: "Calls made", current: "Calls to make", owner: "you" },
  quote_entry: { done: "Quotes in", current: "Collecting quotes", owner: "you" },
  bid_building: { done: "Bid built", current: "Building the bid", owner: "you" },
  submitted: { done: "Submitted", current: "Awaiting award", owner: "agency" },
};

/** Plain-English stage label for badges and lists (never raw snake_case). */
export const STAGE_LABEL: Record<string, string> = {
  monitoring: "Watching",
  scoring: "Being scored",
  analysis: "Being analyzed",
  sub_research: "Finding subs",
  outreach: "Contacting subs",
  call_queue: "Calls to make",
  quote_entry: "Collecting quotes",
  bid_building: "Building the bid",
  submitted: "Submitted",
  won: "Won",
  lost: "Lost",
  dismissed: "Dismissed",
};

export function stageLabel(stage: string | null | undefined): string {
  if (!stage) return "Unknown";
  return STAGE_LABEL[stage] ?? stage.replace(/_/g, " ");
}

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

  return JOURNEY_STAGES.map((s, i) => {
    const status: JourneyStep["status"] =
      i < idx ? "done" : i === idx ? "current" : "upcoming";
    return {
      stage: s,
      label: status === "current" ? STEP_META[s].current : STEP_META[s].done,
      owner: STEP_META[s].owner,
      status,
    };
  });
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

export function stageTip(stage: string | null | undefined): string {
  if (!stage) return "Pipeline stage is not set yet.";
  const owner = stageParty(stage);
  const label = stageLabel(stage);
  if (!owner) return `${label}. This opportunity is out of the active pipeline.`;
  return `${label}. Ball is with ${PARTY_LABEL[owner]} right now.`;
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

/** Shared with stalled-pipeline-sweep so the banner and agent log agree. */
export const STALL_REASONING: Record<string, string> = {
  scoring:
    "Scoring never completed. The Scoring Engine may have errored or the Claude key may be missing; check its log and re-run it.",
  analysis:
    "The solicitation analysis never completed. Check the Solicitation Analyst's log and re-run it.",
  sub_research:
    "No subcontractor cleared verification for this opportunity. Needs operator attention (add subs or dismiss).",
  outreach:
    "No subcontractor replied after outreach + follow-up. Needs operator attention (call subs directly or dismiss).",
  bid_building:
    "Quotes were entered but the Bid Builder never priced the bid. Check its log and re-run it.",
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
  /** @deprecated Prefer tradesWithQuotes. Kept for older call sites. */
  quoteCount: number;
  requiredTradeCount: number;
  /** Distinct required trades that already have a positive quote. */
  tradesWithQuotes?: number;
  /** Required trades still missing a quote. */
  tradeCoverageUncovered?: number;
  hasBid: boolean;
  bidSubmitted: boolean;
  outcome: string | null;
  pastPerfBlocked: boolean;
  /** Operator flipped the master pause switch (Agents page). */
  automationPaused?: boolean;
  /** Hours since the record last changed; feeds stall detection. */
  hoursSinceUpdate?: number | null;
  /** Deadline passed without submission; the record was auto-archived. */
  expired?: boolean;
  /** At least one positive quote is on file. */
  hasQuotes?: boolean;
  /** Outreach exists only as draft/failed sends (no real contact yet). */
  outreachDraftOnly?: boolean;
  /** Opportunity risk_flags (for stalled_* and similar). */
  riskFlags?: string[] | null;
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

/**
 * True when the next step includes a concrete operator action: decision
 * buttons, a route, or an in-page anchor. Every opportunity should expose one.
 */
export function stepHasAction(step: NextStep): boolean {
  return Boolean(step.decision || (step.cta && (step.href || step.anchor)));
}

export function deriveStep(s: StepInput): NextStep {
  if (s.stage === "won")
    return {
      title: "Nothing, this one is won",
      why: "The contract record was created. Track milestones and compliance from the Contracts page.",
      after: "Contracts holds milestones, compliance items, and payment tracking for this win.",
      cta: "View contracts",
      href: "/contracts",
      tone: "info",
      waitingOn: "system",
    };
  if (s.stage === "lost")
    return {
      title: "This bid was marked lost",
      why: "The outcome is recorded. History, documents, and communications stay here for reference.",
      after: "Use Today or Opportunities to pick up the next open opportunity.",
      cta: "Back to Today",
      href: "/today",
      tone: "info",
      waitingOn: "system",
    };
  if (s.stage === "dismissed")
    return {
      title: "This opportunity was dismissed",
      why: "It is archived, not deleted. You can restore it from the activity history if you change your mind.",
      after: "Use Today or Opportunities to pick up the next open opportunity.",
      cta: "Back to Today",
      href: "/today",
      tone: "info",
      waitingOn: "system",
    };

  if (s.expired)
    return {
      title: "Nothing, this one expired",
      why: "The submission deadline passed before a bid went out, so the record was archived automatically. All documents, communications, and history are preserved here for reference.",
      after: "Nothing further happens; archived records are kept per your retention settings.",
      cta: "Browse opportunities",
      href: "/pipeline",
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

  // Truth-in-advertising overrides: "Brost Co is working on it" copy is a
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
    const stalledFlag = (s.riskFlags ?? []).find((f) => f.startsWith("stalled_"));
    if (stalledFlag || isStalled(s.stage, s.hoursSinceUpdate ?? null))
      return {
        title: "This looks stuck, check the automation log",
        why:
          STALL_REASONING[s.stage] ??
          `No activity for over ${STALL_HOURS[s.stage]} hours in a stage that normally completes sooner. The responsible agent may have hit an error or a missing API key.`,
        after: "The log shows the last run and its reasoning; Run now retries the agent immediately.",
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

function deriveStageStep(s: StepInput): NextStep {
  switch (s.stage) {
    case "monitoring":
      return {
        title: "No action required. Brost Co is preparing this opportunity",
        why: "The notice was just imported. Scoring against your company profile starts next.",
        after: "High scores start analysis automatically; borderline ones come back to you for a decision.",
        cta: "View brief",
        anchor: "#brief",
        tone: "info",
        waitingOn: "system",
      };
    case "scoring":
      return {
        title: "No action required. Brost Co is scoring this opportunity",
        why: "Brost Co is scoring this against your company profile. It becomes actionable within a few minutes.",
        after: "High scores start analysis automatically; borderline ones come back to you for a decision.",
        cta: "View brief",
        anchor: "#brief",
        tone: "info",
        waitingOn: "system",
      };
    case "analysis":
      return {
        title: "No action required. Brost Co is writing the plain-English brief",
        why: "The analyst is reading the solicitation and attachments. When it is done, sub research starts automatically.",
        after: "Sub research finds and verifies local subs for each required trade, then emails them.",
        cta: "View brief",
        anchor: "#brief",
        tone: "info",
        waitingOn: "system",
      };
    case "sub_research":
      if (
        s.outreachDraftOnly ||
        (s.riskFlags ?? []).includes("outreach_send_failed")
      ) {
        return {
          title: "Outreach could not send. Fix email setup or re-run outreach",
          why: "Sub research found candidates, but messages stayed as drafts because email transport is missing or the send failed.",
          after: "Once email works and outreach re-runs, Brost Co contacts subs and schedules follow-ups.",
          cta: "Review integrations",
          href: "/settings/integrations",
          tone: "warn",
          waitingOn: "you",
        };
      }
      return {
        title: "No action required. Brost Co is finding subcontractors",
        why: "Brost Co is finding and verifying local subs for each required trade. They will be emailed automatically.",
        after: "Replies create call cards for you; a 48-hour follow-up goes out on its own.",
        cta: "View trade coverage",
        anchor: "#coverage",
        tone: "info",
        waitingOn: "system",
      };
    case "outreach":
      if (s.outreachDraftOnly) {
        return {
          title: "Outreach could not send. Fix email setup or re-run outreach",
          why: "Messages are stored as drafts because email transport is missing or the send failed. Subs have not been contacted yet.",
          after: "Once email works and outreach re-runs, Brost Co sends messages and schedules 48-hour follow-ups.",
          cta: "Review integrations",
          href: "/settings/integrations",
          tone: "warn",
          waitingOn: "you",
        };
      }
      if (s.hasQuotes) {
        return {
          title: "Confirm quotes and finish remaining pricing",
          why: "At least one quote is already on file. Finish required trades so Bid Builder can price the package.",
          after: "When required trades are priced, Brost Co refreshes the bid package for your review.",
          cta: "Open required pricing",
          anchor: "#coverage",
          tone: "action",
          waitingOn: "you",
        };
      }
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
      if (s.hasQuotes && (s.tradeCoverageUncovered ?? 0) === 0 && s.requiredTradeCount > 0) {
        return {
          title: "Quotes are in. Finish and review the bid package",
          why: "Required trades have pricing. Move to the package checklist and clear any remaining items before submit.",
          after: "Submitting starts outcome tracking; Brost Co reminds you when the agency announces.",
          cta: "Go to submission",
          anchor: "#submission",
          tone: "action",
          waitingOn: "you",
        };
      }
      if (s.hasQuotes) {
        return {
          title: "Enter remaining quotes, then finish the package",
          why: "Some pricing is already on file. Complete required trades from Coverage or Quote Entry.",
          after: "When all required trades are priced, Bid Builder refreshes the package for review.",
          cta: "Open required pricing",
          anchor: "#coverage",
          tone: "action",
          waitingOn: "you",
        };
      }
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
      const tradesQuoted = s.tradesWithQuotes ?? s.quoteCount;
      const missing = Math.max(
        0,
        s.tradeCoverageUncovered ??
          (s.requiredTradeCount > 0 ? s.requiredTradeCount - tradesQuoted : 0)
      );
      if (s.hasBid && !s.bidSubmitted && missing === 0)
        return {
          title: "Finish and submit the package",
          why: "The bid is priced and the submission package is assembled. Clear any remaining items (signatures, provided documents), then submit.",
          after: "Submitting starts outcome tracking; the platform reminds you when the agency announces.",
          cta: "Go to submission",
          anchor: "#submission",
          tone: "action",
          waitingOn: "you",
        };
      if (s.hasBid && missing > 0) {
        return {
          title: `Obtain pricing for ${missing} remaining trade${missing === 1 ? "" : "s"}`,
          why: "A bid draft exists, but submission stays locked until every required trade has a quote.",
          after: "When all trades are priced, Bid Builder refreshes the package for final review.",
          cta: "Open required pricing",
          anchor: "#coverage",
          tone: "action",
          waitingOn: "you",
        };
      }
      return {
        title:
          missing > 0 && s.requiredTradeCount > 0
            ? `Enter the remaining quote${missing === 1 ? "" : "s"} (${tradesQuoted} of ${s.requiredTradeCount} trades quoted)`
            : "Enter subcontractor quotes",
        why: "Type each sub's price into Quote Entry. The bid is priced automatically when quotes are saved.",
        after: "The Bid Builder assembles the full package (pricing, narrative, QA checklist) for your review.",
        cta: "Open quotes",
        anchor: "#quotes",
        tone: "action",
        waitingOn: "you",
      };
    }
    case "bid_building":
      if (s.hasBid && (s.tradeCoverageUncovered ?? 0) > 0) {
        return {
          title: "Finish required trade pricing before submit",
          why: "The package cannot be submitted while required trades are still missing quotes.",
          after: "Once every trade is priced, clear remaining compliance items and submit.",
          cta: "Open required pricing",
          anchor: "#coverage",
          tone: "action",
          waitingOn: "you",
        };
      }
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
            cta: "View pricing",
            anchor: "#quotes",
            tone: "info",
            waitingOn: "system",
          };
    case "submitted":
      return {
        title: "Record the result when the agency announces",
        why: "A win sets up the contract automatically; a loss teaches the scoring system.",
        after: "Won creates the contract record with milestones; lost feeds the weekly Learning Loop.",
        cta: "Review package",
        anchor: "#submission",
        tone: "action",
        decision: "outcome",
        waitingOn: "agency",
      };
    default:
      return {
        title: "Review this opportunity",
        why: "Open the brief and decide the next move from the workspace below.",
        after: "Each stage surfaces a single recommended action at the top of this page.",
        cta: "View brief",
        anchor: "#brief",
        tone: "info",
        waitingOn: "you",
      };
  }
}

function lcFirst(s: string): string {
  return s.length ? s[0].toLowerCase() + s.slice(1) : s;
}
