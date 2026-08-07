import { describe, it, expect } from "vitest";
import { normalizeSamNotice } from "@/lib/agents/opportunity-monitor";

/**
 * Regression guard for the production incident where SAM notices carrying an
 * empty-string date threw `invalid input syntax for type timestamp with time
 * zone: ""` mid-ingest, aborting the run and discarding the scoring jobs for
 * every record already inserted in that batch.
 */
describe("normalizeSamNotice date handling", () => {
  it("turns empty-string dates into null", () => {
    const n = normalizeSamNotice({
      noticeId: "abc",
      responseDeadLine: "",
      postedDate: "",
    } as never);
    expect(n.deadline).toBeNull();
    expect(n.posted_at).toBeNull();
  });

  it("turns unparseable dates into null", () => {
    const n = normalizeSamNotice({
      noticeId: "abc",
      responseDeadLine: "not a date",
    } as never);
    expect(n.deadline).toBeNull();
  });

  it("keeps valid dates untouched", () => {
    const n = normalizeSamNotice({
      noticeId: "abc",
      responseDeadLine: "2026-09-01T17:00:00-04:00",
      postedDate: "2026-08-01",
    } as never);
    expect(n.deadline).toBe("2026-09-01T17:00:00-04:00");
    expect(n.posted_at).toBe("2026-08-01");
  });

  it("handles missing date fields entirely", () => {
    const n = normalizeSamNotice({ noticeId: "abc" } as never);
    expect(n.deadline).toBeNull();
    expect(n.posted_at).toBeNull();
  });
});
