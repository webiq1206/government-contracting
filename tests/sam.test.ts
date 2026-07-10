import { describe, it, expect } from "vitest";
import { buildOpportunityQuery, wantNoticeType } from "@/lib/integrations/sam";

// Local-time construction so mmddyyyy (which reads local Y/M/D) is deterministic
// regardless of the machine timezone.
const NOW = new Date(2026, 6, 10); // July 10, 2026 local

describe("buildOpportunityQuery (SAM.gov v2 param mapping)", () => {
  it("maps a single NAICS to ncode (never comma-joined)", () => {
    const q = buildOpportunityQuery({ naics: "561720" }, "KEY", NOW);
    expect(q.ncode).toBe("561720");
    expect(String(q.ncode)).not.toContain(",");
  });

  it("maps a single ptype and state as single values", () => {
    const q = buildOpportunityQuery({ ptype: "o", state: "ID" }, "KEY", NOW);
    expect(q.ptype).toBe("o");
    expect(q.state).toBe("ID");
    expect(String(q.ptype)).not.toContain(",");
    expect(String(q.state)).not.toContain(",");
  });

  it("includes the api key, a 3-day default posted window, and paging", () => {
    const q = buildOpportunityQuery({ limit: 100, offset: 200 }, "KEY", NOW);
    expect(q.api_key).toBe("KEY");
    expect(q.postedTo).toBe("07/10/2026");
    expect(q.postedFrom).toBe("07/07/2026"); // 3 days before
    expect(q.limit).toBe(100);
    expect(q.offset).toBe(200);
  });

  it("passes solnum + set-aside through untouched for award/eligibility lookups", () => {
    const q = buildOpportunityQuery({ solnum: "ABC-123", setAside: "SBA" }, "KEY", NOW);
    expect(q.solnum).toBe("ABC-123");
    expect(q.typeOfSetAside).toBe("SBA");
  });

  it("omits filters that weren't provided (no empty ncode/ptype)", () => {
    const q = buildOpportunityQuery({}, "KEY", NOW);
    expect(q.ncode).toBeUndefined();
    expect(q.ptype).toBeUndefined();
    expect(q.state).toBeUndefined();
  });
});

describe("wantNoticeType (which SAM notice types the pipeline ingests)", () => {
  it("keeps biddable solicitations and sources sought", () => {
    for (const t of [
      "Solicitation",
      "Presolicitation",
      "Combined Synopsis/Solicitation",
      "Sources Sought",
    ]) {
      expect(wantNoticeType(t)).toBe(true);
    }
  });

  it("drops award/special/justification/surplus/intent notices", () => {
    for (const t of [
      "Award Notice",
      "Special Notice",
      "Justification (J&A)",
      "Sale of Surplus Property",
      "Intent to Bundle Requirements (DoD-Funded)",
    ]) {
      expect(wantNoticeType(t)).toBe(false);
    }
  });

  it("is case-insensitive and safe on undefined", () => {
    expect(wantNoticeType("SOLICITATION")).toBe(true);
    expect(wantNoticeType(undefined)).toBe(false);
    expect(wantNoticeType("")).toBe(false);
  });
});
