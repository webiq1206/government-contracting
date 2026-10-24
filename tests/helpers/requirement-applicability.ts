import { groundRequirementApplicability, type RequirementApplicability } from "@/lib/domain/outreach-applicability";

/** Explicit synthetic notice evidence for existing recipient-rendering fixtures. */
export function scopedNoticeRequirement(text: string, source: RequirementApplicability["source"],
  options: { allTrades?: boolean; mandatory?: boolean } = {}): RequirementApplicability {
  return groundRequirementApplicability([{
    requirement: text, source, applies_to: "subcontractor", trades: ["HVAC"],
    all_trades: options.allTrades ?? true, mandatory: options.mandatory ?? true,
    source_quote: text,
  }], [], text)[0];
}
