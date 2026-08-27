import { describe, it, expect } from "vitest";
import {
  evaluateSolicitationCompleteness,
  outreachDisplayName,
  isPlaceholderScope,
} from "../lib/domain/solicitation-completeness";

describe("evaluateSolicitationCompleteness", () => {
  const base = {
    solicitationNumber: "15B0AT26Q20500003",
    agency: "JUSTICE, DEPARTMENT OF",
    deadline: "2026-08-19T14:00:00Z",
    locationState: "MA",
    locationText: "Ayer, MA",
    naicsCode: "561210",
    setAsideType: "Unrestricted",
    valueEstimated: 120000,
    description: "Water treatment services for FMC Devens.",
    storedDocumentCount: 1,
    attachmentOutcomes: [
      { name: "PWS.pdf", url: "https://example.com/pws.pdf", status: "fetched" as const },
    ],
    analysis: {
      scope_plain_language: "Provide water treatment chemicals and service visits weekly.",
      submission_method: "Email offer to the portal",
      submission_requirements: ["Signed SF-1449", "Pricing schedule"],
      required_forms: [{ name: "SF-1449" }],
      compliance_matrix: [{ id: "sf1449" }],
      required_trades: ["Water Treatment"],
      set_aside: "Unrestricted",
      estimated_value: "$120,000",
    },
  };

  it("is ok when critical fields and attachments are present", () => {
    const result = evaluateSolicitationCompleteness(base);
    expect(result.ok).toBe(true);
    expect(result.missing.filter((m) => m.critical)).toHaveLength(0);
  });

  it("blocks when attachments are missing", () => {
    const result = evaluateSolicitationCompleteness({
      ...base,
      storedDocumentCount: 0,
      attachmentOutcomes: [],
    });
    expect(result.ok).toBe(false);
    expect(result.riskFlags).toContain("missing_attachments");
    expect(result.missing.some((m) => m.key === "attachments")).toBe(true);
  });

  it("blocks when a document was stored but never actually read", () => {
    // "no_text" used to count as a successful fetch, so an opportunity whose
    // only attachment was an unreadable scan advanced into sourcing with its
    // instructions-to-offerors never read by anything.
    const result = evaluateSolicitationCompleteness({
      ...base,
      storedDocumentCount: 1,
      attachmentOutcomes: [
        {
          name: "Solicitation.pdf",
          url: "https://example.com/s.pdf",
          status: "no_text" as const,
          detail: "nothing readable was transcribed",
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.riskFlags).toContain("unreadable_documents");
    const item = result.missing.find((m) => m.key === "unreadable_documents");
    expect(item?.critical).toBe(true);
    expect(item?.resolution).toContain("Solicitation.pdf");
  });

  it("blocks when scope is placeholder", () => {
    const result = evaluateSolicitationCompleteness({
      ...base,
      analysis: {
        ...base.analysis,
        scope_plain_language: "Not specified in the provided documents",
        draft_sow: "",
        project_overview: "",
      },
    });
    expect(result.ok).toBe(false);
    expect(result.riskFlags).toContain("unverified_scope");
  });

  it("blocks when set-aside is blank", () => {
    const result = evaluateSolicitationCompleteness({
      ...base,
      setAsideType: null,
      analysis: { ...base.analysis, set_aside: null },
    });
    expect(result.ok).toBe(false);
    expect(result.riskFlags).toContain("unverified_set_aside");
  });
  describe("archives", () => {
    it("blocks on an archive whose contents were never opened", () => {
      /*
       * Nothing in this codebase extracts archives. A notice whose entire
       * solicitation package arrives as one .zip used to report a single
       * cleanly fetched attachment and advance into sourcing, with every
       * requirement, form and drawing inside it unread and the analysis built
       * from the portal blurb.
       */
      const result = evaluateSolicitationCompleteness({
        ...base,
        storedDocumentCount: 1,
        attachmentOutcomes: [
          {
            name: "Solicitation Package.zip",
            status: "archive" as const,
            detail: "archive contents were not opened",
          },
        ],
      });
      expect(result.ok).toBe(false);
      expect(result.riskFlags).toContain("unopened_archives");
      const item = result.missing.find((m) => m.key === "unopened_archives");
      expect(item?.critical).toBe(true);
      expect(item?.resolution).toContain("Solicitation Package.zip");
      // The archive IS a stored document, so it must not also claim there are
      // no attachments at all. Two blockers for one problem is noise.
      expect(result.missing.some((m) => m.key === "attachments")).toBe(false);
    });

    it("does not fire for an ordinary unsupported binary", () => {
      // A .dwg drawing has no text and is not expected to. It is not a
      // container of documents nobody opened.
      const result = evaluateSolicitationCompleteness({
        ...base,
        storedDocumentCount: 2,
        attachmentOutcomes: [
          { name: "PWS.pdf", status: "fetched" as const },
          { name: "Site Plan.dwg", status: "unsupported" as const },
        ],
      });
      expect(result.missing.some((m) => m.key === "unopened_archives")).toBe(false);
    });
  });

  describe("documents the analysis had no room for", () => {
    it("blocks on a document that was stored but never reached the analysis", () => {
      /*
       * A notice can carry more text than the prompt can hold, and something has
       * to be left out. What must never happen is the brief reading the same
       * either way. "fetched" would be literally true for this file, since it
       * downloaded cleanly and sits in storage, and completely misleading, since
       * nothing in it informed a single requirement.
       */
      const result = evaluateSolicitationCompleteness({
        ...base,
        storedDocumentCount: 3,
        attachmentOutcomes: [
          { name: "Solicitation.pdf", status: "fetched" as const },
          {
            name: "Amendment 0003.pdf",
            status: "not_read" as const,
            detail: "no room in the analysis for this document",
          },
        ],
      });
      expect(result.ok).toBe(false);
      expect(result.riskFlags).toContain("documents_not_read");
      const item = result.missing.find((m) => m.key === "documents_not_read");
      expect(item?.critical).toBe(true);
      expect(item?.resolution).toContain("Amendment 0003.pdf");
    });

    it("does not confuse it with a file that yielded no text", () => {
      // Different problem, different answer. "Upload a text-based copy" is
      // useless advice for a document that read perfectly and simply did not
      // fit.
      const result = evaluateSolicitationCompleteness({
        ...base,
        storedDocumentCount: 1,
        attachmentOutcomes: [
          { name: "Amendment 0003.pdf", status: "not_read" as const },
        ],
      });
      expect(result.missing.some((m) => m.key === "unreadable_documents")).toBe(false);
      expect(result.missing.some((m) => m.key === "documents_not_read")).toBe(true);
    });

    it("counts as a stored document, so it does not also report no attachments", () => {
      const result = evaluateSolicitationCompleteness({
        ...base,
        storedDocumentCount: 0,
        attachmentOutcomes: [{ name: "Amendment 0003.pdf", status: "not_read" as const }],
      });
      expect(result.missing.some((m) => m.key === "attachments")).toBe(false);
    });
  });
});

describe("outreachDisplayName", () => {
  it("prefers configured outreach_display_name", () => {
    expect(
      outreachDisplayName({
        outreach_display_name: "Todd",
        owner_name: "Todd Brost",
        legal_name: "Brost Co",
      })
    ).toBe("Todd");
  });

  it("falls back to first name of owner_name", () => {
    expect(
      outreachDisplayName({ owner_name: "John Smith", legal_name: "Acme" })
    ).toBe("John");
  });
});

describe("isPlaceholderScope", () => {
  it("detects empty and Not specified text", () => {
    expect(isPlaceholderScope("")).toBe(true);
    expect(isPlaceholderScope("Not specified in the provided documents")).toBe(true);
    expect(isPlaceholderScope("Provide weekly water treatment service visits.")).toBe(false);
  });
});
