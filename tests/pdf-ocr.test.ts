/**
 * Scanned solicitations. A third of the packets that matter are photocopies
 * with no text layer, and before transcription existed the analyst read
 * nothing out of them and the compliance matrix came from the portal blurb.
 * These tests hold the two properties that make the reading trustworthy:
 * every page is actually sent, and anything that could NOT be read says so
 * instead of quietly leaving a hole.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PDFDocument } from "pdf-lib";

const complete = vi.fn();
vi.mock("../lib/ai/claude", () => ({
  complete: (...args: unknown[]) => complete(...args),
  ClaudeNotConfiguredError: class ClaudeNotConfiguredError extends Error {},
}));

import { ocrPdf } from "../lib/integrations/pdf-ocr";

async function pdfOf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
  return doc.save();
}

beforeEach(() => {
  complete.mockReset();
});

describe("ocrPdf", () => {
  it("sends every page as a document block and joins the transcripts", async () => {
    const bytes = await pdfOf(20);
    complete.mockImplementation(async () => ({
      text: "--- page 1 ---\nSECTION L, INSTRUCTIONS TO OFFERORS",
      usage: { input_tokens: 1, output_tokens: 1, model: "m" },
      stopReason: null,
    }));

    const res = await ocrPdf(bytes, { label: "Scanned RFQ.pdf" });

    // 20 pages at 15 per batch is two requests, and both carry real PDF bytes.
    expect(complete).toHaveBeenCalledTimes(2);
    for (const call of complete.mock.calls) {
      const opts = call[1] as { documents?: { base64: string }[]; injectProfile?: boolean };
      expect(opts.documents).toHaveLength(1);
      const raw = Buffer.from(opts.documents![0].base64, "base64");
      expect(raw.subarray(0, 5).toString()).toBe("%PDF-");
      // Base64 with newlines is rejected by the API.
      expect(opts.documents![0].base64).not.toMatch(/\n/);
      // The company profile is our own marketing copy; injecting it into a
      // transcription prompt is the surest way to have our boilerplate
      // "recognized" on a page that never contained it.
      expect(opts.injectProfile).toBe(false);
    }
    expect(res.pagesTotal).toBe(20);
    expect(res.pagesRead).toBe(20);
    expect(res.truncated).toBe(false);
    expect(res.text).toContain("SECTION L");
  });

  it("instructs the model never to guess an unreadable value", async () => {
    complete.mockResolvedValue({
      text: "x",
      usage: { input_tokens: 1, output_tokens: 1, model: "m" },
      stopReason: null,
    });
    await ocrPdf(await pdfOf(1));
    const prompt = complete.mock.calls[0][0] as string;
    expect(prompt).toMatch(/\[illegible\]/);
    expect(prompt).toMatch(/NEVER guess/);
    expect(prompt).toMatch(/not a summary/i);
  });

  it("marks a batch that failed rather than dropping it silently", async () => {
    const bytes = await pdfOf(20);
    complete
      .mockResolvedValueOnce({
        text: "--- page 1 ---\nBID SCHEDULE",
        usage: { input_tokens: 1, output_tokens: 1, model: "m" },
        stopReason: null,
      })
      .mockRejectedValueOnce(new Error("overloaded"));

    const res = await ocrPdf(bytes);
    expect(res.text).toContain("BID SCHEDULE");
    // The hole is named. A dropped batch is a set of requirements nobody
    // knows are missing.
    expect(res.text).toMatch(/pages 16 to 20: could not be read/);
  });

  it("returns no text at all when nothing could be transcribed", async () => {
    complete.mockRejectedValue(new Error("overloaded"));
    const res = await ocrPdf(await pdfOf(3));
    expect(res.text).toBe("");
    expect(res.pagesRead).toBe(0);
    expect(res.error).toBeTruthy();
  });

  it("says so when a document is longer than the transcription ceiling", async () => {
    complete.mockResolvedValue({
      text: "page",
      usage: { input_tokens: 1, output_tokens: 1, model: "m" },
      stopReason: null,
    });
    const res = await ocrPdf(await pdfOf(40), { maxPages: 15 });
    expect(res.pagesTotal).toBe(40);
    expect(res.pagesRead).toBe(15);
    expect(res.truncated).toBe(true);
  });

  it("degrades to an explained failure on bytes that are not a PDF", async () => {
    const res = await ocrPdf(Buffer.from("not a pdf at all"));
    expect(res.text).toBe("");
    expect(res.error).toMatch(/could not open the PDF/);
    expect(complete).not.toHaveBeenCalled();
  });
});
