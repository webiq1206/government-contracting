import { describe, it, expect } from "vitest";
import {
  qualifyProspect,
  tierFor,
  prioritize,
  domainNicheRelevance,
  outreachTemplate,
} from "@/lib/domain/backlink";

describe("qualifyProspect — hard rejects (protect the domain)", () => {
  it("rejects un-indexed domains", () => {
    const q = qualifyProspect({ opportunityType: "resource_page", indexed: false, dr: 70 });
    expect(q.tier).toBe("reject");
    expect(q.score).toBe(0);
  });
  it("rejects high spam score", () => {
    expect(qualifyProspect({ opportunityType: "directory", spamScore: 55, dr: 60 }).tier).toBe("reject");
  });
  it("rejects very low domain rating", () => {
    expect(qualifyProspect({ opportunityType: "guest_post", dr: 4, relevance: 0.9 }).tier).toBe("reject");
  });
  it("rejects off-topic prospects", () => {
    expect(qualifyProspect({ opportunityType: "resource_page", dr: 80, relevance: 0.05 }).tier).toBe("reject");
  });
});

describe("qualifyProspect — scoring", () => {
  it("scores a strong, relevant, dofollow prospect as high", () => {
    const q = qualifyProspect({
      opportunityType: "resource_page",
      dr: 78,
      relevance: 0.9,
      traffic: 60_000,
      spamScore: 2,
      indexed: true,
      linkType: "dofollow",
    });
    expect(q.tier).toBe("high");
    expect(q.score).toBeGreaterThanOrEqual(70);
    expect(q.reasons.join(" ")).toMatch(/Strong authority/);
  });

  it("nofollow materially lowers the score vs dofollow", () => {
    const base = {
      opportunityType: "resource_page",
      dr: 60,
      relevance: 0.7,
      traffic: 20_000,
      spamScore: 3,
      indexed: true,
    } as const;
    const df = qualifyProspect({ ...base, linkType: "dofollow" }).score;
    const nf = qualifyProspect({ ...base, linkType: "nofollow" }).score;
    expect(nf).toBeLessThan(df);
  });

  it("higher DR + relevance scores higher", () => {
    const strong = qualifyProspect({ opportunityType: "broken_link", dr: 75, relevance: 0.85, indexed: true, linkType: "dofollow" }).score;
    const weak = qualifyProspect({ opportunityType: "broken_link", dr: 20, relevance: 0.3, indexed: true, linkType: "dofollow" }).score;
    expect(strong).toBeGreaterThan(weak);
  });

  it("directory opportunities are discounted vs editorial links", () => {
    const base = { dr: 55, relevance: 0.6, traffic: 10_000, indexed: true, linkType: "dofollow" } as const;
    const editorial = qualifyProspect({ ...base, opportunityType: "resource_page" }).score;
    const directory = qualifyProspect({ ...base, opportunityType: "directory" }).score;
    expect(directory).toBeLessThan(editorial);
  });
});

describe("tierFor", () => {
  it("maps scores to tiers", () => {
    expect(tierFor(85)).toBe("high");
    expect(tierFor(50)).toBe("medium");
    expect(tierFor(30)).toBe("low");
    expect(tierFor(10)).toBe("reject");
  });
});

describe("domainNicheRelevance", () => {
  const niche = ["general construction", "roofing", "facilities maintenance", "HVAC"];
  it("returns neutral when there are no niche terms", () => {
    expect(domainNicheRelevance("example.com", [])).toBe(0.4);
  });
  it("returns neutral for an off-topic domain", () => {
    expect(domainNicheRelevance("cookingblog.com", niche)).toBe(0.4);
  });
  it("lifts relevance when the domain name matches a niche term", () => {
    expect(domainNicheRelevance("roofing-today.com", niche)).toBeGreaterThan(0.4);
  });
  it("rewards multiple on-topic tokens more", () => {
    const one = domainNicheRelevance("roofing-news.com", niche);
    const two = domainNicheRelevance("roofing-construction.org", niche);
    expect(two).toBeGreaterThan(one);
  });
  it("ignores the www prefix and TLD", () => {
    expect(domainNicheRelevance("www.roofing.io", niche)).toBeGreaterThan(0.4);
  });
});

describe("prioritize", () => {
  it("sorts highest score first", () => {
    const out = prioritize([{ score: 30 }, { score: 88 }, { score: 55 }]);
    expect(out.map((o) => o.score)).toEqual([88, 55, 30]);
  });
});

describe("outreachTemplate", () => {
  const base = {
    domain: "roofingtoday.com",
    senderName: "Jared Brost",
    companyName: "BROSTCO",
    companyUrl: "https://brostco.com",
    valueProp: "We deliver federal facilities and construction projects.",
  };
  it("includes the sender, company and site in the signature", () => {
    const d = outreachTemplate({ ...base, opportunityType: "resource_page" });
    expect(d.body).toContain("Jared Brost");
    expect(d.body).toContain("BROSTCO");
    expect(d.body).toContain("brostco.com");
    expect(d.subject.length).toBeGreaterThan(0);
  });
  it("varies the pitch by opportunity type", () => {
    const resource = outreachTemplate({ ...base, opportunityType: "resource_page" });
    const broken = outreachTemplate({ ...base, opportunityType: "broken_link" });
    expect(resource.body).not.toBe(broken.body);
    expect(broken.subject.toLowerCase()).toContain("broken");
  });
  it("falls back to a generic intro for unknown types", () => {
    const d = outreachTemplate({ ...base, opportunityType: "made_up_type" });
    expect(d.body).toContain("BROSTCO");
    expect(d.subject.length).toBeGreaterThan(0);
  });
  it("never offers payment (Google-guideline safe)", () => {
    const d = outreachTemplate({ ...base, opportunityType: "competitor_gap" });
    expect(d.body.toLowerCase()).not.toMatch(/\$|\bpay\b|payment|compensat|sponsor/);
  });
});
