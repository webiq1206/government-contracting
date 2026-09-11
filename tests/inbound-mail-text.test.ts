import { describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { decodeInboundText, inboundText } from "../lib/domain/inbound-text";
import { extractBodyText, extractDeliveryReportText } from "../lib/integrations/gmail";
import { parseBounce } from "../lib/domain/email-delivery";
import { combineReplyText } from "../lib/domain/reply-attachments";
import { creditView } from "../lib/domain/provider-usage";

const data = (text: string, encoding: BufferEncoding = "utf8") => Buffer.from(text, encoding).toString("base64url");

describe("incoming email text and delivery reports", () => {
  it("does not report Gmail throttling as an AI limit or hide a spending hold", () => {
    expect(creditView(["mailbox_rate_limit"], 100).state).not.toBe("throttled");
    expect(creditView(["mailbox_rate_limit","spending_limit"], 100).state).toBe("budget_held");
  });
  it("decodes UTF-16 mail using its declared charset, preserving quotes and names", () => {
    expect(extractBodyText({ mimeType: "text/plain", headers: [{name:"Content-Type",value:'text/plain; charset="UTF-16LE"'}],
      body: {data:data("José: $42,500.00\nIncludes labor.", "utf16le")} }))
      .toBe("José: $42,500.00\nIncludes labor.");
  });
  it("decodes BOM-marked text attachments and does not join digits across corrupt bytes", () => {
    expect(decodeInboundText(Buffer.from("\ufeffPrice: $42,500", "utf16le"))).toBe("Price: $42,500");
    expect(inboundText("Price: 10\0\0,000")).toBe("Price: 10��,000");
    expect(decodeInboundText(Buffer.from("safe\0text"), "unsupported-charset")).toBe("safe�text");
  });
  it("does not interpret a binary attachment as the message body", () => {
    expect(extractBodyText({mimeType:"application/pdf",body:{data:data("%PDF\0binary")}})).toBe("");
    expect(extractBodyText({mimeType:"multipart/mixed",parts:[
      {mimeType:"text/plain",filename:"scope.txt",body:{data:data("attachment")}},
      {mimeType:"text/plain",body:{data:data("Please see the scope.")}},
    ]})).toBe("Please see the scope.");
  });
  it("reads DSN recipients and original IDs from MIME siblings rather than guessing from the explanation", () => {
    const payload = {mimeType:"multipart/report",parts:[
      {mimeType:"text/plain",body:{data:data("Your email could not be delivered.")}},
      {mimeType:"message/delivery-status",body:{data:data("Final-Recipient: rfc822; quotes@example.test\nAction: failed\nStatus: 5.1.1\nDiagnostic-Code: smtp; 550 mailbox does not exist")}},
      {mimeType:"text/rfc822-headers",body:{data:data("Message-ID: <original@example.test>")}},
    ]};
    expect(extractBodyText(payload)).toBe("Your email could not be delivered.");
    expect(parseBounce(extractDeliveryReportText(payload))).toMatchObject({recipient:"quotes@example.test", originalMessageId:"<original@example.test>",permanent:true,status:"5.1.1"});
  });
  it("stores repaired body and attachment text in real PostgreSQL text and jsonb", async () => {
    const db = new PGlite();
    try {
      await db.exec("create table mail (body text, details jsonb)");
      await expect(db.query("insert into mail(body) values($1)", ["before\0after"])).rejects.toThrow();
      const text = combineReplyText("José's quote\0", "Labor: $42,500\0\nMaterials included");
      await db.query("insert into mail values($1,$2::jsonb)", [text,JSON.stringify({text})]);
      const rows = await db.query<{body:string;details:{text:string}}>("select * from mail");
      expect(rows.rows).toEqual([{body:text,details:{text}}]);
      expect(text).toContain("$42,500");
      expect(text).not.toContain("\0");
    } finally { await db.close(); }
  }, 30000);
});
