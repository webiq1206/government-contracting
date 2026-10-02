import { describe, expect, it, vi } from "vitest";
const peek = vi.hoisted(() => vi.fn());
vi.mock("../lib/data", () => ({ oppPeek: peek, currentOrg: async () => "org-test", callCardById: vi.fn(), subPeek: vi.fn() }));
vi.mock("../lib/db", () => ({ query: async () => [] }));
import { opportunityQuickViewData } from "../lib/quick-view-data";
const id="00000000-0000-4000-8000-000000000009";
describe("quick view stored confidence", () => {
 it.each([
  [{level:"high",percent:100}, "High score confidence · 100% of scoring facts known"],
  ["medium", "Medium score confidence"],
  [null, null],
  [{unexpected:true}, null],
 ])("maps the persisted measurement into a readable fact", async (confidence, expected) => {
   peek.mockResolvedValue({opp:{id,title:"WebIQ QA Test",stage:"review",score_breakdown:{data_confidence:confidence}},requiredTrades:[],tradesRequired:0,tradesCovered:0,quoteCount:0,subsContacted:0,subsResponded:0,bidSubmitted:false,outcome:null});
   const result=await opportunityQuickViewData(id);
   const text=JSON.stringify(result?.view);
   expect(text).not.toContain("[object Object]");
   if(expected)expect(text).toContain(expected);
   else expect(text).not.toContain("score confidence");
 });
});
