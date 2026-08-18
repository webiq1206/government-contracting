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
