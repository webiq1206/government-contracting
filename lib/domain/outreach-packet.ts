/**
 * Build a concise, trade-specific packet for subcontractor outreach emails.
 * Accurate to source analysis text; never invents requirements.
 */

import { isPlaceholderScope } from "./solicitation-completeness";
import { resolveSubWork } from "./sub-work";

export interface OutreachPacket {
  /** Ready for {{scope_summary}} after scrubbing. */
  scopeSummary: string;
  /** True when we must refuse to send. */
  tooThin: boolean;
  tradeSpecific: boolean;
  source: string;
}

export function buildOutreachPacket(input: {
  trade?: string | null;
  analysis?: {
    trade_scopes?: { trade: string; work: string }[] | null;
    draft_sow?: string | null;
    scope_plain_language?: string | null;
    project_overview?: string | null;
    location?: string | null;
    special_requirements?: string[] | null;
  } | null;
  description?: string | null;
  locationState?: string | null;
  locationText?: string | null;
  deadlineLabel?: string | null;
}): OutreachPacket {
  // Prefer full trade scope; soft-cap generously so quantities/specs survive.
  const subWork = resolveSubWork({
    trade: input.trade,
    analysis: input.analysis,
    description: input.description,
    maxChars: 1800,
  });

  const parts: string[] = [];
  if (subWork.work) parts.push(subWork.work);

  const location =
    input.analysis?.location?.trim() ||
    [input.locationText, input.locationState].filter(Boolean).join(", ");
  if (location && !isPlaceholderScope(location)) {
    parts.push(`Place of performance: ${location}.`);
  }
  if (input.deadlineLabel) {
    parts.push(`Our bid deadline is ${input.deadlineLabel}; please reply before then.`);
  }

  const specs = (input.analysis?.special_requirements ?? [])
    .map((s) => String(s).trim())
    .filter((s) => s && !isPlaceholderScope(s))
    .filter((s) => {
      // Keep short, trade-relevant constraints; skip long legal boilerplate.
      if (s.length > 220) return false;
      const trade = (input.trade ?? "").toLowerCase();
      if (!trade) return /wage|insurance|bond|license|schedule|material|spec/i.test(s);
      return (
        s.toLowerCase().includes(trade) ||
        /wage|insurance|bond|license|schedule|material|spec|install/i.test(s)
      );
    })
    .slice(0, 4);
  if (specs.length) {
    parts.push(`Related requirements: ${specs.join("; ")}.`);
  }

  parts.push(
    "Please quote this specific scope only. Include payment terms, lead time, and any exclusions."
  );

  const scopeSummary = parts.join(" ").replace(/\s+/g, " ").trim();
  return {
    scopeSummary,
    tooThin: isPlaceholderScope(subWork.work) || scopeSummary.length < 60,
    tradeSpecific: subWork.tradeSpecific,
    source: subWork.source,
  };
}
