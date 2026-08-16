import { describe, it, expect } from "vitest";
import { filenameFromResponse } from "@/lib/domain/attachment-meta";

/**
 * SAM's notice JSON names every resourceLink "attachment", so the stored
 * document name is only as good as what this recovers from the download
 * response. Everything downstream ranks, links, and displays by that name.
 */
describe("filenameFromResponse", () => {
  const fallback = "attachment";

  it("reads a plain quoted filename", () => {
    expect(
      filenameFromResponse({
        contentDisposition: 'attachment; filename="Wage Determination 2025-0042.pdf"',
        url: "https://api.sam.gov/prod/opps/v3/opportunities/resources/files/TOKEN/download",
        fallback,
      })
    ).toBe("Wage Determination 2025-0042.pdf");
  });

  it("reads an unquoted filename", () => {
    expect(
      filenameFromResponse({
        contentDisposition: "attachment; filename=SOW_Building400.pdf",
        fallback,
      })
    ).toBe("SOW_Building400.pdf");
  });

  it("prefers RFC 5987 filename* and decodes it", () => {
    expect(
      filenameFromResponse({
        contentDisposition:
          "attachment; filename=\"fallback.bin\"; filename*=UTF-8''Pricing%20Schedule%20Att%202.xlsx",
        fallback,
      })
    ).toBe("Pricing Schedule Att 2.xlsx");
  });

  it("falls back to a URL segment that looks like a file", () => {
    expect(
      filenameFromResponse({
        contentDisposition: null,
        url: "https://portal.example.gov/files/Amendment_0001.pdf?dl=1",
        fallback,
      })
    ).toBe("Amendment_0001.pdf");
  });

  it("does not trust an opaque download token in the URL", () => {
    // SAM's real download URLs end in /download or an extensionless token;
    // storing that as the name would be no better than "attachment".
    expect(
      filenameFromResponse({
        contentDisposition: null,
        url: "https://api.sam.gov/prod/opps/v3/opportunities/resources/files/0a1b2c3d/download",
        fallback,
      })
    ).toBe("attachment");
  });

  it("keeps the fallback when the header names it 'attachment' too", () => {
    expect(
      filenameFromResponse({
        contentDisposition: 'attachment; filename="attachment"',
        fallback: "attachment-3",
      })
    ).toBe("attachment-3");
  });

  it("survives malformed percent-encoding without throwing", () => {
    expect(
      filenameFromResponse({
        contentDisposition: "attachment; filename*=UTF-8''%E0%A4%A", // truncated
        fallback,
      })
    ).toBe("attachment");
  });

  it("strips path components and control characters from a hostile header", () => {
    const name = filenameFromResponse({
      contentDisposition: 'attachment; filename="../../etc/passwd"',
      fallback,
    });
    expect(name).not.toContain("/");
    expect(name).not.toContain("..");
  });
});

import { filenameFromPdfTitle } from "@/lib/domain/attachment-meta";

/**
 * The last-resort naming source, used when the download link has expired: the
 * PDF's own metadata Title. Junk must be refused, not cleaned, because a
 * wrong-but-plausible name on a bid document is worse than a generic one.
 */
describe("filenameFromPdfTitle", () => {
  it("uses a real document title", () => {
    expect(filenameFromPdfTitle("Statement of Work, Building 400 Chiller Replacement")).toBe(
      "Statement of Work Building 400 Chiller Replacement"
    );
  });

  it("strips the authoring-tool prefix Word bakes in", () => {
    expect(filenameFromPdfTitle("Microsoft Word - Wage Determination 2025-0042.docx")).toBe(
      "Wage Determination 2025-0042"
    );
  });

  it("refuses junk titles rather than cleaning them", () => {
    for (const junk of ["untitled", "Document1", "  ", "", "draft", "scan"]) {
      expect(filenameFromPdfTitle(junk)).toBeNull();
    }
    expect(filenameFromPdfTitle(null)).toBeNull();
  });

  it("keeps a long but real title, truncated", () => {
    const long = "Performance Work Statement for Grounds Maintenance ".repeat(4);
    const out = filenameFromPdfTitle(long);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(124);
  });

  it("refuses a title that sanitizes away to nothing", () => {
    expect(filenameFromPdfTitle("///???///")).toBeNull();
  });
});
