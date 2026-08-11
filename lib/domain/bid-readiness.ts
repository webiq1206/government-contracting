/**
 * Compact "what's blocking this bid" signal for the opportunity page.
 * Pure so Today / tests can reuse the same rules.
 */

export interface AttentionItem {
  key: string;
  label: string;
  why: string;
  href?: string;
  severity: "action" | "warn" | "info";
}

export interface BidReadiness {
  quotesEntered: number;
  tradesNeeded: number;
  tradesWithQuotes: number;
  outOfRangeQuotes: number;
  hasBid: boolean;
  packageReady: boolean | null;
  attention: AttentionItem[];
  summary: string;
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
  subsFound: number;
  hasBid: boolean;
  packageReady?: boolean | null;
  humanFlags?: string[] | null;
  humanActionRequired?: boolean;
}): BidReadiness {
  const quotesEntered = input.quotes.filter((q) => Number(q.quote_amount) > 0).length;
  const tradesNeeded = input.requiredTrades.length;
  const tradesWithQuotes = new Set(
    input.quotes
      .filter((q) => Number(q.quote_amount) > 0)
      .map((q) => (q.trade ?? "").trim() || "General")
  ).size;
  const outOfRangeQuotes = input.quotes.filter((q) => q.is_out_of_range).length;

  const attention: AttentionItem[] = [];

  if (input.humanActionRequired && input.stage !== "dismissed") {
    attention.push({
      key: "human",
      label: "Your decision or input is needed",
      why: "The system paused here for a judgment call or missing human step.",
      href: "#next-step",
      severity: "action",
    });
  }

  for (const flag of input.riskFlags ?? []) {
    attention.push({
      key: `flag-${flag}`,
      label: flag.replace(/_/g, " "),
      why: "Flagged during scoring or analysis — review before you commit effort.",
      severity: flag.includes("deadline") || flag.includes("expir") ? "action" : "warn",
    });
  }

  for (const item of input.attentionFromBrief ?? []) {
    if (!item?.trim()) continue;
    attention.push({
      key: `brief-${item.slice(0, 40)}`,
      label: item.trim(),
      why: "Called out in the plain-English bid brief.",
      href: "#brief",
      severity: "warn",
    });
  }

  if (
    ["sub_research", "outreach", "call_queue", "quote_entry"].includes(input.stage) &&
    input.subsFound === 0
  ) {
    attention.push({
      key: "no-subs",
      label: "No subcontractors paired yet",
      why: "Sub Finder has not attached trades to this opportunity. Pursue (or re-run Sub Finder) so outreach can start.",
      href: "#subs",
      severity: "action",
    });
  }

  if (input.tradeCoverageUncovered > 0) {
    attention.push({
      key: "uncovered",
      label: `${input.tradeCoverageUncovered} trade${input.tradeCoverageUncovered === 1 ? "" : "s"} still need pricing`,
      why: "Bid Builder cannot finish a complete package until each required trade has a quote.",
      href: "#subs",
      severity: "action",
    });
  }

  if (outOfRangeQuotes > 0) {
    attention.push({
      key: "oor",
      label: `${outOfRangeQuotes} quote${outOfRangeQuotes === 1 ? "" : "s"} outside the expected range`,
      why: "A price looks unusually high or low versus comps — review before you submit.",
      href: "#quotes",
      severity: "warn",
    });
  }

  for (const f of input.humanFlags ?? []) {
    attention.push({
      key: `hf-${f}`,
      label: f.replace(/_/g, " "),
      why: "Raised while assembling the bid package.",
      href: "#submission",
      severity: "warn",
    });
  }

  if (input.hasBid && input.packageReady === false) {
    attention.push({
      key: "package",
      label: "Submission package not ready",
      why: "Required files or compliance checks are still outstanding.",
      href: "#submission",
      severity: "action",
    });
  }

  // Deduplicate by label
  const seen = new Set<string>();
  const unique = attention.filter((a) => {
    const k = a.label.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const parts = [
    tradesNeeded > 0
      ? `Quotes on ${tradesWithQuotes}/${tradesNeeded} trades`
      : `${quotesEntered} quote${quotesEntered === 1 ? "" : "s"} on file`,
    input.hasBid
      ? input.packageReady
        ? "Package ready"
        : "Package not ready"
      : "Bid not built yet",
  ];

  return {
    quotesEntered,
    tradesNeeded,
    tradesWithQuotes,
    outOfRangeQuotes,
    hasBid: input.hasBid,
    packageReady: input.packageReady ?? null,
    attention: unique.slice(0, 8),
    summary: parts.join(" · "),
  };
}
