import { describe, it, expect, vi, afterEach } from "vitest";
import { looksLikeQuoteDoc, combineReplyText } from "@/lib/domain/reply-attachments";

const ref = (filename: string, mimeType: string) => ({
  filename,
  mimeType,
  attachmentId: "a1",
  size: 1000,
});

describe("choosing which attachments to open", () => {
  it("opens PDFs, which is how subs actually send quotes", () => {
    expect(looksLikeQuoteDoc(ref("Quote.pdf", "application/pdf"))).toBe(true);
    expect(looksLikeQuoteDoc(ref("Quote", "application/pdf"))).toBe(true);
    expect(looksLikeQuoteDoc(ref("bid.PDF", "application/octet-stream"))).toBe(true);
  });

  it("skips images, because a signature logo is not a quote", () => {
    expect(looksLikeQuoteDoc(ref("logo.png", "image/png"))).toBe(false);
    expect(looksLikeQuoteDoc(ref("scan.jpg", "image/jpeg"))).toBe(false);
  });
});

describe("combining body and document text", () => {
  it("leaves the body alone when nothing was attached", () => {
    expect(combineReplyText("See attached.", "")).toBe("See attached.");
  });

  it("labels document text so the model can tell it from the body", () => {
    const out = combineReplyText("See attached.", "--- Attached document: Q.pdf ---\n$42,000");
    expect(out).toContain("See attached.");
    expect(out).toContain("Attached document: Q.pdf");
  });
});

/**
 * The failure that matters most: a scanned PDF extracts to nothing. Reporting
 * it as read would tell the operator we looked at a quote we never saw.
 */
describe("reading attachments", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/integrations/gmail");
    vi.doUnmock("@/lib/integrations/pdf");
    vi.resetModules();
  });

  async function load(pdfText: string, buf: Buffer | null = Buffer.from("x")) {
    vi.resetModules();
    vi.doMock("@/lib/integrations/gmail", () => ({
      gmail: { getAttachment: vi.fn(async () => buf) },
    }));
    vi.doMock("@/lib/integrations/pdf", () => ({
      extractPdfText: vi.fn(async () => ({ text: pdfText, pages: 1 })),
    }));
    return import("@/lib/domain/reply-attachments");
  }

  it("reports a scanned PDF as unreadable rather than as read", async () => {
    const m = await load("   ");
    const res = await m.readReplyAttachments({
      messageId: "m1",
      attachments: [ref("Scan.pdf", "application/pdf")],
    });
    expect(res.read).toEqual([]);
    expect(res.unreadable).toEqual(["Scan.pdf"]);
    expect(res.text).toBe("");
  });

  it("reports a failed download as unreadable", async () => {
    const m = await load("$42,000 total", null);
    const res = await m.readReplyAttachments({
      messageId: "m1",
      attachments: [ref("Quote.pdf", "application/pdf")],
    });
    expect(res.unreadable).toEqual(["Quote.pdf"]);
  });

  it("returns the extracted text for a readable quote", async () => {
    const m = await load("Total price: $42,000 for grounds maintenance");
    const res = await m.readReplyAttachments({
      messageId: "m1",
      attachments: [ref("Quote.pdf", "application/pdf")],
    });
    expect(res.read).toEqual(["Quote.pdf"]);
    expect(res.text).toContain("$42,000");
  });

  it("does not open more than three documents and says which it skipped", async () => {
    const m = await load("Total price: $42,000");
    const res = await m.readReplyAttachments({
      messageId: "m1",
      attachments: [1, 2, 3, 4, 5].map((i) => ref(`Q${i}.pdf`, "application/pdf")),
    });
    expect(res.read).toHaveLength(3);
    expect(res.unreadable).toEqual(["Q4.pdf", "Q5.pdf"]);
  });

  it("ignores messages with no quote-like attachments", async () => {
    const m = await load("unused");
    const res = await m.readReplyAttachments({
      messageId: "m1",
      attachments: [ref("logo.png", "image/png")],
    });
    expect(res).toEqual({ text: "", read: [], unreadable: [] });
  });
});
