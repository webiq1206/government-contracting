import {describe,it,expect} from "vitest";
import {NextRequest} from "next/server";
import {middleware} from "../middleware";
import {assessAttachmentPackage} from "../lib/domain/attachment-package";
import {messageHasPendingDocumentLink,recipientDocumentLinkPending} from "../lib/domain/document-delivery-readiness";

describe("deferred document delivery preserves the current account gate",()=>{
  it("keeps signed-out document recipients behind the existing sign-in requirement",()=>{
    const response=middleware(new NextRequest("https://brostco.com/d/synthetic.invalid"));
    expect(response.headers.get("location")).toContain("/login");
    expect(middleware(new NextRequest("https://brostco.com/api/documents/synthetic/open")).status).toBe(401);
  });
  it("holds a readable source package because recipient access is still pending",()=>{
    const result=assessAttachmentPackage({files:[],links:[{name:"Synthetic scope",url:"https://brostco.test/d/synthetic.invalid",reachable:true}],expected:true});
    expect(result.ok).toBe(false);
    expect(result.problems).toContainEqual(expect.objectContaining({kind:"recipient_access_pending",blocking:true,message:expect.stringContaining("pending review")}));
  });
  it.each(["https://brostco.test/d/synthetic.invalid","/d/synthetic.invalid"])("recognizes deferred document routes: %s",url=>{
    expect(recipientDocumentLinkPending(url)).toBe(true);
    expect(messageHasPendingDocumentLink(`<p><a href="${url}">Synthetic scope</a></p>`)).toBe(true);
  });
  it("does not substitute another URL or block ordinary message text",()=>{
    expect(messageHasPendingDocumentLink("Thanks for your reply. We have recorded your decline.")).toBe(false);
    expect(messageHasPendingDocumentLink("https://brostco.com/privacy")).toBe(false);
    expect(recipientDocumentLinkPending("https://example.invalid/not-a-document-route")).toBe(false);
  });
});
