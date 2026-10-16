/**
 * Pursue or pass a score that landed in the default review band.
 *
 * The model has to say why. A missing reason leaves the item for a person.
 */
import { z } from "zod";
import { completeJson } from "./claude";
import type { BandDecision } from "../domain/band-decision";

const DecisionSchema = z.object({
  decision: z.enum(["pursue", "pass"]),
  reasoning: z.string(),
});

export async function decideReviewBand(input: {
  title: string | null;
  score: number;
  summary: string;
  deadline: string | null;
}): Promise<BandDecision | null> {
  const { data } = await completeJson(
    [
      "You are deciding whether a government-contracting company should pursue one opportunity.",
      "The score is already computed and is in the 50-69 review band, below automatic pursuit.",
      "Choose pursue only when the notice is a plausible fit and there is still time to price it.",
      "Choose pass when the fit is weak, the scope is a poor match, or the deadline leaves no workable margin.",
      "reasoning must be two or three sentences naming the facts you used. Do not invent a price, a deadline, or a certification.",
      "",
      `Title: ${input.title ?? "Untitled"}`,
      `Score: ${input.score} out of 100`,
      `Response deadline: ${input.deadline ?? "unknown"}`,
      `Scoring summary: ${input.summary}`,
    ].join("\n"),
    {
      schema: DecisionSchema,
      injectProfile: false,
      maxTokens: 400,
      complexity: "routine",
      feature: "review band decision",
    }
  );
  const reasoning = data.reasoning.trim();
  if (reasoning.length < 20) return null;
  return { choice: data.decision, reasoning };
}
