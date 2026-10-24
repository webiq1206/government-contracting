import {describe,it,expect} from "vitest";
import {buildOutreachSections} from "../lib/domain/outreach-sections";
import {renderOutreachBrief} from "../lib/domain/outreach-email";
import {classifyReplyNotice} from "../lib/domain/reply-notice";
import {validateOutboundEmail} from "../lib/domain/outreach-validation";
import {currentInitialOutreachBody,INITIAL_OUTREACH_BODY,LEGACY_INITIAL_OUTREACH_BODY} from "../lib/domain/initial-outreach-template";

describe("concise initial invitation without invented facts",()=>{
  it("adapts only the exact shipped legacy default, preserving every custom introduction",()=>{
    expect(currentInitialOutreachBody(LEGACY_INITIAL_OUTREACH_BODY)).toBe(INITIAL_OUTREACH_BODY);
    expect(INITIAL_OUTREACH_BODY).not.toContain("attached");
    const custom=LEGACY_INITIAL_OUTREACH_BODY+"\nA custom project instruction.";
    expect(currentInitialOutreachBody(custom)).toBe(custom);
  });
  const vars={opportunity_title:"Synthetic alarm replacement",solicitation_number:"FIXTURE-2026",
    trade:"Alarm installation",location_city_state:"Synthetic Site, SD",quote_due_date:"Nov 1, 2026 at 3:00 PM MST",
    deadline:"Nov 5, 2026 at 3:00 PM MST",trade_scope_requirements:"- Replace 4 alarm panels.\n- Test the replaced panels.",
    subcontractor_requirements:"- Required: Maintain the existing system until changeover.",
    questions:"- Are you SDVOSB?\n- What are your payment terms?",scope_summary:"Replace panels and test them."};
  it("retains scope, sourced requirements and separate deadlines with one question",()=>{
    const rendered=renderOutreachBrief(buildOutreachSections({vars}));
    expect(rendered.plain).toContain("Replace 4 alarm panels.");
    expect(rendered.plain).toContain("Maintain the existing system until changeover.");
    expect(rendered.plain).toContain(vars.quote_due_date);expect(rendered.plain).toContain(vars.deadline);
    expect(rendered.plain.match(/\?/g)).toHaveLength(1);
    expect(rendered.plain).not.toMatch(/SDVOSB|payment terms|What to include|firm or an estimate|Agency:/);
    expect(rendered.plain).toContain("we will close this request");
    expect(rendered.html).toContain("<li");
    expect(rendered.plain.split(/\s+/).length).toBeLessThan(160);
  });
  it("does not drop a long mandatory requirement to meet a word limit",()=>{
    const necessary="Required: "+Array.from({length:150},(_,i)=>`condition${i}`).join(" ");
    expect(renderOutreachBrief(buildOutreachSections({vars:{...vars,subcontractor_requirements:necessary}})).plain).toContain(necessary);
  });
  it("uses a document link without claiming attachments or an award",()=>{
    const text=renderOutreachBrief(buildOutreachSections({vars,links:[{name:"Synthetic package",url:"https://example.invalid/d/synthetic"}]})).plain;
    expect(text).toContain("https://example.invalid/d/synthetic");
    expect(text).not.toMatch(/attached|too large|awarded|won the/);
  });
  it("holds stale template attachment claims rather than silently dropping an important document",()=>{
    const input={subject:"Synthetic project",body:"Please review the attached PDF.",vars:{},missingRequired:[],
      attachedNames:[],linkNames:["Scoped documents"],documentsExpected:true,quoteDueAt:null,deadlineAt:null};
    expect(validateOutboundEmail(input)).toContainEqual(expect.objectContaining({kind:"false_attachment_claim"}));
    expect(validateOutboundEmail({...input,body:"Review the complete scope, requirements, and attached bid documents."})).toContainEqual(expect.objectContaining({kind:"false_attachment_claim"}));
    expect(validateOutboundEmail({...input,body:"Review the project documents at the link. No PDF is attached."}).some(p=>p.kind==="false_attachment_claim")).toBe(false);
  });
});

describe("redacted service-mismatch replies before paid inference",()=>{
  it("records a prior-submission claim for receipt review without inventing a quote",()=>{
    expect(classifyReplyNotice({body:"We already submitted our quote.",requestedTrade:"Restoration"})).toMatchObject({kind:"prior_submission",needsReview:true});
  });
  it.each([
    {body:"Thank you. We do not provide this service.",requestedTrade:"Calibration Testing"},
    {body:"We provide guards, not alarm installation.",requestedTrade:"Alarm installation"},
    {body:"We do restoration, not range cleaning.",requestedTrade:"Range Cleaning"},
  ])("closes only an unqualified scoped refusal: $body",input=>expect(classifyReplyNotice(input).kind).toBe("decline"));
  it.each([
    {body:"We do restoration, not range cleaning. However we can price the repair work.",requestedTrade:"Range Cleaning"},
    {body:"We do restoration, not range cleaning.",requestedTrade:"Restoration"},
    {body:"I am not a disabled veteran.",requestedTrade:"Plumbing"},
    {body:"We need to verify the responsible project party before providing a quote.",requestedTrade:"Solar"},
    {body:"Our rate is $105/hour per worker, with 30% materials markup and Net 30.",requestedTrade:"Kitchen Maintenance"},
  ])("retains prerequisites, rates, prior submissions and ambiguity for review: $body",input=>expect(classifyReplyNotice(input).kind).toBe("human"));
});
