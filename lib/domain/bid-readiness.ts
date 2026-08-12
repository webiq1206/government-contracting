/**
 * Bid / solicitation readiness for the opportunity page. Pure so Today / tests
 * share the same rules. Percent and buckets reflect actual required checklist
 * items for this opportunity (not arbitrary weights).
 */

import { flagLabel } from "@/lib/flag-labels";

export type AttentionAction = {
  label: string;
  href?: string;
  modal?: "upload" | "contact-trade" | "enter-quote" | "retry-agent" | "review-missing";
  trade?: string;
  agent?: string;
};

export interface AttentionItem {
  key: string;
  label: string;
  why: string;
  /** Who must act: Brost Co automation, the Admin, or either. */
  who?: "brost" | "admin" | "either";
  /** How to resolve (plain English). */
  how?: string;
  href?: string;
  action?: AttentionAction;
  severity: "action" | "warn" | "info";
  /** Bucket for Submission Readiness UI. */
  bucket?: "complete" | "actionRequired" | "blocked";
}

export interface BidReadiness {
  quotesEntered: number;
  tradesNeeded: number;
  tradesWithQuotes: number;
  outOfRangeQuotes: number;
  hasBid: boolean;
  packageReady: boolean | null;
  /** 0-100 from completed required checklist items. */
  percent: number;
  complete: AttentionItem[];
  actionRequired: AttentionItem[];
  blocked: AttentionItem[];
  attention: AttentionItem[];
  summary: string;
}

export interface CompletenessMissing {
  key: string;
  what: string;
  why: string;
  retrievable?: "auto" | "admin" | "either";
  resolution?: string;
  critical?: boolean;
  action?: AttentionAction;
}

export function computeBidReadiness(input: {
  stage: string;
  status: string;
  deadline: string | null;
  riskFlags: string[];
  attentionFromBrief?: string[] | null;
  requiredTrades: string[];
  quotes: { trade: string | null; quote_amount?: number | null; is_out_of_range?: boolean | null }[];
  tradeCoverageUncovered: number;
  /** Per-trade rows for Required Pricing CTAs. */
  uncoveredTrades?: string[];
  tradeStatuses?: { trade: string; status: string; quotes: number; contacted: number; found: number }[];
  subsFound: number;
  hasBid: boolean;
  packageReady?: boolean | null;
  humanFlags?: string[] | null;
  humanActionRequired?: boolean;
  tier?: string | null;
  pastPerfBlocked?: boolean;
  completenessMissing?: CompletenessMissing[] | null;
  packageBlockers?: string[] | null;
}): BidReadiness {
  const quotesEntered = input.quotes.filter((q) => Number(q.quote_amount) > 0).length;
  const tradesNeeded = input.requiredTrades.length;
  const quotedTradeSet = new Set(
    input.quotes
      .filter((q) => Number(q.quote_amount) > 0)
      .map((q) => (q.trade ?? "").trim() || "General")
  );
  const tradesWithQuotes =
    tradesNeeded > 0
      ? input.requiredTrades.filter((t) => quotedTradeSet.has(t.trim())).length
      : quotedTradeSet.size;
  const outOfRangeQuotes = input.quotes.filter((q) => q.is_out_of_range).length;
  const uncoveredTrades =
    input.uncoveredTrades ??
    (tradesNeeded > 0
      ? input.requiredTrades.filter((t) => !quotedTradeSet.has(t.trim()))
      : []);

  const complete: AttentionItem[] = [];
  const actionRequired: AttentionItem[] = [];
  const blocked: AttentionItem[] = [];

  // Checklist for percent: completeness criticals + each required trade + package.
  type Check = { key: string; done: boolean };
  const checks: Check[] = [];

  for (const m of input.completenessMissing ?? []) {
    if (!m.critical) continue;
    checks.push({ key: `c-${m.key}`, done: false });
    const who =
      m.retrievable === "auto" ? "brost" : m.retrievable === "admin" ? "admin" : "either";
    actionRequired.push({
      key: `missing-${m.key}`,
      label: m.what,
      why: m.why,
      who,
      how: m.resolution,
      href: m.action?.href ?? "#attention",
      action: m.action ?? {
        label: "Review missing information",
        href: "#overview",
        modal: "review-missing",
      },
      severity: "action",
      bucket: "actionRequired",
    });
  }
  if ((input.completenessMissing ?? []).filter((m) => m.critical).length === 0) {
    checks.push({ key: "solicitation_complete", done: true });
    complete.push({
      key: "solicitation_complete",
      label: "Solicitation information complete",
      why: "Required notice fields and attachments are present for sourcing.",
      severity: "info",
      bucket: "complete",
    });
  }

  if (tradesNeeded > 0) {
    for (const trade of input.requiredTrades) {
      const done = quotedTradeSet.has(trade.trim());
      checks.push({ key: `trade-${trade}`, done });
      if (done) {
        complete.push({
          key: `trade-ok-${trade}`,
          label: `${trade} pricing`,
          why: "A positive quote is on file for this required scope.",
          severity: "info",
          bucket: "complete",
        });
      } else {
        const row = input.tradeStatuses?.find((t) => t.trade === trade);
        const notContacted = !row || row.found === 0 || row.contacted === 0;
        actionRequired.push({
          key: `trade-need-${trade}`,
          label: `${trade}: ${notContacted ? "not contacted yet" : "pricing still needed"}`,
          why: notContacted
            ? "No subcontractors have been successfully contacted for this trade."
            : "Subs were contacted, but Brost Co still needs a valid quote before submission.",
          who: "admin",
          how: notContacted
            ? "Find and contact subcontractors for this trade, or enter a quote if you already have one."
            : "Follow up, call from the queue, or enter the quote when it arrives.",
          href: notContacted ? "#coverage" : "#quotes",
          action: {
            label: notContacted
              ? `Find and contact ${trade} subcontractors`
              : `Enter ${trade} quote`,
            href: notContacted ? "#coverage" : "#quotes",
            modal: notContacted ? "contact-trade" : "enter-quote",
            trade,
          },
          severity: "action",
          bucket: "actionRequired",
        });
        if (input.hasBid) {
          blocked.push({
            key: `block-trade-${trade}`,
            label: `Final bid cannot complete until ${trade} pricing is received`,
            why: "Submission stays locked while any required trade lacks a quote.",
            who: "admin",
            how: `Obtain ${trade} pricing, then re-run Bid Builder.`,
            href: "#coverage",
            action: {
              label: `Resolve ${trade}`,
              href: "#coverage",
              modal: "enter-quote",
              trade,
            },
            severity: "action",
            bucket: "blocked",
          });
        }
      }
    }
  } else if (quotesEntered > 0) {
    checks.push({ key: "quotes", done: true });
    complete.push({
      key: "quotes-on-file",
      label: `${quotesEntered} quote${quotesEntered === 1 ? "" : "s"} on file`,
      why: "No formal required-trade list; using submitted quotes.",
      severity: "info",
      bucket: "complete",
    });
  }

  if (input.hasBid) {
    const pkgOk = input.packageReady === true && uncoveredTrades.length === 0;
    checks.push({ key: "package", done: pkgOk });
    if (pkgOk) {
      complete.push({
        key: "package_ready",
        label: "Submission package ready",
        why: "Compliance validation passed and required trades are priced.",
        severity: "info",
        bucket: "complete",
        href: "#submission",
      });
    } else {
      for (const b of input.packageBlockers ?? []) {
        blocked.push({
          key: `pkg-${b.slice(0, 40)}`,
          label: b,
          why: "Required for a responsive submission package.",
          who: "admin",
          how: "Clear this item in the Submission section.",
          href: "#submission",
          action: { label: "Open submission checklist", href: "#submission" },
          severity: "action",
          bucket: "blocked",
        });
      }
      if ((input.packageBlockers ?? []).length === 0 && input.packageReady === false) {
        actionRequired.push({
          key: "package",
          label: "Submission package not ready",
          why: "Required files or compliance checks are still outstanding.",
          who: "admin",
          how: "Open Submission and clear each blocker.",
          href: "#submission",
          action: { label: "Review submission package", href: "#submission" },
          severity: "action",
          bucket: "actionRequired",
        });
      }
    }
  } else {
    checks.push({ key: "package", done: false });
  }

  if (input.humanActionRequired && input.stage !== "dismissed") {
    if (input.pastPerfBlocked) {
      actionRequired.push({
        key: "human-past-perf",
        label: "Decide whether to pursue with prime-only past performance",
        why: "The agency wants past performance from your company itself. Automation stopped for your call.",
        who: "admin",
        how: "Use Pursue or Dismiss in the Next step banner.",
        href: "#next-step",
        action: { label: "Decide in Next step", href: "#next-step" },
        severity: "action",
        bucket: "actionRequired",
      });
    } else if (input.tier === "review") {
      actionRequired.push({
        key: "human-triage",
        label: "Decide: pursue or pass this borderline score",
        why: "This scored in the middle band. If you do not act before the timer, it auto-dismisses.",
        who: "admin",
        how: "Use Pursue or Dismiss in the Next step banner after reading the brief.",
        href: "#next-step",
        action: { label: "Decide in Next step", href: "#next-step" },
        severity: "action",
        bucket: "actionRequired",
      });
    } else if ((input.riskFlags ?? []).some((f) => f.includes("deadline"))) {
      actionRequired.push({
        key: "human-deadline",
        label: "Deadline pressure needs your judgment",
        why: "The close date is near relative to remaining work. Confirm pursuit still makes sense.",
        who: "admin",
        how: "Review Coverage and Pricing, then act from the Next step banner.",
        href: "#next-step",
        action: { label: "Open Next step", href: "#next-step" },
        severity: "action",
        bucket: "actionRequired",
      });
    } else {
      actionRequired.push({
        key: "human",
        label: "Your decision or input is needed",
        why: "Brost Co paused here for a judgment call or a missing human step.",
        who: "admin",
        how: "Use the Next step banner actions, or resolve the items listed above.",
        href: "#next-step",
        action: { label: "Open Next step", href: "#next-step" },
        severity: "action",
        bucket: "actionRequired",
      });
    }
  }

  for (const flag of input.riskFlags ?? []) {
    if (
      [
        "incomplete_solicitation",
        "missing_attachments",
        "unverified_scope",
        "unverified_value",
        "unverified_set_aside",
        "outreach_scope_too_thin",
        "outreach_docs_missing",
      ].includes(flag)
    ) {
      // Already represented via completeness / trade items when possible.
      if ((input.completenessMissing ?? []).length > 0) continue;
    }
    if (flag.startsWith("stalled_")) continue; // surfaced via Next step stall copy
    if (flag.startsWith("auto_retried_")) continue;
    actionRequired.push({
      key: `flag-${flag}`,
      label: flagLabel(flag),
      why: "Flagged during scoring or analysis. Review before you commit more effort.",
      who: "either",
      how: "Open Requirements flags or re-run the related agent after fixing source data.",
      href: "#requirements",
      action: {
        label: "Review in Requirements",
        href: "#requirements",
        modal: "review-missing",
      },
      severity: flag.includes("deadline") || flag.includes("expir") ? "action" : "warn",
      bucket: "actionRequired",
    });
  }

  for (const item of input.attentionFromBrief ?? []) {
    if (!item?.trim()) continue;
    actionRequired.push({
      key: `brief-${item.slice(0, 40)}`,
      label: item.trim(),
      why: "Called out in the plain-English bid brief.",
      who: "admin",
      how: "Read the brief and resolve or accept the risk.",
      href: "#brief",
      action: { label: "Open bid brief", href: "#brief" },
      severity: "warn",
      bucket: "actionRequired",
    });
  }

  if (
    ["sub_research", "outreach", "call_queue", "quote_entry"].includes(input.stage) &&
    input.subsFound === 0
  ) {
    actionRequired.push({
      key: "no-subs",
      label: "No subcontractors paired yet",
      why: "Sub Finder has not attached trades to this opportunity.",
      who: "either",
      how: "Re-run Sub Finder after the solicitation is complete, or add subs manually.",
      href: "#subs",
      action: {
        label: "Retry Sub Finder",
        href: "#subs",
        modal: "retry-agent",
        agent: "sub-finder",
      },
      severity: "action",
      bucket: "actionRequired",
    });
  }

  if (outOfRangeQuotes > 0) {
    actionRequired.push({
      key: "oor",
      label: `${outOfRangeQuotes} quote${outOfRangeQuotes === 1 ? "" : "s"} outside the expected range`,
      why: "A price looks unusually high or low versus comps. Review before you submit.",
      who: "admin",
      how: "Open Quotes and confirm or revise the out-of-range price.",
      href: "#quotes",
      action: { label: "Review quotes", href: "#quotes", modal: "enter-quote" },
      severity: "warn",
      bucket: "actionRequired",
    });
  }

  for (const f of input.humanFlags ?? []) {
    actionRequired.push({
      key: `hf-${f}`,
      label: flagLabel(f),
      why: "Raised while assembling the bid package.",
      who: "admin",
      how: "Open the package checklist and clear the flagged item.",
      href: "#submission",
      action: { label: "Open package checklist", href: "#submission" },
      severity: "warn",
      bucket: "actionRequired",
    });
  }

  const dedupe = (items: AttentionItem[]) => {
    const seen = new Set<string>();
    return items.filter((a) => {
      const k = a.label.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  const completeU = dedupe(complete);
  const actionU = dedupe(actionRequired);
  const blockedU = dedupe(blocked);
  const attention = [...blockedU, ...actionU].slice(0, 12);

  const doneCount = checks.filter((c) => c.done).length;
  const percent =
    checks.length === 0 ? 0 : Math.round((doneCount / checks.length) * 100);

  const parts = [
    tradesNeeded > 0
      ? `Quotes on ${tradesWithQuotes}/${tradesNeeded} trades`
      : `${quotesEntered} quote${quotesEntered === 1 ? "" : "s"} on file`,
    input.hasBid
      ? input.packageReady && uncoveredTrades.length === 0
        ? "Package ready"
        : "Package not ready"
      : "Bid not built yet",
    `Readiness ${percent}%`,
  ];

  return {
    quotesEntered,
    tradesNeeded,
    tradesWithQuotes,
    outOfRangeQuotes,
    hasBid: input.hasBid,
    packageReady: input.packageReady ?? null,
    percent,
    complete: completeU,
    actionRequired: actionU,
    blocked: blockedU,
    attention,
    summary: parts.join(" · "),
  };
}
