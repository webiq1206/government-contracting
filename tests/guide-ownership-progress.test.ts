import { describe, expect, it } from 'vitest';
import { buildPageGuide, type GuideContextInput, type OpportunityGuideFacts } from '@/lib/domain/page-guide';
import { buildGuideAdapters } from '@/lib/guide/build-adapters';
import { verifiedGuideProgress, verifiedJourneyCompletion } from '@/lib/domain/guide-progress';
import { journeySteps } from '@/lib/domain/journey';
import { summarizeTradeCoverage } from '@/lib/domain/trade-coverage';
import type { ActionCenterData } from '@/lib/data';

const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const completeSource={analysisInputHash:'saved-source-hash',completeness:{ok:true,missing:[]}};
const emptyCoverage=()=>summarizeTradeCoverage({requiredTrades:['Roofing'],subs:[],quotes:[]});
function facts(overrides:Partial<OpportunityGuideFacts>={}): OpportunityGuideFacts {
  return {id,title:'Synthetic bid',stage:'call_queue',score:70,deadline:null,
    stepInput:{stage:'call_queue',status:'open',tier:'pursue',humanActionRequired:false,
      quoteCount:0,requiredTradeCount:1,tradesWithQuotes:0,tradeCoverageUncovered:1,
      hasBid:false,bidSubmitted:false,outcome:null,pastPerfBlocked:false,automationPaused:false,
      hoursSinceUpdate:0,callsEnabled:true,hasActiveSubs:false,unavailableSubLinks:19,pendingCallCount:0},
    progress:verifiedGuideProgress({sourceEvidence:{},subs:[],coverage:emptyCoverage()}),...overrides};
}
function guide(opportunity:OpportunityGuideFacts) {
  return buildPageGuide({pathname:`/opportunity/${id}`,setup:{items:[],done:0,total:0,complete:true},
    actions:{urgent:0,triage:0,calls:0,bidWork:0,subFollowUps:0,quoteReviews:0,compliance:0,approvals:0,totalActions:0},
    automationPaused:false,experience:'familiar',opportunity} as GuideContextInput);
}
const calls=[
  {id:'other-card',opportunity_id:'other',subcontractor_id:'owned',company_name:'Other bid'},
  {id:'unavailable-card',opportunity_id:id,subcontractor_id:'unavailable',company_name:'Unavailable'},
  {id:'valid-card',opportunity_id:id,subcontractor_id:'owned',company_name:'Owned'},
];
const actions={calls:{rows:calls},subFollowUps:calls.map(c=>({...c,phone:'555-0100',trade:'Roofing'}))} as unknown as ActionCenterData;

describe('Guide Me uses scoped evidence, not historical stage progression',()=>{
  it.each([true,false])('keeps the strip and Guide Me completion aligned with calling enabled=%s',callsEnabled=>{
    const subs=[{trade:'Roofing',verified:true,outreach_state:'followed_up',emails_sent:1,calls_logged:1}];
    const progress=verifiedGuideProgress({sourceEvidence:completeSource,subs,
      coverage:summarizeTradeCoverage({requiredTrades:['Roofing'],subs,quotes:[]})});
    const opportunity=facts({progress});
    opportunity.stepInput={...opportunity.stepInput,callsEnabled};
    const completion=verifiedJourneyCompletion({score:opportunity.score,progress,
      quoteCount:opportunity.stepInput.quoteCount,hasBid:opportunity.stepInput.hasBid,bidSubmitted:false});
    expect(guide(opportunity).completed).toEqual(journeySteps(opportunity.stage,{callsEnabled,completion})
      .filter(s=>s.status==='done').map(s=>s.label));
  });
  it('reproduces the zero-roster call_queue case as review only with no adapters or invented completion',()=>{
    const opportunity=facts();const g=guide(opportunity);
    expect(g.steps[0]).toMatchObject({kind:'highlight',target:'subs'});
    expect(g.steps[0].adapter).toBeUndefined();
    expect(g.steps.some(s=>s.kind==='open-call')).toBe(false);
    expect(g.completed).toEqual(['Found','Scored']);
    expect(buildGuideAdapters({guide:g,opportunity,actions,opportunitySubs:[],sub:null})).toEqual({});
  });
  it.each(['sent','followed_up','unresponsive','responsive'])('does not treat historical %s without receipts as successful contact',outreach_state=>{
    const subs=[{trade:'Roofing',verified:true,outreach_state,emails_sent:0,calls_logged:0}];
    const coverage=summarizeTradeCoverage({requiredTrades:['Roofing'],subs,quotes:[]});
    const progress=verifiedGuideProgress({sourceEvidence:completeSource,subs,coverage});
    expect(progress).toEqual({analysisComplete:true,subsFound:true,subsContacted:false,callsRecorded:false});
    expect(coverage.totals.contacted).toBe(0);expect(coverage.totals.followUpDue).toBe(0);
  });
  it('retains checked source and contact progress for a valid available roster',()=>{
    const subs=[{trade:'Roofing',verified:true,outreach_state:'followed_up',emails_sent:1,calls_logged:1}];
    const progress=verifiedGuideProgress({sourceEvidence:completeSource,subs,
      coverage:summarizeTradeCoverage({requiredTrades:['Roofing'],subs,quotes:[]})});
    expect(progress).toEqual({analysisComplete:true,subsFound:true,subsContacted:true,callsRecorded:true});
    expect(guide(facts({progress})).completed).toContain('Subs contacted');
    expect(verifiedGuideProgress({sourceEvidence:completeSource,subs:[],coverage:emptyCoverage()}).subsFound).toBe(false);
  });
  it('does not describe unreceipted historical outreach as sent messages awaiting replies',()=>{
    const opportunity=facts();opportunity.stage='outreach';
    opportunity.stepInput={...opportunity.stepInput,stage:'outreach',hasActiveSubs:true,unavailableSubLinks:0,recordedContactCount:0};
    const g=guide(opportunity);
    expect(g.steps[0].title).toBe('Review outreach before waiting for replies');
    expect(g.steps[0]).toMatchObject({kind:'highlight',target:'coverage'});
    expect(g.completed).not.toContain('Subs contacted');
  });
  it('scopes mixed action candidates to this opportunity and its available roster, without attaching an unrelated follow-up',()=>{
    const opportunity=facts();const g=guide(opportunity);
    g.steps=[{...g.steps[0],kind:'open-call',adapter:'call'}];
    const opts={guide:g,opportunity,actions,opportunitySubs:[{subcontractor_id:'owned',company_name:'Owned',trade:'Roofing'}],sub:null};
    expect(buildGuideAdapters(opts)).toEqual({call:{cardId:'valid-card',companyName:'Owned',opportunityTitle:undefined}});
    g.steps=[{...g.steps[0],adapter:'followUp'}];
    expect(buildGuideAdapters(opts).followUp?.subcontractorId).toBe('owned');
    expect(buildGuideAdapters({...opts,opportunitySubs:[]})).toEqual({});
  });
  it('keeps Today follow-up and call adapter types separate',()=>{
    const g=guide(facts());g.steps=[{...g.steps[0],kind:'open-call',adapter:'followUp'}];
    const result=buildGuideAdapters({guide:g,opportunity:null,actions,sub:null});
    expect(result.call).toBeUndefined();expect(result.followUp?.opportunityId).toBe('other');
  });
});
