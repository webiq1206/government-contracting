/**
 * Pursue or pass a score in the 50-69 band.
 *
 * The model has to name the reasons and the fit checks it used. A missing
 * reason, a failed call, or an unusable response leaves the item in review.
 */
import { z } from "zod";
import { completeJson } from "./claude";
import type { BandDecision } from "../domain/band-decision";

const DecisionSchema = z.object({
  decision: z.enum(["pursue", "pass"]),
  reasons: z.array(z.string()),
  fit_criteria_checked: z.array(z.string()),
});

export interface BandDecisionInput {
  title: string | null;
  score: number;
  summary: string;
  deadline: string | null;
  notice: {
    naics: string | null;
    setAside: string | null;
    place: string | null;
    value: number | null;
  };
  company: {
    naics: string[];
    serviceAreas: string[];
    smallBusiness: boolean | null;
    certifications: string[];
    annualRevenue: number | null;
  };
}

export async function decideReviewBand(input: BandDecisionInput): Promise<BandDecision | null> {
  try {
    const { data } = await completeJson(
      [
        "You are deciding whether this government-contracting company should pursue one opportunity.",
        "The score is already computed and is in the 50-69 review band, below automatic pursuit.",
        "Compare the notice with the company profile: NAICS, geography, size, and set-aside.",
        "Choose pursue only when those facts fit and there is still time to price the work.",
        "Choose pass when the fit is weak or the deadline leaves no workable margin.",
        "reasons must be two or three sentences naming facts from the profile or the notice. Do not invent a price, a deadline, a certification, or a place.",
        "fit_criteria_checked lists the criteria you actually compared, such as naics, geography, size, set-aside, and deadline.",
        "",
        `Title: ${input.title ?? "Untitled"}`,
        `Score: ${input.score} out of 100`,
        `Response deadline: ${input.deadline ?? "unknown"}`,
        `Notice NAICS: ${input.notice.naics ?? "unknown"}`,
        `Notice set-aside: ${input.notice.setAside ?? "unknown"}`,
        `Notice place: ${input.notice.place ?? "unknown"}`,
        `Notice estimated value: ${input.notice.value ?? "unknown"}`,
        `Company NAICS: ${input.company.naics.join(", ") || "unknown"}`,
        `Company service areas: ${input.company.serviceAreas.join(", ") || "unknown"}`,
        `Company small business: ${input.company.smallBusiness == null ? "unknown" : input.company.smallBusiness ? "yes" : "no"}`,
        `Company certifications: ${input.company.certifications.join(", ") || "none listed"}`,
        `Company annual revenue: ${input.company.annualRevenue ?? "unknown"}`,
        `Scoring summary: ${input.summary}`,
      ].join("\n"),
      {
        schema: DecisionSchema,
        injectProfile: true,
        maxTokens: 500,
        complexity: "routine",
        feature: "review band decision",
        retries: 0,
      }
    );
    if (data.decision !== "pursue" && data.decision !== "pass") return null;
    const reasons = (data.reasons ?? []).map((reason) => reason.trim()).filter(Boolean);
    const fitCriteriaChecked = (data.fit_criteria_checked ?? [])
      .map((item) => item.trim())
      .filter(Boolean);
    if (reasons.join(" ").length < 20 || fitCriteriaChecked.length === 0) return null;
    return {
      choice: data.decision,
      reasons,
      fitCriteriaChecked,
      reasoning: reasons.join(" "),
    };
  } catch {
    return null;
  }
}
