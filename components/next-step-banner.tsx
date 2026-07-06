import Link from "next/link";

/**
 * Stage-aware guidance shown at the top of the opportunity detail page.
 * Derives the single recommended next action from the record's actual state
 * so the operator never has to work out what comes next.
 */
export function NextStepBanner({
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
      {step.href && (
        <Link href={step.href} className="btn-primary shrink-0 text-xs">
          {step.cta} →
        </Link>
      )}
      {!step.href && step.anchor && (
        <a href={step.anchor} className="btn-primary shrink-0 text-xs">
          {step.cta} ↓
        </a>
      )}
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
} | null {
  if (s.stage === "won")
    return {
      title: "Nothing — this one is won 🎉",
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
    };

  if (s.tier === "review" && s.humanActionRequired)
    return {
      title: "Decide: pursue or pass",
      why: "This scored in the borderline band. Use the Pursue / Dismiss buttons in the Triage card. If you don't act before the timer, it auto-dismisses.",
      cta: "Read the brief",
      anchor: "#attachments",
      tone: "action",
    };

  switch (s.stage) {
    case "monitoring":
    case "scoring":
      return {
        title: "Nothing yet — scoring is running",
        why: "The system is scoring this against your company profile. It becomes actionable within a few minutes.",
        cta: "",
        tone: "info",
      };
    case "analysis":
      return {
        title: "Nothing yet — the plain-English brief is being written",
        why: "The analyst is reading the solicitation and attachments. When it's done, sub research starts automatically.",
        cta: "",
        tone: "info",
      };
    case "sub_research":
      return {
        title: "Nothing yet — finding subcontractors",
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
          title: "Review the priced bid",
          why: "Quotes are in and the bid has been priced. Check the numbers and QA list in the Bid Package card, then submit.",
          cta: "",
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
            title: "Review the priced bid and submit",
            why: "The bid is priced to your target margin with a QA checklist. Fix anything marked ✗, then press Submit bid.",
            cta: "",
            tone: "action",
          }
        : {
            title: "Nothing yet — pricing the bid",
            why: "The Bid Builder is aggregating quotes and pricing to your target margin. Refresh in a minute.",
            cta: "",
            tone: "info",
          };
    case "submitted":
      return {
        title: "Record the result when the agency announces",
        why: "Mark it Won or Lost in the Bid Package card. A win sets up the contract automatically; a loss teaches the scoring system.",
        cta: "",
        tone: "info",
      };
    default:
      return null;
  }
}
