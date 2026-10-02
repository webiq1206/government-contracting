import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfidenceChip } from "../components/opportunity-facts";
import { ScoreBreakdownCard } from "../components/score-breakdown-card";
import { OpportunityStatusBar } from "../components/opportunity-status-bar";
import { describeScoreConfidence } from "../lib/domain/score-confidence";
import type { ScoreBreakdown } from "../lib/types";
const confidence={level:"high" as const,percent:100,known:["scope"],unknown:[],summary:"Every scoring fact is known."};
describe("score confidence is distinct from source reading", () => {
 it("never presents a high scoring-fact measurement as documents fully read", () => {
  const breakdown={data_confidence:confidence,dimensions:[],total:62} as unknown as ScoreBreakdown;
  const html=[renderToStaticMarkup(<ConfidenceChip breakdown={breakdown}/>),renderToStaticMarkup(<ScoreBreakdownCard breakdown={breakdown}/>),renderToStaticMarkup(<OpportunityStatusBar stageLabel="Being scored" deadline={null} score={62} scoreBreakdown={breakdown} owner={null} readinessPercent={0} packageReady={false} uncoveredTrades={1} riskFlags={null} nextAction={null}/>)];
  for(const text of html){expect(text).toContain("High score confidence");expect(text).not.toMatch(/Read in full|Notice read in full|\[object Object\]/);}
  expect(html[1]).toContain("100% of scoring facts known");expect(html[1]).toContain("Documents tab");
 });
 it("handles structured, legacy and absent measurements without coercion",()=>{
  expect(describeScoreConfidence(confidence)).toBe("High score confidence · 100% of scoring facts known");
  expect(describeScoreConfidence("medium")).toBe("Medium score confidence");
  for(const value of [undefined,null,{},"garbage",{level:"invalid",percent:100}])expect(describeScoreConfidence(value)).toBeNull();
  expect(describeScoreConfidence({level:"low",percent:NaN})).toBe("Low score confidence");
 });
});
