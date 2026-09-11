import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPdfPages, extractPdfText, extractPdfTitle } from "../lib/integrations/pdf";

describe("PDF extraction on the supported Node runtime", () => {
  it("reads real text, page citations and titles while preserving reusable input", async () => {
    const document = await PDFDocument.create();
    document.setTitle("Solicitation runtime regression");
    const font = await document.embedFont(StandardFonts.Helvetica);
    document.addPage().drawText("Paint three buildings for 42500 dollars.", { font });
    document.addPage(); // Blank pages must retain their citation number.
    document.addPage().drawText("Submit the quote by Friday.", { font });
    const bytes = await document.save();
    const original = bytes.slice();

    const text = await extractPdfText(bytes);
    expect(text.pages).toBe(3);
    expect(text.text).toContain("Paint three buildings for 42500 dollars.");
    expect(text.text).toContain("Submit the quote by Friday.");
    expect(await extractPdfTitle(bytes)).toBe("Solicitation runtime regression");
    const pages = await extractPdfPages(bytes);
    expect(pages).toEqual({ total: 3, truncated: false, pages: [
      "Paint three buildings for 42500 dollars.", "", "Submit the quote by Friday.",
    ] });
    expect(await extractPdfPages(bytes, 10)).toEqual({ total: 3, truncated: true, pages: ["Paint thre", "", ""] });
    expect(bytes).toEqual(original);
  }, 30000);

  it("can process another document after a malformed PDF fails", async () => {
    expect(await extractPdfText(Buffer.from("invalid PDF"))).toEqual({ text: "", pages: 0 });
    const document = await PDFDocument.create();
    document.addPage().drawText("Recovery succeeded");
    expect((await extractPdfText(await document.save())).text).toBe("Recovery succeeded");
  }, 30000);
});
