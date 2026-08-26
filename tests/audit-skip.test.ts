/**
 * What a compliance audit that could not run is allowed to say.
 *
 * The rule under test: a run that checked nothing may report that it checked
 * nothing, and may not improve the record. It had been doing the opposite.
 * The auditor kept only the deterministic `elig_*` findings on every skip path
 * and recomputed readiness from what survived, so a package held back by three
 * AI blockers became ready to submit the moment the AI key was removed. Less
 * information arrived as better news, under a grey sentence.
 */
import { describe, expect, it } from "vitest";
import {
  findingsAfterSkippedAudit,
  aiAuditFindings,
  computeReady,
  auditNotice,
} from "@/lib/domain/package";
import type { AuditFinding, PackageValidation } from "@/lib/types";

const PASSED = { passed: true, blockers: [], warnings: [] } as unknown as PackageValidation;
const FAILED = { passed: false, blockers: ["no price"], warnings: [] } as unknown as PackageValidation;

function finding(id: string, severity: AuditFinding["severity"], acknowledged = false): AuditFinding {
  return {
    id,
    severity,
    category: "scope",
    finding: `${id} says something is wrong`,
    recommendation: "fix it",
    requirement_id: null,
    acknowledged,
  } as AuditFinding;
}

const day = (s: string) => new Date(s);
const fmt = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

describe("a skipped audit keeps what the last real one found", () => {
  it("carries the AI findings, not just the eligibility ones", () => {
    const prior = [finding("elig_1", "warning"), finding("af_1", "blocker")];
    expect(findingsAfterSkippedAudit(prior).map((f) => f.id)).toEqual(["elig_1", "af_1"]);
  });

  it("cannot turn a blocked package into a ready one", () => {
    /*
     * The defect, stated as arithmetic. `preserved` was the eligibility subset,
     * and computeReady over that subset returns true whenever the deterministic
     * validation passes, whatever the AI found.
     */
    const prior = [finding("elig_1", "warning"), finding("af_1", "blocker")];
    const dropped = prior.filter((f) => f.id.startsWith("elig_"));
    expect(computeReady(PASSED, dropped)).toBe(true);
    expect(computeReady(PASSED, findingsAfterSkippedAudit(prior))).toBe(false);
  });

  it("does not invent readiness when the deterministic checks also fail", () => {
    expect(computeReady(FAILED, findingsAfterSkippedAudit([]))).toBe(false);
  });

  it("leaves an acknowledged blocker acknowledged", () => {
    // Acknowledging is the operator's decision and a skip is not a review of it.
    const prior = [finding("af_1", "blocker", true)];
    expect(computeReady(PASSED, findingsAfterSkippedAudit(prior))).toBe(true);
  });

  it("has nothing to carry when there was never an audit", () => {
    expect(findingsAfterSkippedAudit(null)).toEqual([]);
    expect(findingsAfterSkippedAudit(undefined)).toEqual([]);
  });

  it("returns a copy, so a caller cannot edit the stored array", () => {
    const prior = [finding("af_1", "blocker")];
    findingsAfterSkippedAudit(prior).push(finding("af_2", "blocker"));
    expect(prior).toHaveLength(1);
  });

  it("separates what the AI found from what the rules found", () => {
    const all = [finding("elig_1", "blocker"), finding("af_1", "warning")];
    expect(aiAuditFindings(all).map((f) => f.id)).toEqual(["af_1"]);
  });
});

describe("what the page says about the audit", () => {
  it("dates the findings when today's run could not happen", () => {
    const n = auditNotice({
      status: "skipped",
      ranAt: day("2026-08-18T10:00:00Z"),
      findings: [finding("af_1", "blocker")],
      formatDate: fmt,
    })!;
    expect(n.tone).toBe("warn");
    // Singular reads as a sentence, not as a template with a count dropped in.
    expect(n.headline).toContain("1 blocker from Aug 18, 2026 still stands");
    expect(n.detail).toContain("not from today");
  });

  it("counts blockers in the plural correctly", () => {
    const n = auditNotice({
      status: "skipped",
      ranAt: day("2026-08-18T10:00:00Z"),
      findings: [finding("af_1", "blocker"), finding("af_2", "blocker")],
      formatDate: fmt,
    })!;
    expect(n.headline).toContain("2 blockers from Aug 18, 2026 still stand");
    expect(n.headline).not.toContain("still stands");
  });

  it("does not count an eligibility blocker as a carried-over audit finding", () => {
    /*
     * The eligibility checks are deterministic and they DID run. Attributing
     * them to an audit that did not run would misplace the reason and send
     * somebody looking at the wrong thing.
     */
    const n = auditNotice({
      status: "skipped",
      ranAt: day("2026-08-18T10:00:00Z"),
      findings: [finding("elig_1", "blocker")],
      formatDate: fmt,
    })!;
    expect(n.headline).not.toContain("blocker");
    expect(n.headline).toContain("Showing the audit from");
  });

  it("says plainly when the audit has never run, rather than dating nothing", () => {
    const n = auditNotice({ status: "skipped", ranAt: null, findings: [], formatDate: fmt })!;
    expect(n.tone).toBe("warn");
    expect(n.headline).toContain("never run");
    // Never run is not clean, and must not be phrased as an absence of issues.
    expect(n.headline).not.toMatch(/no issues|clean/i);
  });

  it("does not call an audit clean while a blocker is open", () => {
    const n = auditNotice({
      status: "clean",
      ranAt: day("2026-08-18T10:00:00Z"),
      findings: [finding("af_1", "blocker")],
      formatDate: fmt,
    });
    expect(n).toBeNull();
  });

  it("dates a clean audit, so nobody reads a stale pass as a fresh one", () => {
    const n = auditNotice({
      status: "clean",
      ranAt: day("2026-08-18T10:00:00Z"),
      findings: [],
      formatDate: fmt,
    })!;
    expect(n.headline).toContain("Aug 18, 2026");
  });

  it("says nothing has audited the package when there is no status at all", () => {
    const n = auditNotice({ status: null, ranAt: null, findings: [], formatDate: fmt })!;
    expect(n.tone).toBe("warn");
    expect(n.headline).toContain("No compliance audit yet");
  });

  it("survives a timestamp that arrives as a string or as nonsense", () => {
    // node-postgres hands back a Date; an API round trip hands back a string.
    const asString = auditNotice({
      status: "skipped",
      ranAt: "2026-08-18T10:00:00Z",
      findings: [],
      formatDate: fmt,
    })!;
    expect(asString.headline).toContain("Aug 18, 2026");
    const rubbish = auditNotice({
      status: "skipped",
      ranAt: "not a date",
      findings: [],
      formatDate: fmt,
    })!;
    expect(rubbish.headline).toContain("never run");
  });

  it("has nothing to add while an audit is in progress beyond saying so", () => {
    const n = auditNotice({ status: "pending", ranAt: null, findings: [], formatDate: fmt })!;
    expect(n.tone).toBe("info");
    expect(n.headline).toContain("running");
  });
});

/**
 * The number at the top of the package checklist, and the list under it.
 *
 * They are computed together because they had drifted apart: the headline was
 * the required-forms ratio, which is one of the four rows, so a package with
 * its forms in order showed "100%" in display type above three unticked items
 * and a submit button that did not work.
 */
describe("the package checklist headline", () => {
  const base = {
    bidAmount: null as number | null,
    bidText: "-",
    marginText: "-",
    validation: null as PackageValidation | null,
    findings: [] as AuditFinding[],
    ready: false,
    outstanding: 0,
    auditStatus: null as string | null,
  };

  it("counts the rows it heads, not one of them", async () => {
    const { packageChecklist } = await import("@/lib/domain/package");
    const { rows, percent } = packageChecklist({
      ...base,
      // Forms all done, everything else outstanding: the old headline said 100.
      validation: { passed: true, blockers: [], warnings: [], satisfied_count: 7, total_mandatory: 7 } as unknown as PackageValidation,
      findings: [finding("af_1", "blocker")],
      outstanding: 1,
      auditStatus: "skipped",
    });
    expect(rows.filter((r) => r.ok)).toHaveLength(1);
    expect(percent).toBe(25);
  });

  it("reaches 100 only when every row is ticked", async () => {
    const { packageChecklist } = await import("@/lib/domain/package");
    const { percent } = packageChecklist({
      ...base,
      bidAmount: 250_000,
      validation: { passed: true, blockers: [], warnings: [], satisfied_count: 7, total_mandatory: 7 } as unknown as PackageValidation,
      ready: true,
      auditStatus: "clean",
    });
    expect(percent).toBe(100);
  });

  it("never claims work is under way when nothing is running", async () => {
    const { packageChecklist } = await import("@/lib/domain/package");
    const { rows } = packageChecklist({ ...base, auditStatus: "skipped" });
    const review = rows.find((r) => r.title === "Compliance review")!;
    expect(review.detail).toBe("Nothing has checked this yet");
    expect(review.detail).not.toMatch(/in progress/i);
  });

  it("says an audit is running only when one is", async () => {
    const { packageChecklist } = await import("@/lib/domain/package");
    const { rows } = packageChecklist({ ...base, auditStatus: "pending" });
    expect(rows.find((r) => r.title === "Compliance review")!.detail).toBe("Audit running");
  });

  it("counts audit blockers in what is left, not only the deterministic ones", async () => {
    const { packageChecklist } = await import("@/lib/domain/package");
    const { rows } = packageChecklist({ ...base, outstanding: 2, auditStatus: "skipped" });
    expect(rows.find((r) => r.title === "Compliance review")!.detail).toBe("2 items to finish");
  });
});
