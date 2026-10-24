import {describe,it,expect} from "vitest";
import {fitContext,fitSendBlock,FitReviewSchema,reviewedFit} from "../lib/domain/subcontractor-fit";
import {syntheticFit} from "./helpers/subcontractor-fit";

const opp={id:"synthetic-opportunity",location_state:"AL",location_text:"Synthetic Range, AL",
  solicitation_analysis:{trade_scopes:[{trade:"Range Cleaning",work:"Remove lead residue from the indoor range surfaces and dispose of it under the stated handling rules."}]}};
const key=fitContext(opp,"synthetic-firm","Range Cleaning")!;
describe("source-reviewed subcontractor fit",()=>{
  it.each([
    {state:"AL",trade_categories:["Range Cleaning"],email_verified:true},
    {state:"ON",service_area_states:["AL"],google_rating:5},
    {distance_miles:1,trade_categories:["Range Cleaning"],source_confidence:"inferred"},
    {outreach_fit:{verified:true,source:"maps keyword"}},
  ])("does not promote discovery/address/email signals to fit",evidence=>expect(fitSendBlock(evidence,key)).not.toBeNull());
  it("requires both separately sourced, affirmed statements",()=>{
    expect(FitReviewSchema.safeParse({affirmed:true,serviceArea:{kind:"search_listing",reference:"search result",statement:"Nearby place listing matches the trade keyword."}}).success).toBe(false);
    expect(FitReviewSchema.safeParse({affirmed:false}).success).toBe(false);
  });
  it("accepts actual reviewed coverage regardless of the office's state",()=>{
    expect(fitSendBlock(syntheticFit(opp,"synthetic-firm","Range Cleaning"),key)).toBeNull();
  });
  it.each([
    {...opp,location_text:"A different range, AL"},
    {...opp,solicitation_analysis:{trade_scopes:[{trade:"Range Cleaning",work:"Remove and replace the range equipment, including calibration."}]}},
  ])("invalidates evidence when location or scope changes",changed=>{
    expect(fitSendBlock(syntheticFit(opp,"synthetic-firm","Range Cleaning"),fitContext(changed,"synthetic-firm","Range Cleaning"))).not.toBeNull();
  });
  it("does not transfer evidence between suppliers or trades",()=>{
    const evidence=syntheticFit(opp,"synthetic-firm","Range Cleaning");
    expect(fitSendBlock(evidence,fitContext(opp,"different-firm","Range Cleaning"))).not.toBeNull();
    expect(fitSendBlock(evidence,fitContext(opp,"synthetic-firm","Restoration"))).not.toBeNull();
  });
  it("holds missing locations and general-project fallback scope",()=>{
    expect(fitContext({...opp,location_text:null,location_state:null},"synthetic-firm","Range Cleaning")).toBeNull();
    expect(fitContext({...opp,solicitation_analysis:{scope_plain_language:"General construction scope only"}},"synthetic-firm","Range Cleaning")).toBeNull();
  });
  it("expires old review and rejects future-dated review",()=>{
    const now=new Date("2026-10-23T12:00:00Z");
    const review={affirmed:true as const,serviceArea:{kind:"supplier_reply" as const,reference:"synthetic-mail",statement:"We cover the synthetic project location."},
      capability:{kind:"confirmed_call" as const,reference:"synthetic-call",statement:"We perform all of the synthetic range cleaning scope."}};
    for(const date of ["2026-01-01T00:00:00Z","2026-10-24T00:00:00Z"])
      expect(fitSendBlock({outreach_fit:reviewedFit(review,key,"fixture-reviewer",new Date(date))},key,now)).not.toBeNull();
  });
});
