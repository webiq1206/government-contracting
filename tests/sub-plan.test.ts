import { describe, it, expect } from "vitest";
import { buildSubPlan, type SubPlanInput } from "@/lib/domain/sub-plan";

function input(over: Partial<SubPlanInput> = {}): SubPlanInput {
  return {
    hasEmail: false,
    hasPhone: false,
    emailVerified: false,
    contactStatus: null,
    samExcluded: false,
    touches: 0,
    openPairings: 0,
    totalPairings: 0,
    quoteCount: 0,
    compliance: {
      clearedForAward: false,
      missing: ["w9", "coi_general_liability", "coi_workers_comp"],
      expired: [],
      awaitingVerification: [],
    },
    ...over,
  };
}

describe("sub readiness plan", () => {
  it("blocks on reachability first when nothing is on file", () => {
    const plan = buildSubPlan(input());
    expect(plan.total).toBe(6);
    expect(plan.active?.key).toBe("reach");
    expect(plan.active?.status).toBe("blocked");
    expect(plan.active?.blockers?.[0].href).toBe("#sub-contact");
  });

  it("skips email verification for a phone-only sub", () => {
    const plan = buildSubPlan(input({ hasPhone: true }));
    const verify = plan.steps.find((s) => s.key === "verify")!;
    expect(verify.status).toBe("done");
    expect(verify.detail).toBe("Phone only, nothing to verify");
    expect(plan.active?.key).toBe("touch");
  });

  it("names each missing compliance document with a fix link", () => {
    const plan = buildSubPlan(
      input({ hasEmail: true, emailVerified: true, touches: 3 })
    );
    expect(plan.active?.key).toBe("docs");
    expect(plan.active?.status).toBe("blocked");
    expect(plan.active?.blockers).toHaveLength(3);
    expect(plan.active?.blockers?.[0].what).toBe("W-9 is not on file.");
    expect(plan.active?.blockers?.[0].how).toContain("signed W-9");
    expect(plan.active?.blockers?.[1].what).toBe("General liability insurance is not on file.");
    expect(plan.active?.blockers?.[1].how).not.toContain("W-9");
    expect(plan.active?.blockers?.[1].how).toContain("certificate");
    expect(plan.active?.blockers?.[2].how).toContain("certificate");
    expect(plan.active?.blockers?.[2].how).not.toContain("W-9");
    expect(plan.active?.blockers?.every((b) => b.href === "#compliance")).toBe(true);
  });

  it("treats an expired certificate differently from a missing one", () => {
    const plan = buildSubPlan(
      input({
        hasEmail: true,
        emailVerified: true,
        touches: 1,
        compliance: {
          clearedForAward: false,
          missing: [],
          expired: ["coi_general_liability"],
          awaitingVerification: ["w9"],
        },
      })
    );
    const docs = plan.steps.find((s) => s.key === "docs")!;
    expect(docs.blockers?.[0].what).toBe("General liability insurance has expired.");
    expect(docs.blockers?.[1].what).toMatch(/uploaded but nobody has checked/);
    expect(docs.detail).toBe("2 documents to resolve");
  });

  it("completes the plan for a working, cleared sub", () => {
    const plan = buildSubPlan(
      input({
        hasEmail: true,
        hasPhone: true,
        emailVerified: true,
        touches: 12,
        openPairings: 2,
        totalPairings: 5,
        quoteCount: 4,
        compliance: {
          clearedForAward: true,
          missing: [],
          expired: [],
          awaitingVerification: [],
        },
      })
    );
    expect(plan.done).toBe(6);
    expect(plan.headline).toBe("All set: this sub is job-ready");
    expect(plan.steps.find((s) => s.key === "work")?.detail).toBe(
      "2 open jobs · 4 quotes"
    );
  });

  it("keeps a SAM-excluded company blocked no matter its history", () => {
    const plan = buildSubPlan(
      input({
        hasEmail: true,
        emailVerified: true,
        touches: 8,
        totalPairings: 3,
        quoteCount: 2,
        compliance: {
          clearedForAward: true,
          missing: [],
          expired: [],
          awaitingVerification: [],
        },
        samExcluded: true,
      })
    );
    const work = plan.steps.find((s) => s.key === "work")!;
    expect(work.status).toBe("blocked");
    expect(work.blockers?.[0].what).toMatch(/federal exclusion list/);
  });
});
