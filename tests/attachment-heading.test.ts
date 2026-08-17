import { describe, it, expect } from "vitest";
import {
  filenameFromPdfHeading,
  filenameFromSolicitation,
} from "@/lib/domain/attachment-meta";

// filenameFromPdfHeading returns a stem, like filenameFromPdfTitle: the
// caller re-extensions it from the stored MIME, which is trustworthy because
// the bytes were sniffed at ingest.
describe("naming a document from its first page", () => {
  it("takes the first real heading", () => {
    const text = [
      "Page 1 of 12",
      "",
      "STATEMENT OF WORK",
      "Aircraft hangar fall arrest systems",
    ].join("\n");
    expect(filenameFromPdfHeading(text)).toBe("STATEMENT OF WORK");
  });

  it("skips page furniture, dates, and revision markers", () => {
    const text = [
      "1",
      "Page 3 of 40",
      "Rev. 2",
      "08/14/2026",
      "Past Performance Questionnaire",
    ].join("\n");
    expect(filenameFromPdfHeading(text)).toBe("Past Performance Questionnaire");
  });

  it("refuses a bare solicitation or form number as a name", () => {
    // These are identifiers. Naming a file after one tells nobody what it is.
    expect(filenameFromPdfHeading("FA524026Q0021\n")).toBeNull();
    expect(filenameFromPdfHeading("SF 1449\n")).toBeNull();
    expect(filenameFromPdfHeading("W912DY-26-R-0007\n")).toBeNull();
  });

  it("keeps an upper-case heading that is genuinely words", () => {
    expect(filenameFromPdfHeading("SOLICITATION OFFER AND AWARD\n")).toBe(
      "SOLICITATION OFFER AND AWARD"
    );
  });

  it("ignores single words and fragments too short to mean anything", () => {
    expect(filenameFromPdfHeading("Attachment\nA\n7\n")).toBeNull();
  });

  it("still rejects placeholder headings the title filter knows about", () => {
    expect(filenameFromPdfHeading("Untitled document\n")).toBeNull();
  });

  it("gives up rather than inventing something from an empty read", () => {
    expect(filenameFromPdfHeading("")).toBeNull();
    expect(filenameFromPdfHeading(null)).toBeNull();
  });
});

describe("the last-resort name", () => {
  it("uses the solicitation number and a position", () => {
    expect(
      filenameFromSolicitation({
        solicitationNumber: "FA524026Q0021",
        index: 2,
        mime: "application/pdf",
      })
    ).toBe("FA524026Q0021 attachment 2.pdf");
  });

  it("falls back to the opportunity title when there is no number", () => {
    const name = filenameFromSolicitation({
      solicitationNumber: null,
      opportunityTitle: "Aircraft Hangar Fall Arrest System Inspection",
      index: 1,
      mime: "application/pdf",
    });
    expect(name).toMatch(/^Aircraft Hangar Fall Arrest/);
    expect(name).toMatch(/ attachment 1\.pdf$/);
  });

  it("declines when there is no context to name it from", () => {
    expect(
      filenameFromSolicitation({ solicitationNumber: null, opportunityTitle: null, index: 1 })
    ).toBeNull();
  });
});
