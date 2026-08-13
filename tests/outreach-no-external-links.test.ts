import { describe, it, expect, beforeAll } from "vitest";
import { publicDocUrl } from "@/lib/domain/doc-link";
import { buildOutreachDetailsBlock } from "@/lib/domain/outreach-email";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret";
  process.env.APP_URL = "https://brostco.com";
});

/**
 * A subcontractor must never receive a SAM.gov link (it looks unprofessional
 * and points them at bidding the job themselves) or a storage-provider URL,
 * and must never hit a login wall. Every document reference in an outreach
 * email is a brostco.com link backed by a signed token.
 */
describe("outreach emails never leak external links", () => {
  it("renders document links on our own domain only", () => {
    const links = [
      { name: "SOW.pdf", url: publicDocUrl({ k: "u", v: "https://sam.gov/api/sow.pdf", n: "SOW.pdf" }) },
      { name: "Plans.pdf", url: publicDocUrl({ k: "s", v: "bids/1/plans.pdf", n: "Plans.pdf" }) },
    ];
    const out = buildOutreachDetailsBlock({
      title: "Grounds maintenance",
      solicitationNumber: "W912-26-B-0042",
      agency: "Dept of Defense",
      deadlineLabel: "Aug 16, 2026",
      trade: "Landscaping",
      attachedNames: ["Spec.pdf"],
      links,
    });

    const blob = `${out.html}${out.plain}`;
    expect(blob).not.toMatch(/sam\.gov/i);
    expect(blob).not.toMatch(/supabase|s3\.amazonaws|storage\.googleapis/i);
    expect(blob).toContain("https://brostco.com/d/");
  });

  it("uses a link path that requires no account", () => {
    // /d/<token> is the only document path used in outreach. The
    // authenticated path (/api/files) must never appear in a sub email.
    const url = publicDocUrl({ k: "s", v: "bids/1/a.pdf", n: "a.pdf" });
    expect(url).toContain("/d/");
    expect(url).not.toContain("/api/files");
  });
});
