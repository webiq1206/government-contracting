import { describe, it, expect } from "vitest";
import {
  buildOutreachDetailsBlock,
  lineLooksLikeInternalFailure,
  opportunityExpectsDocuments,
  scrubInternalFailureCopy,
  shouldHoldMissingDocs,
  scopeTooThinAfterScrub,
  renderOutreachBrief,
} from "../lib/domain/outreach-email";
import { prioritizeDocsForAttach } from "../lib/opportunity-attachments";
import { DEFAULT_TEMPLATES } from "../db/seedData";
import { plainToHtml, renderTemplate } from "../lib/domain/template-render";
import { TEMPLATE_TOKEN_SAMPLES, previewBriefSections } from "../lib/domain/template-tokens";

const FAILURE_RE = /could not|unable to|failed|HTTP \d+/i;

describe("scrubInternalFailureCopy", () => {
  it("drops lines that mention fetch or extract failures", () => {
    const src = [
      "Replace HVAC units in 4 buildings.",
      "Could not fetch attachment (HTTP 403).",
      "Unable to extract scope from the PDF.",
    ].join("\n");
    const out = scrubInternalFailureCopy(src);
    expect(out).toBe("Replace HVAC units in 4 buildings.");
    expect(out).not.toMatch(FAILURE_RE);
  });
});

describe("shouldHoldMissingDocs", () => {
  it("holds when docs were expected but none materialized", () => {
    expect(shouldHoldMissingDocs(true, 0, 0)).toBe(true);
  });

  it("does not hold when files or links exist", () => {
    expect(shouldHoldMissingDocs(true, 1, 0)).toBe(false);
    expect(shouldHoldMissingDocs(true, 0, 1)).toBe(false);
  });

  it("does not hold when no docs were expected", () => {
    expect(shouldHoldMissingDocs(false, 0, 0)).toBe(false);
  });
});

describe("opportunityExpectsDocuments", () => {
  it("is true when stored docs or json urls exist", () => {
    expect(opportunityExpectsDocuments(1, [])).toBe(true);
    expect(opportunityExpectsDocuments(0, [{ url: "https://sam.gov/x" }])).toBe(true);
  });

  it("is false when nothing is on file", () => {
    expect(opportunityExpectsDocuments(0, [])).toBe(false);
    expect(opportunityExpectsDocuments(0, null)).toBe(false);
  });
});

describe("buildOutreachDetailsBlock", () => {
  it("lists attached filenames and omits failure language", () => {
    const block = buildOutreachDetailsBlock({
      title: "HVAC Maintenance Services",
      solicitationNumber: "W912DR-26-R-0042",
      agency: "USACE",
      deadlineLabel: "Aug 25, 2026",
      trade: "HVAC",
      attachedNames: ["Statement of Work.pdf", "Wage Determination.pdf"],
      links: [],
    });
    expect(block.plain).toContain("Attached:");
    expect(block.plain).toContain("- Statement of Work.pdf");
    expect(block.html).toContain("<li>Statement of Work.pdf</li>");
    expect(block.plain).not.toMatch(FAILURE_RE);
    expect(block.html).not.toMatch(FAILURE_RE);
  });

  it("lists oversized files as document links only", () => {
    const block = buildOutreachDetailsBlock({
      attachedNames: [],
      links: [{ name: "Full Packet.pdf", url: "https://example.com/file" }],
    });
    expect(block.plain).toContain("Documents:");
    expect(block.plain).toContain("Full Packet.pdf: https://example.com/file");
    expect(block.plain).not.toMatch(FAILURE_RE);
  });
});

describe("seed Template 1 render", () => {
  it("fills cleanly with sample values and produces openable markup", () => {
    const tmpl = DEFAULT_TEMPLATES.find((t) => t.slug === "template_1_outreach");
    expect(tmpl).toBeTruthy();
    const filled = renderTemplate(tmpl!.body, TEMPLATE_TOKEN_SAMPLES);
    expect(filled).not.toContain("{{");
    expect(filled).not.toContain("==");

    // The body is deliberately a short human note now; the facts and the
    // bulleted structure come from the brief appended beneath it. Asserting on
    // the body alone would no longer describe what a subcontractor receives.
    const html = plainToHtml(filled) + renderOutreachBrief(previewBriefSections()).html;
    expect(html).toContain(">Statement of Work.pdf (attached)</li>");
    expect(html).toContain("Scope we need priced");
    expect(html).toContain("What to send back");
    expect(html).not.toMatch(FAILURE_RE);
  });

  it("does not restate the facts the generated sections already carry", () => {
    /*
     * The old body repeated the trade, the location, the deadline and the
     * whole scope that the sections below it already listed, so a
     * subcontractor read every fact twice, once as prose and once as bullets.
     *
     * The one deliberate overlap is the ask itself: the body names price,
     * availability, payment terms and exclusions in a sentence, and the
     * checklist below spells the same things out as a list. That is a summary
     * followed by its detail, not the same block twice, and losing the
     * sentence would leave the opening paragraph asking for nothing in
     * particular.
     */
    const tmpl = DEFAULT_TEMPLATES.find((t) => t.slug === "template_1_outreach")!;
    const body = renderTemplate(tmpl.body, TEMPLATE_TOKEN_SAMPLES);
    const brief = renderOutreachBrief(previewBriefSections()).plain;

    expect(body).not.toContain(TEMPLATE_TOKEN_SAMPLES.deadline);
    expect(body).not.toContain(TEMPLATE_TOKEN_SAMPLES.scope_summary);
    expect(brief).toContain(TEMPLATE_TOKEN_SAMPLES.deadline);
    expect(brief).toMatch(/payment terms/i);
  });
});

describe("prioritizeDocsForAttach", () => {
  it("puts trade-named specs ahead of generic cover letters", () => {
    const ranked = prioritizeDocsForAttach(
      [{ name: "Cover Letter.pdf" }, { name: "Electrical Specs.pdf" }],
      "Electrical"
    );
    expect(ranked[0]?.name).toBe("Electrical Specs.pdf");
  });
});

describe("lineLooksLikeInternalFailure / scopeTooThinAfterScrub", () => {
  it("detects failure phrasing", () => {
    expect(lineLooksLikeInternalFailure("could not fetch (HTTP 500)")).toBe(true);
    expect(lineLooksLikeInternalFailure("Do you have bonding?")).toBe(false);
  });

  it("treats scrubbed-empty scope as too thin", () => {
    expect(scopeTooThinAfterScrub("")).toBe(true);
    expect(
      scopeTooThinAfterScrub(
        "Replace HVAC units in four buildings totaling about 120,000 square feet."
      )
    ).toBe(false);
  });
});
