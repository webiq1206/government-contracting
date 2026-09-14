/**
 * Adding a solicitation by hand: the parts that decide what a person sees.
 *
 * Pinned because each of these is a promise on the form: a SAM link is
 * recognised in every shape people paste it, a link is never shown as a
 * description, what the page stated is told apart from what was guessed,
 * and a record that is already here is found before a twin is created.
 */
import { describe, it, expect } from "vitest";
import {
  parseSolicitationUrl,
  isDescriptionPlaceholder,
  usableDescription,
  extractFromHtml,
  htmlToText,
  findDuplicateMatches,
  titleSimilarity,
  describeImport,
} from "@/lib/domain/solicitation-import";

describe("parseSolicitationUrl", () => {
  it("recognises SAM.gov notice links in the forms people paste", () => {
    for (const u of [
      "https://sam.gov/opp/318100dc0e6249d5b64349ebcf8aa4d9/view",
      "sam.gov/workspace/contract/opp/318100dc0e6249d5b64349ebcf8aa4d9/view?keywords=",
      "https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=318100dc0e6249d5b64349ebcf8aa4d9",
    ]) {
      const p = parseSolicitationUrl(u);
      expect(p.kind).toBe("sam_notice");
      if (p.kind === "sam_notice") expect(p.noticeId).toBe("318100dc0e6249d5b64349ebcf8aa4d9");
    }
  });
  it("treats any other http(s) address as a page to read, and refuses the rest", () => {
    expect(parseSolicitationUrl("https://bids.example.gov/solicitation/123").kind).toBe("web");
    expect(parseSolicitationUrl("ftp://files.example.gov/x").kind).toBe("invalid");
    expect(parseSolicitationUrl("").kind).toBe("invalid");
    expect(parseSolicitationUrl("not a url at all").kind).toBe("invalid");
  });
});

describe("description placeholders", () => {
  it("knows SAM's description link is not a description", () => {
    const link = "https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=abc";
    expect(isDescriptionPlaceholder(link)).toBe(true);
    expect(usableDescription(link)).toBeNull();
    expect(usableDescription("Replace two rooftop units at Building 4.")).toBe("Replace two rooftop units at Building 4.");
    expect(usableDescription("")).toBeNull();
  });
});

describe("extractFromHtml", () => {
  const html = `<html><head><title>RFQ 26-0042 Roof Repairs - City of Boise</title>
    <meta property="og:description" content="The City of Boise seeks quotes for roof repairs at the Main Library. Work includes membrane replacement and flashing."></head>
    <body><p>Solicitation Number: RFQ-26-0042</p><p>Responses due: 10/03/2026 at 2:00 PM</p>
    <a href="/docs/rfq-26-0042.pdf">Full solicitation (PDF)</a><a href="https://cdn.example.gov/plans.zip">Plans</a><a href="/about">About</a></body></html>`;
  it("reads title, description, number, due date and document links off the page", () => {
    const f = extractFromHtml(html, "https://bids.boise.gov/rfq/42");
    expect(f.title).toContain("RFQ 26-0042 Roof Repairs");
    expect(f.description).toContain("membrane replacement");
    expect(f.solicitation_number).toBe("RFQ-26-0042");
    expect(f.deadline?.startsWith("2026-10-03")).toBe(true);
    expect(f.attachments?.map((a) => a.url)).toEqual(["https://bids.boise.gov/docs/rfq-26-0042.pdf", "https://cdn.example.gov/plans.zip"]);
  });
  it("turns markup into readable text without scripts", () => {
    const t = htmlToText("<div><script>var x=1</script><p>Hello &amp; welcome</p><br>Line two</div>");
    expect(t).toBe("Hello & welcome\nLine two");
  });
});

describe("duplicates", () => {
  const rows = [
    { id: "a", title: "Roof Repairs Main Library", solicitation_number: "RFQ-26-0042", source_id: "n1", source_url: null, status: "open", stage: "scoring" },
    { id: "b", title: "Janitorial Services Fire Station 3", solicitation_number: "RFQ-26-0050", source_id: "n2", source_url: "https://x/1", status: "open", stage: "outreach" },
    { id: "c", title: "Roof repairs at the main library building", solicitation_number: null, source_id: "n3", source_url: null, status: "archived", stage: "dismissed" },
  ];
  it("calls an identity match certain and a shared title likely", () => {
    const m = findDuplicateMatches({ title: "Main Library Roof Repairs", solicitation_number: "rfq-26-0042 " }, rows);
    expect(m.find((x) => x.id === "a")).toMatchObject({ reason: "solicitation_number", confidence: "certain" });
    expect(m.find((x) => x.id === "c")).toMatchObject({ reason: "similar_title", confidence: "likely" });
    expect(m.find((x) => x.id === "b")).toBeUndefined();
  });
  it("matches on the pasted link and the SAM notice id", () => {
    expect(findDuplicateMatches({ source_url: "https://x/1" }, rows)[0]).toMatchObject({ id: "b", reason: "source_url" });
    expect(findDuplicateMatches({ source_id: "n3" }, rows)[0]).toMatchObject({ id: "c", reason: "source_id" });
  });
  it("does not call unrelated titles similar", () => {
    expect(titleSimilarity("Roof Repairs Main Library", "Snow Removal Hill AFB")).toBe(0);
  });
});

describe("describeImport", () => {
  it("says how the record arrived and whether the source is watched", () => {
    const s = describeImport({ method: "url", imported_at: "2026-09-14T12:00:00Z", imported_by: "a@b.c", provenance: {}, monitored: false }, "web");
    expect(s).toMatch(/Added from a link on Sep 14, 2026/);
    expect(s).toMatch(/not watched/);
    const sam = describeImport({ method: "url", imported_at: "2026-09-14T12:00:00Z", imported_by: null, provenance: {}, monitored: true }, "sam_federal");
    expect(sam).toMatch(/checked for changes/);
    expect(describeImport(null, "sam_federal")).toBeNull();
  });
});
