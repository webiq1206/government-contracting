import {describe,it,expect} from "vitest";
import {classifyReplyNotice,authoredReplyText,explicitOptOut} from "../lib/domain/reply-notice";
import {parseBounce} from "../lib/domain/email-delivery";

describe("deterministic reply notices",()=>{
  it("reads a clear human decline without the quoted pricing request",()=>{
    expect(classifyReplyNotice({body:"Thank you for considering Example Jetters but we are not interested.\nThanks,\nSam\nOn Oct 22, Prime wrote:\nOur quote is $100. Can you bid?"}).kind).toBe("decline");
  });
  it.each(["We are not interested in this project.","We will pass.","No thanks."])("recognizes an unqualified decline: %s",body=>{
    expect(classifyReplyNotice({body}).kind).toBe("decline");
  });
  it.each(["We are not interested unless the scope changes.","We are not interested, but we can quote plumbing.","We are not interested. Our price for the other building is $400.","Are you not interested in our quote?"])("does not close ambiguous or partial work: %s",body=>{
    expect(classifyReplyNotice({body}).kind).toBe("human");
  });
  it("does not close a reply carrying an attachment",()=>expect(classifyReplyNotice({body:"We will pass.",attachmentNames:["alternate.pdf"]}).kind).toBe("human"));
  it.each(["Pass","No","Decline.","Declined","Not interested","No thank you"])("treats a whole-message bare decline as a decline: %s",body=>{
    expect(classifyReplyNotice({body}).kind).toBe("decline");
  });
  it("treats a bare Pass plus a signature as a decline and keeps a forwarding sentence open",()=>{
    expect(classifyReplyNotice({body:"Pass\nBest,\nChris Allen\nGeneral Manager\nBulldog Rooter, LLC"}).kind).toBe("decline");
    expect(classifyReplyNotice({body:"Pass this to estimating."}).kind).toBe("human");
    expect(classifyReplyNotice({body:"Pass\nWe will bid the plumbing."}).kind).toBe("human");
  });
  it.each([
    "We will pass your request to our estimating team.",
    "If the schedule slips, we will pass.",
    "We are not interested in the optional roof work. We will bid the plumbing.",
    "We are not interested in the optional roof work.",
    "No thanks required, we will send our bid tomorrow.",
    "No thanks, we already have the plans and are preparing a bid.",
    "No thanks, please send the drawings first.",
  ])("keeps forwarding, conditional and partial answers open: %s",body=>{
    expect(classifyReplyNotice({body}).kind).toBe("human");
  });
  it.each(["I'm no longer employed here. Contact Pat at pat@example.test.",
    "I’m no longer employed here. Contact Pat at pat@example.test.",
    "Joe is no longer with Example Construction. Please contact Pat."])("recognizes an explicit automatic departure: %s",body=>{
    expect(classifyReplyNotice({body,autoSubmitted:"auto-replied"}).kind).toBe("departed");
  });
  it.each(["Joe is no longer working on this project. Please contact Pat for this scope.",
    "I am no longer working weekends. I respond Monday through Friday."])("does not infer employment departure from changed work: %s",body=>{
    expect(classifyReplyNotice({body,autoSubmitted:"auto-replied"})).toMatchObject({kind:"automatic",needsReview:true});
  });
  it("records the departed contact separately from a temporary absence",()=>{
    expect(classifyReplyNotice({subject:"Automatic reply: scope",body:"Please note that Joe is no longer working at Example Construction. Contact Pat at pat@example.test."}).kind).toBe("departed");
    expect(classifyReplyNotice({autoSubmitted:"auto-replied",body:"I am out of the office Thursday and will respond upon my return."}).kind).toBe("away");
  });
  it("retains possible prices in automatic messages for review",()=>expect(classifyReplyNotice({subject:"Automatic reply",body:"Our price is $250. Joe is no longer working here."}).kind).toBe("automatic"));
  it("does not acknowledge an automatic decline",()=>expect(classifyReplyNotice({autoSubmitted:"auto-generated",body:"We are not interested."}).kind).toBe("automatic"));
  it("distinguishes opt-out from request refusal and ignores quoted instructions",()=>{
    expect(classifyReplyNotice({body:"We are not interested. Stop emailing me."}).kind).toBe("opt_out");
    expect(explicitOptOut("unsubscribe")).toBe(true);
    expect(explicitOptOut("Thanks.\nOn Tuesday, Other wrote:\nUnsubscribe me")).toBe(false);
    expect(authoredReplyText("Price attached\n> We will pass")).toBe("Price attached");
  });
});

describe("delivery causes without invented retries",()=>{
  it.each([
    ["5.1.1","550 5.1.1 Account does not exist","invalid_mailbox"],
    ["5.4.1","550 5.4.1 Recipient address rejected: Access denied","access_denied"],
    ["5.2.2","552 5.2.2 Inbox out of storage and inactive","mailbox_full"],
  ])("preserves failed %s cause",(status,diagnostic,cause)=>{
    expect(parseBounce(`Final-Recipient: rfc822; sub@example.test\nAction: failed\nStatus: ${status}\nDiagnostic-Code: smtp; ${diagnostic}`)).toMatchObject({status,permanent:true,disposition:"failed",cause});
  });
  it("does not call an ambiguous group failure temporary or an invalid mailbox",()=>{
    const r=parseBounce("The group you tried to contact may not exist, or you may not have permission to post messages to the group.");
    expect(r).toMatchObject({permanent:false,disposition:"unknown",cause:"group_restriction"});
    expect(r.reason).not.toMatch(/temporar|deferred/);
  });
  it("honors an explicit delayed action",()=>expect(parseBounce("Action: delayed\nStatus: 5.2.2")).toMatchObject({permanent:false,disposition:"delayed"}));
  it.each(["delivered","relayed","expanded"])("never turns a positive %s DSN into a failure",action=>{
    expect(parseBounce(`Action: ${action}\nStatus: 2.0.0`)).toMatchObject({permanent:false,disposition:"positive"});
  });
  it("holds an explicitly failed attempt whose last diagnostic was transient",()=>{
    expect(parseBounce("Action: failed\nStatus: 4.4.7\nDiagnostic-Code: smtp; Delivery time expired")).toMatchObject({permanent:false,disposition:"failed"});
  });
});
