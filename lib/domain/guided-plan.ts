/**
 * The guided plan: an opportunity's whole life as one numbered checklist.
 *
 * The journey tracker says which stage a record is in, the Next-step banner
 * says the one action to take, and Submission Readiness lists open problems.
 * What none of them shows is the shape of the whole job: how many steps there
 * are, which are behind you, which is live right now, and which are stuck,
 * each with who does it and the button that moves it. This module computes
 * that model, pure, so the checklist the operator follows is testable without
 * a database.
 *
 * The active step is anchored to the pipeline stage, not to the first
 * unfinished predicate: a record can advance with an earlier step unfinished
 * (missing documents, an uncontacted trade), and those render as blocked
 * steps behind the current one instead of yanking "you are here" backwards.
 * This keeps the plan in agreement with the Next-step banner, which is also
 * stage-driven.
 */

import type { TradeCoverageSummary } from "./trade-coverage";
import type {
  PlanBlocker,
  PlanOwner,
  PlanStatus,
  PlanStep,
  StepPlan,
} from "./step-plan";

// The generic step-plan shape lives in step-plan.ts and is shared with the
// sub, contract, and call-queue plans; these re-exports keep existing
// opportunity-plan call sites working unchanged.
export { PLAN_OWNER_LABEL } from "./step-plan";
export type { PlanBlocker, PlanOwner, PlanStatus, PlanStep } from "./step-plan";
export type GuidedPlan = StepPlan;

export interface GuidedPlanInput {
  /** Scopes the call-queue link to this bid's calls when known. */
  opportunityId?: string;
  stage: string;
  tier: string | null;
  humanActionRequired: boolean;
  pastPerfBlocked: boolean;
  /** Deadline passed unsubmitted; the record was auto-archived. */
  expired: boolean;
  score: number | null;
  hasAnalysis: boolean;
  /** Critical missing items from solicitation completeness. */
  missingInfo: { what: string; how?: string }[];
  /** Per-trade coverage; only required trades matter for step completion. */
  coverage: Pick<TradeCoverageSummary, "trades">;
  /** Quotes on file (any trade), for jobs with no formal trade list. */
  quotesEntered: number;
  /** Outreach exists only as drafts/failed sends; subs were never reached. */
  outreachDraftOnly: boolean;
  callsEnabled: boolean;
  /** Prepared call cards still waiting to be made. */
  pendingCalls: number;
  hasBid: boolean;
  bidAmount: number | null;
  packageReady: boolean | null;
  /** Validation blockers + unacknowledged audit blockers, already merged. */
  packageBlockers: string[];
  /** compliance_matrix rows still needing a signature. */
  needsSignature: number;
  /** compliance_matrix rows the operator must supply. */
  needsProvide: number;
  bidSubmitted: boolean;
  outcome: string | null;
}

interface StepDef {
  key: string;
  title: string;
  plain: string;
  owner: PlanOwner;
}

/** The thirteen steps, in order. Owner is who works while the step is live. */
const STEP_DEFS: StepDef[] = [
  {
    key: "find",
    title: "Find the opportunity",
    plain: "Brost Co watches the government listings and pulls in jobs that fit your company.",
    owner: "brost",
  },
  {
    key: "score",
    title: "Score the fit",
    plain: "The job is graded against your trades, service area, and size, 0 to 100.",
    owner: "brost",
  },
  {
    key: "pursue",
    title: "Decide to pursue",
    plain: "High scores go ahead on their own; borderline ones wait for your yes or no.",
    owner: "you",
  },
  {
    key: "brief",
    title: "Understand the job",
    plain: "The solicitation and its attachments become a plain-English brief with the work split by trade.",
    owner: "brost",
  },
  {
    key: "missing",
    title: "Check nothing is missing",
    plain: "The documents are checked for gaps, like a missing drawing or an unstated deadline.",
    owner: "you",
  },
  {
    key: "subs",
    title: "Find subs for every trade",
    plain: "Local subcontractors are found and verified for each kind of work the job needs.",
    owner: "brost",
  },
  {
    key: "contact",
    title: "Contact the subs",
    plain: "Each sub gets an email describing their piece of the work, with an automatic follow-up.",
    owner: "brost",
  },
  {
    key: "prices",
    title: "Collect the prices",
    plain: "Every trade needs one written price from a sub before the bid can be figured.",
    owner: "you",
  },
  {
    key: "price",
    title: "Price the bid",
    plain: "The quotes are added up and marked up to your target margin, giving your bid number.",
    owner: "brost",
  },
  {
    key: "package",
    title: "Build the package",
    plain: "The bid PDF, pricing schedule, forms, and letters are assembled in submission order.",
    owner: "brost",
  },
  {
    key: "checklist",
    title: "Sign and finish the checklist",
    plain: "Anything only a person can do: signatures, official forms, and documents you must supply.",
    owner: "you",
  },
  {
    key: "submit",
    title: "Submit the bid",
    plain: "Send the package to the agency the way the solicitation says, then mark it submitted.",
    owner: "you",
  },
  {
    key: "result",
    title: "Record the result",
    plain: "When the agency announces, a win sets up the contract and a loss teaches the scoring.",
    owner: "agency",
  },
];

export const PLAN_STEP_COUNT = STEP_DEFS.length;

/** Which step is live for a pipeline stage. Triage overrides are separate. */
function anchorKey(s: GuidedPlanInput): string {
  if (s.tier === "review" && s.humanActionRequired) return "pursue";
  if (s.pastPerfBlocked) return "pursue";
  switch (s.stage) {
    case "monitoring":
    case "scoring":
      return "score";
    case "analysis":
      return "brief";
    case "sub_research":
      return "subs";
    case "outreach":
      return "contact";
    case "call_queue":
      return "prices";
    case "quote_entry":
      return "prices";
    case "bid_building":
      if (!s.hasBid) return "price";
      return s.packageReady === true ? "submit" : "checklist";
    case "submitted":
      return "result";
    default:
      return "score";
  }
}

export function buildGuidedPlan(input: GuidedPlanInput): GuidedPlan {
  const requiredTrades = input.coverage.trades;
  const n = requiredTrades.length;
  const tradesWithSubs = requiredTrades.filter((t) => t.found > 0).length;
  const tradesContacted = requiredTrades.filter((t) => t.contacted > 0).length;
  const tradesQuoted = requiredTrades.filter((t) => t.quotes > 0).length;
  const terminal =
    input.stage === "won" || input.stage === "lost" || input.stage === "dismissed";
  const decided = input.outcome === "won" || input.outcome === "lost" || input.outcome === "no_award";

  // Won/lost necessarily passed through every step; dismissed/expired closed
  // early and render as a closed plan rather than a fake position.
  const allDone =
    input.stage === "won" || input.stage === "lost" || (input.bidSubmitted && decided);

  // -------------------------------------------------------------------------
  // Per-step completion, independent of position.
  // -------------------------------------------------------------------------
  const donePredicates: Record<string, boolean> = {
    find: true,
    score: input.score != null,
    pursue:
      input.score != null &&
      !(input.tier === "review" && input.humanActionRequired) &&
      !input.pastPerfBlocked &&
      !["monitoring", "scoring"].includes(input.stage),
    brief: input.hasAnalysis,
    missing: input.hasAnalysis && input.missingInfo.length === 0,
    subs: input.hasAnalysis && (n === 0 || tradesWithSubs === n),
    contact:
      input.hasAnalysis && !input.outreachDraftOnly && (n === 0 || tradesContacted === n),
    prices: n > 0 ? tradesQuoted === n : input.quotesEntered > 0 || input.hasBid,
    price: input.hasBid && (input.bidAmount ?? 0) > 0,
    package: input.hasBid,
    checklist: input.hasBid && input.packageReady === true,
    submit: input.bidSubmitted,
    result: decided,
  };

  // -------------------------------------------------------------------------
  // Per-step problems (blockers), independent of position.
  // -------------------------------------------------------------------------
  const blockersByKey: Record<string, PlanBlocker[]> = {};

  if (input.pastPerfBlocked) {
    blockersByKey.pursue = [
      {
        what: "The agency wants proof your company itself has done similar work, which you cannot show yet.",
        how: "Decide: pursue it anyway as an exception, or dismiss it. Use the buttons in the Next step banner.",
        href: "#next-step",
      },
    ];
  }

  if (input.missingInfo.length > 0) {
    blockersByKey.missing = input.missingInfo.map((m) => ({
      what: m.what,
      how: m.how ?? "Review the missing item and supply it or accept the gap.",
      href: "#attention",
    }));
  }

  const emptyTrades = requiredTrades.filter((t) => t.found === 0);
  if (input.hasAnalysis && emptyTrades.length > 0) {
    blockersByKey.subs = emptyTrades.map((t) => ({
      what: `No subcontractors found for ${t.trade}.`,
      how: "Open Coverage and add or contact subs for this trade, or enter a quote you already have.",
      href: "#coverage",
    }));
  }

  if (input.outreachDraftOnly) {
    blockersByKey.contact = [
      {
        what: "The outreach emails could not send, so no sub has actually been contacted.",
        how: "Fix email in Settings, then re-run outreach from the Agents page.",
        href: "/settings/integrations",
      },
    ];
  }

  // A bid exists but required trades still lack quotes: submission is locked
  // on those prices, so the step is a named problem, not a queue position.
  if (input.hasBid && n > 0 && tradesQuoted < n) {
    blockersByKey.prices = requiredTrades
      .filter((t) => t.quotes === 0)
      .map((t) => ({
        what: `${t.trade} still has no price.`,
        how: "Enter the quote when it arrives, or follow up with the subs from Coverage.",
        href: "#quotes",
      }));
  }

  if (input.hasBid && input.packageReady !== true) {
    const items: PlanBlocker[] = input.packageBlockers.map((b) => ({
      what: b,
      how: "Clear this item in the Submission section, then mark it complete.",
      href: "#submission",
    }));
    if (items.length === 0 && input.needsSignature + input.needsProvide > 0) {
      if (input.needsSignature > 0)
        items.push({
          what: `${input.needsSignature} document${input.needsSignature === 1 ? "" : "s"} still need${input.needsSignature === 1 ? "s" : ""} your signature.`,
          how: "Open the Submission section, sign each prefilled form, and mark it complete.",
          href: "#submission",
        });
      if (input.needsProvide > 0)
        items.push({
          what: `${input.needsProvide} required item${input.needsProvide === 1 ? "" : "s"} only you can supply.`,
          how: "Open the Submission section and provide each listed item.",
          href: "#submission",
        });
    }
    if (items.length > 0) blockersByKey.checklist = items;
  }

  // -------------------------------------------------------------------------
  // Position: which step is live.
  // -------------------------------------------------------------------------
  const activeKey = terminal || input.expired || allDone ? null : anchorKey(input);
  const activeIdx = activeKey ? STEP_DEFS.findIndex((d) => d.key === activeKey) : -1;

  // -------------------------------------------------------------------------
  // Per-step details and actions.
  // -------------------------------------------------------------------------
  const detailFor = (key: string): string | undefined => {
    switch (key) {
      case "score":
        return input.score != null ? `Scored ${input.score} of 100` : undefined;
      case "pursue":
        if (donePredicates.pursue)
          return input.tier === "review" ? "You chose to pursue" : "Pursued automatically on a strong score";
        return input.tier === "review" && input.humanActionRequired
          ? "Borderline score, your call"
          : undefined;
      case "missing":
        if (!input.hasAnalysis) return undefined;
        return input.missingInfo.length === 0
          ? "Nothing critical is missing"
          : `${input.missingInfo.length} item${input.missingInfo.length === 1 ? "" : "s"} missing`;
      case "subs":
        return n > 0 ? `${tradesWithSubs} of ${n} trades have subs` : undefined;
      case "contact":
        return n > 0 ? `${tradesContacted} of ${n} trades contacted` : undefined;
      case "prices":
        if (n > 0) return `${tradesQuoted} of ${n} trades priced`;
        return input.quotesEntered > 0
          ? `${input.quotesEntered} quote${input.quotesEntered === 1 ? "" : "s"} on file`
          : undefined;
      case "checklist":
        if (!input.hasBid) return undefined;
        // A won/lost record can carry a stale packageReady; a done step must
        // not claim items are still open.
        if (input.packageReady === true || allDone) return "Every required item is complete";
        return `${(blockersByKey.checklist ?? []).length || "Some"} item${(blockersByKey.checklist ?? []).length === 1 ? "" : "s"} still open`;
      case "result":
        if (input.outcome === "won") return "Won";
        if (input.outcome === "lost") return "Lost";
        if (input.outcome === "no_award") return "No award made";
        return input.bidSubmitted ? "Waiting for the agency to announce" : undefined;
      default:
        return undefined;
    }
  };

  const actionFor = (key: string, status: PlanStatus): PlanStep["action"] => {
    if (status === "done" || status === "upcoming") return undefined;
    switch (key) {
      case "pursue":
        return { label: "Pursue or pass", href: "#next-step" };
      case "brief":
        return { label: "Read the brief", href: "#brief" };
      case "missing":
        return { label: "See what is missing", href: "#attention" };
      case "subs":
        return { label: "Open trade coverage", href: "#coverage" };
      case "contact":
        return input.outreachDraftOnly
          ? { label: "Fix email setup", href: "/settings/integrations" }
          : { label: "Open trade coverage", href: "#coverage" };
      case "prices":
        if (input.callsEnabled && input.pendingCalls > 0)
          return {
            label: "Start calling",
            href: input.opportunityId
              ? `/call-queue?opportunity=${encodeURIComponent(input.opportunityId)}`
              : "/call-queue",
          };
        return { label: "Enter quotes", href: "#quotes" };
      case "checklist":
        return { label: "Open the checklist", href: "#submission" };
      case "submit":
        return { label: "Go to submission", href: "#submission" };
      case "result":
        return { label: "Record won or lost", href: "#submission" };
      default:
        return undefined;
    }
  };

  // Owner overrides where the live state changes who is actually working.
  const ownerFor = (key: string): PlanOwner => {
    const def = STEP_DEFS.find((d) => d.key === key)!;
    if (key === "prices" && !donePredicates.prices) {
      // Email-only accounts wait on replies; calling accounts work the queue.
      if (!input.callsEnabled && tradesQuoted === 0 && input.quotesEntered === 0)
        return "subs";
    }
    return def.owner;
  };

  const steps: PlanStep[] = STEP_DEFS.map((def, i) => {
    const blockers = blockersByKey[def.key];
    let status: PlanStatus;
    if (allDone || donePredicates[def.key]) {
      status = "done";
    } else if (activeIdx >= 0 && i === activeIdx) {
      status = blockers?.length ? "blocked" : "current";
    } else if (activeIdx >= 0 && i < activeIdx) {
      // The pipeline moved on with this unfinished. With a named problem it
      // renders blocked; without one there is nothing to alarm about (e.g.
      // an optional path that never applied), so it stays quietly pending.
      status = blockers?.length ? "blocked" : "upcoming";
    } else if (blockers?.length) {
      status = "blocked";
    } else {
      status = "upcoming";
    }
    return {
      key: def.key,
      n: i + 1,
      title: def.title,
      plain: def.plain,
      status,
      owner: ownerFor(def.key),
      detail: detailFor(def.key),
      action: actionFor(def.key, status),
      blockers: status === "done" ? undefined : blockers,
    };
  });

  const done = steps.filter((s) => s.status === "done").length;
  const active = activeIdx >= 0 ? steps[activeIdx] : undefined;

  let closed: GuidedPlan["closed"];
  if (input.stage === "dismissed") {
    closed = {
      label: "Passed",
      note: "This opportunity was passed on. It is archived, not deleted, and can be restored.",
    };
  } else if (input.expired) {
    closed = {
      label: "Expired",
      note: "The deadline passed before a bid went out, so the record was archived automatically.",
    };
  }

  const headline = closed
    ? closed.label
    : done === steps.length
      ? `All ${steps.length} steps are done`
      : active
        ? `Step ${active.n} of ${steps.length}: ${active.title}`
        : `${done} of ${steps.length} steps done`;

  return { steps, done, total: steps.length, active, headline, closed };
}
