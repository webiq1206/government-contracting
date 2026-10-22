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
});
