import Link from "next/link";
import { ActionButton } from "./action-button";

/**
 * Stage-aware guidance shown at the top of the opportunity detail page.
 * Derives the single recommended next action from the record's actual state
 * so the operator never has to work out what comes next. When that next action
 * is a decision only the operator can make (pursue/pass, won/lost), the buttons
 * live right here in the banner, so the decision is one tap from the top of the
 * page on every device instead of buried in a card far down the mobile scroll.
 */
export function NextStepBanner({
  opportunityId,
  stage,
  tier,
  humanActionRequired,
  quoteCount,
  requiredTradeCount,
  hasBid,
  bidSubmitted,
  outcome,
  pastPerfBlocked,
}: {
  opportunityId: string;
  stage: string;
  tier: string | null;
  humanActionRequired: boolean;
  quoteCount: number;
  requiredTradeCount: number;
  hasBid: boolean;
  bidSubmitted: boolean;
  outcome: string | null;
  pastPerfBlocked: boolean;
}) {
  const step = deriveStep({
    stage,
    tier,
    humanActionRequired,
    quoteCount,
    requiredTradeCount,
    hasBid,
    bidSubmitted,
    outcome,
    pastPerfBlocked,
  });
  if (!step) return null;

  const hasLink = Boolean(step.cta && (step.href || step.anchor));

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 ${
        step.tone === "action"
          ? "border-accent/40 bg-accent-soft"
          : step.tone === "warn"
            ? "border-review/40 bg-review/5"
            : "border-border bg-surface"
      }`}
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">
          Next step: {step.title}
        </p>
        <p className="mt-0.5 text-sm text-slate-600">{step.why}</p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {step.decision === "triage" && (
          <>
            <ActionButton
              endpoint={`/api/opportunities/${opportunityId}/action`}
              body={{ action: "pursue" }}
              className="btn-success text-xs"
            >
              Pursue
            </ActionButton>
            <ActionButton
              endpoint={`/api/opportunities/${opportunityId}/action`}
              body={{ action: "dismiss" }}
              className="btn-danger text-xs"
              confirm="Dismiss this opportunity? It moves to the archive."
            >
              Dismiss
            </ActionButton>
          </>
        )}
        {step.decision === "outcome" && (
          <>
            <ActionButton
              endpoint={`/api/opportunities/${opportunityId}/outcome`}
              body={{ outcome: "won" }}
              className="btn-success text-xs"
              confirm="Mark as WON and create the contract?"
            >
              Mark won
            </ActionButton>
            <ActionButton
              endpoint={`/api/opportunities/${opportunityId}/outcome`}
              body={{ outcome: "lost" }}
              className="btn-danger text-xs"
              confirm="Mark this bid as lost?"
            >
              Mark lost
            </ActionButton>
          </>
        )}
        {hasLink && step.href && (
          <Link
            href={step.href}
            className={`${step.decision ? "btn-ghost" : "btn-primary"} text-xs`}
          >
            {step.cta} →
          </Link>
        )}
        {hasLink && !step.href && step.anchor && (
          <a
            href={step.anchor}
            className={`${step.decision ? "btn-ghost" : "btn-primary"} text-xs`}
          >
            {step.cta} {step.decision ? "" : "↓"}
          </a>
        )}
      </div>
    </div>
  );
}

interface StepInput {
  stage: string;
  tier: string | null;
  humanActionRequired: boolean;
  quoteCount: number;
  requiredTradeCount: number;
  hasBid: boolean;
  bidSubmitted: boolean;
  outcome: string | null;
  pastPerfBlocked: boolean;
}

function deriveStep(s: StepInput): {
  title: string;
  why: string;
  cta: string;
  href?: string;
  anchor?: string;
  tone: "action" | "warn" | "info";
  /** When set, the banner renders the matching decision buttons inline. */
  decision?: "triage" | "outcome";
} | null {
  if (s.stage === "won")
    return {
      title: "Nothing, this one is won 🎉",
      why: "The contract record was created. Track milestones and compliance from the Contracts page.",
      cta: "View contracts",
      href: "/contracts",
      tone: "info",
    };
  if (s.stage === "lost" || s.stage === "dismissed") return null;

  if (s.pastPerfBlocked)
    return {
      title: "Decide whether to pursue this as an exception",
      why: "The agency requires past performance from your company itself, which you can't show yet. Automation stopped so you can make the call: pursue anyway or dismiss.",
      cta: "See details below",
      anchor: "#attachments",
      tone: "warn",
      decision: "triage",
    };

  if (s.tier === "review" && s.humanActionRequired)
    return {
      title: "Decide: pursue or pass",
      why: "This scored in the borderline band. If you don't act before the timer, it auto-dismisses.",
      cta: "Read the brief",
      anchor: "#attachments",
      tone: "action",
      decision: "triage",
    };

  switch (s.stage) {
    case "monitoring":
    case "scoring":
      return {
        title: "Nothing yet, scoring is running",
        why: "The system is scoring this against your company profile. It becomes actionable within a few minutes.",
        cta: "",
        tone: "info",
      };
    case "analysis":
      return {
        title: "Nothing yet, the plain-English brief is being written",
        why: "The analyst is reading the solicitation and attachments. When it's done, sub research starts automatically.",
        cta: "",
        tone: "info",
      };
    case "sub_research":
      return {
        title: "Nothing yet, finding subcontractors",
        why: "The system is finding and verifying local subs for each required trade. They'll be emailed automatically.",
        cta: "",
        tone: "info",
      };
    case "outreach":
      return {
        title: "Wait for replies (or call ahead)",
        why: "Outreach emails are out, with an automatic 48-hour follow-up. Replies create call cards automatically. You can also call subs directly from the Call Queue.",
        cta: "Open Call Queue",
        href: "/call-queue",
        tone: "info",
      };
    case "call_queue":
      return {
        title: "Call the subcontractors",
        why: "Subs are ready to be called. Each call card opens a guided workspace that captures their price and answers in one pass.",
        cta: "Start calling",
        href: "/call-queue",
        tone: "action",
      };
    case "quote_entry": {
      const missing = Math.max(0, s.requiredTradeCount - s.quoteCount);
      if (s.hasBid && !s.bidSubmitted)
        return {
          title: "Finish and submit the package",
          why: "The bid is priced and the submission package is assembled. Clear any remaining items (signatures, provided documents), then submit.",
          cta: "Go to submission",
          anchor: "#submission",
          tone: "action",
        };
      return {
        title:
          missing > 0 && s.requiredTradeCount > 0
            ? `Enter the remaining quote${missing === 1 ? "" : "s"} (${s.quoteCount} of ${s.requiredTradeCount} trades quoted)`
            : "Enter subcontractor quotes",
        why: "Type each sub's price into the Quote Entry card. The bid is priced automatically the moment quotes are saved.",
        cta: "",
        tone: "action",
      };
    }
    case "bid_building":
      return s.hasBid
        ? {
            title: "Review the package and submit",
            why: "The bid is priced and the submission package is assembled with a compliance checklist. Clear any remaining required items, then submit.",
            cta: "Go to submission",
            anchor: "#submission",
            tone: "action",
          }
        : {
            title: "Nothing yet, pricing the bid",
            why: "The Bid Builder is aggregating quotes and pricing to your target margin. Refresh in a minute.",
            cta: "",
            tone: "info",
          };
    case "submitted":
      return {
        title: "Record the result when the agency announces",
        why: "A win sets up the contract automatically; a loss teaches the scoring system.",
        cta: "",
        tone: "action",
        decision: "outcome",
      };
    default:
      return null;
  }
}
