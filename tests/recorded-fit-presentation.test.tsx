import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { RecordedFitSummary } from "@/components/recorded-fit-summary";
import { CardPreviewBody, type CardPreviewData } from "@/components/card-preview";
import { ReviewBriefPanel } from "@/components/review-brief";
import { buildReviewBrief } from "@/lib/domain/review-brief";
import { buildNoticeBrief } from "@/lib/domain/notice-brief";

vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()})}));
vi.mock("@/components/toaster",()=>({useToast:()=>({push:vi.fn()})}));
vi.mock("@/components/workspace/workspace-keys",()=>({useWorkspaceShortcut:vi.fn()}));

const stale="75 points, AUTO-PURSUE, and weeks remaining";
it.each([62,null])("shows current score %s separately from both saved recommendation and summary",score=>{
 const html=renderToStaticMarkup(<RecordedFitSummary score={score} tier="review" recommendation={stale} summary="Another saved scoring explanation" badges={[{label:"Timing score: 10/10",tone:"neutral"}]}/>);
 const {document}=parseHTML(html);const details=document.querySelector('details')!;
 expect(details.hasAttribute('open')).toBe(false);expect(details.textContent).toContain(stale);
 expect(details.textContent).toContain("Another saved scoring explanation");
 expect(document.querySelector('h2')?.textContent).toBe("Current recorded fit");
 expect(html).toContain(score===null?"Current score unavailable":"Current recorded score: 62/100");
 expect(html.indexOf("has not been verified")).toBeLessThan(html.indexOf('<details'));
 expect(html).toContain("Verify their current relevance");
});
it("keeps notice-only fallback prose historical instead of promoting its copied recommendation",()=>{
 const notice=buildNoticeBrief({title:"Synthetic notice",scoreSummary:stale});
 const html=renderToStaticMarkup(<RecordedFitSummary score={62} tier="review" recommendation={notice.pursue_recommendation} summary={stale}/>);
 expect(parseHTML(html).document.querySelector('details')?.textContent).toContain(stale);
 expect(html.split('<details')[0]).not.toContain(stale);
});
it("does not invent an explanation or active tier for a closed record",()=>{
 const html=renderToStaticMarkup(<RecordedFitSummary score={null} tier="pursue" closed/>);
 expect(html).toContain("No saved fit explanation is available");expect(html).not.toContain("Recorded tier");
});
it("preserves the Sources Sought purpose without a pursuit recommendation",()=>{
 const html=renderToStaticMarkup(<RecordedFitSummary score={90} tier="pursue" researchOnly recommendation={stale}/>);
 expect(html).toContain("market research, not a bid opportunity");expect(html).not.toContain(stale);expect(html).not.toContain("Recorded tier");
});
it("escapes saved text as content",()=>{
 const html=renderToStaticMarkup(<RecordedFitSummary score={62} tier="review" recommendation={'<script>alert(1)</script>'}/>);
 expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');
});
it.each([62,null])("hover preview ignores old cached prose and uses the current score %s",score=>{
 const data={title:"Synthetic preview",agency:null,solicitationNumber:null,stageLabel:"Being scored",score,tier:"review",deadline:null,valueEstimated:null,why:stale,trades:[],tradesPriced:0,tradeCount:0,nextStep:null} satisfies CardPreviewData;
 const html=renderToStaticMarkup(<CardPreviewBody data={data}/>);
 expect(html).not.toContain(stale);expect(html).toContain(score===null?"Current score unavailable":"Current recorded score: 62/100");
});
it("hover preview keeps Sources Sought outside bid recommendations",()=>{
 const data={title:"Research notice",agency:null,solicitationNumber:null,stageLabel:"Being scored",score:90,isSourcesSought:true,tier:"pursue",deadline:null,valueEstimated:null,why:stale,trades:[],tradesPriced:0,tradeCount:3,nextStep:{title:"Pursue now",why:"Old action",waitingOn:"You"}} satisfies CardPreviewData;
 const html=renderToStaticMarkup(<CardPreviewBody data={data}/>);
 expect(html).toContain('market research, not a bid opportunity');expect(html).not.toContain('Pursue now');expect(html).not.toContain('trades needed');expect(html).not.toContain('Current recorded score');
});
it("labels shared Review and Workbench evidence historical without changing the decision controls",()=>{
 const brief=buildReviewBrief({score:62,dimensions:[{key:'timing',label:'Timing',points:10,max_points:10,reasoning:stale}],riskFlags:[],confidence:null,deadline:null,reviewExpiresAt:null,requiredTradeCount:null,valueKnown:false,pastPerfClassification:null,value:null,valueSource:null,conflicts:[],sourceLinks:[]});
 const html=renderToStaticMarkup(<ReviewBriefPanel opportunityId="synthetic" title="Synthetic review" subtitle="Saved evidence" brief={brief} canDecide={false} closeHref="/review" evidence={<p>{stale}</p>}/>);
 expect(html).toContain('Saved fit factors');expect(html).toContain('Saved score breakdown and source evidence');
 expect(html.indexOf('has not been verified')).toBeLessThan(html.indexOf(stale));
 expect(html).toContain('A team member with decision access can pursue or pass.');
});
