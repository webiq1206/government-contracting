import { describe, it, expect } from "vitest";
import {
  resolveRequirements,
  buildManifest,
  validatePackage,
  computeReady,
  openAuditBlockers,
  type ResolveContext,
} from "../lib/domain/package";
import type { ComplianceRequirement, AuditFinding, PackageValidation } from "../lib/types";

function req(p: Partial<ComplianceRequirement>): ComplianceRequirement {
  return {
    id: p.id ?? "x",
    title: p.title ?? "Item",
    category: p.category ?? "other",
    mandatory: p.mandatory ?? true,
    source: p.source ?? "L.1",
    signature_required: p.signature_required ?? false,
    satisfied_by: p.satisfied_by ?? "operator_provided",
    instructions: p.instructions,
    format: p.format,
    official_form: p.official_form,
  };
}

const ctx: ResolveContext = {
  confirmed: new Set(),
  hasNarrative: true,
  hasIdentifiers: true,
};

describe("resolveRequirements", () => {
  it("marks auto/profile items satisfied and assigns artifacts", () => {
    const r = resolveRequirements(
      [
        req({ id: "price", category: "pricing", satisfied_by: "auto_generated" }),
        req({ id: "cover", category: "narrative", satisfied_by: "auto_generated" }),
        req({ id: "cap", category: "attachment", satisfied_by: "from_profile" }),
      ],
      ctx
    );
    expect(r.map((x) => x.status)).toEqual(["satisfied", "satisfied", "satisfied"]);
    expect(r[0].artifact_kind).toBe("pricing_schedule");
    expect(r[1].artifact_kind).toBe("cover_letter");
    expect(r[2].artifact_kind).toBe("capability_statement");
  });

  it("flags signature and operator-provided items", () => {
    const r = resolveRequirements(
      [
        req({ id: "sf1449", category: "form", satisfied_by: "operator_signature" }),
        req({ id: "bond", satisfied_by: "operator_provided", instructions: "Obtain a bid bond." }),
      ],
      ctx
    );
    expect(r[0].status).toBe("needs_signature");
    expect(r[0].artifact_kind).toBe("reps_certs");
    expect(r[1].status).toBe("needs_operator");
  });

  it("honors operator confirmations", () => {
    const r = resolveRequirements([req({ id: "bond", satisfied_by: "operator_provided" })], {
      ...ctx,
      confirmed: new Set(["bond"]),
    });
    expect(r[0].status).toBe("satisfied");
    expect(r[0].operator_confirmed).toBe(true);
  });

  it("blocks on a required official agency form even if AI marked it auto", () => {
    const r = resolveRequirements(
      [
        req({
          id: "sf1449",
          title: "SF-1449",
          category: "form",
          satisfied_by: "auto_generated", // AI over-optimistic
          official_form: "SF-1449",
          signature_required: true,
        }),
      ],
      ctx
    );
    expect(r[0].status).toBe("needs_operator");
    expect(r[0].note).toContain("SF-1449");
  });
});

describe("computeReady", () => {
  const passing: PackageValidation = {
    passed: true,
    checked_at: "t",
    blockers: [],
    warnings: [],
    satisfied_count: 1,
    total_mandatory: 1,
  };
  const finding = (over: Partial<AuditFinding>): AuditFinding => ({
    id: over.id ?? "af_1",
    severity: over.severity ?? "blocker",
    category: over.category ?? "missing_requirement",
    finding: "x",
    recommendation: "y",
    acknowledged: over.acknowledged,
  });

  it("is false when an audit blocker is open, even if validation passes", () => {
    expect(computeReady(passing, [finding({})])).toBe(false);
    expect(openAuditBlockers([finding({})])).toHaveLength(1);
  });
  it("is true when the audit blocker is acknowledged", () => {
    expect(computeReady(passing, [finding({ acknowledged: true })])).toBe(true);
  });
  it("ignores warnings/info for readiness", () => {
    expect(computeReady(passing, [finding({ severity: "warning" }), finding({ severity: "info" })])).toBe(
      true
    );
  });
  it("is false when validation fails regardless of audit", () => {
    expect(computeReady({ ...passing, passed: false }, [])).toBe(false);
  });
});

describe("buildManifest", () => {
  it("orders by federal category precedence and names files", () => {
    const resolved = resolveRequirements(
      [
        req({ id: "price", title: "Pricing Schedule", category: "pricing", satisfied_by: "auto_generated" }),
        req({ id: "cover", title: "Cover Letter", category: "narrative", satisfied_by: "auto_generated" }),
      ],
      ctx
    );
    const m = buildManifest(resolved, "W912-25-R-0001");
    expect(m[0].category).toBe("narrative"); // cover letter first
    expect(m[0].order).toBe(1);
    expect(m[0].filename).toMatch(/^01_cover_letter_w912_25_r_0001\.pdf$/);
    expect(m[1].category).toBe("pricing");
  });
});

describe("validatePackage", () => {
  it("blocks on unmet mandatory items and missing price", () => {
    const resolved = resolveRequirements(
      [req({ id: "bond", title: "Bid Bond", satisfied_by: "operator_provided" })],
      ctx
    );
    const v = validatePackage({
      resolved,
      hasIdentifiers: true,
      pricingReconciles: true,
      bidAmount: null,
      nowIso: "2026-01-01T00:00:00Z",
    });
    expect(v.passed).toBe(false);
    expect(v.blockers.some((b) => b.includes("Bid Bond"))).toBe(true);
    expect(v.blockers.some((b) => b.includes("Bid price"))).toBe(true);
  });

  it("passes when all mandatory items are satisfied and price is set", () => {
    const resolved = resolveRequirements(
      [req({ id: "price", category: "pricing", satisfied_by: "auto_generated" })],
      ctx
    );
    const v = validatePackage({
      resolved,
      hasIdentifiers: true,
      pricingReconciles: true,
      bidAmount: 50000,
      nowIso: "2026-01-01T00:00:00Z",
    });
    expect(v.passed).toBe(true);
    expect(v.total_mandatory).toBe(1);
    expect(v.satisfied_count).toBe(1);
  });

  it("blocks a 'satisfied' generated artifact whose file was never stored", () => {
    // Pricing schedule requirement resolves to satisfied via auto_generated,
    // but the pricing_schedule document is absent from storage.
    const resolved = resolveRequirements(
      [req({ id: "price", title: "Pricing Schedule", category: "pricing", satisfied_by: "auto_generated" })],
      ctx
    );
    const v = validatePackage({
      resolved,
      hasIdentifiers: true,
      pricingReconciles: true,
      bidAmount: 50000,
      nowIso: "2026-01-01T00:00:00Z",
      presentDocKinds: new Set(["bid_pdf", "bid_docx"]),
    });
    expect(v.passed).toBe(false);
    expect(v.blockers.some((b) => b.includes("Pricing Schedule") && b.includes("missing"))).toBe(
      true
    );
  });

  it("blocks when the bid PDF itself is missing from storage", () => {
    const v = validatePackage({
      resolved: [],
      hasIdentifiers: true,
      pricingReconciles: true,
      bidAmount: 50000,
      nowIso: "2026-01-01T00:00:00Z",
      presentDocKinds: new Set(["cover_letter"]),
    });
    expect(v.passed).toBe(false);
    expect(v.blockers.some((b) => b.includes("bid PDF"))).toBe(true);
  });

  it("passes the artifact check when every generated document exists", () => {
    const resolved = resolveRequirements(
      [req({ id: "price", title: "Pricing Schedule", category: "pricing", satisfied_by: "auto_generated" })],
      ctx
    );
    const v = validatePackage({
      resolved,
      hasIdentifiers: true,
      pricingReconciles: true,
      bidAmount: 50000,
      nowIso: "2026-01-01T00:00:00Z",
      presentDocKinds: new Set(["bid_pdf", "bid_docx", "pricing_schedule"]),
    });
    expect(v.passed).toBe(true);
  });

  it("exempts operator-confirmed items and official solicitation forms", () => {
    const resolved = resolveRequirements(
      [
        req({ id: "sig", title: "Signed Offer", category: "form", satisfied_by: "operator_signature" }),
      ],
      { ...ctx, confirmed: new Set(["sig"]) }
    );
    const v = validatePackage({
      resolved,
      hasIdentifiers: true,
      pricingReconciles: true,
      bidAmount: 50000,
      nowIso: "2026-01-01T00:00:00Z",
      // reps_certs (the artifact backing "sig") is absent, but the operator
      // confirmed the item, so only the bid PDF presence matters.
      presentDocKinds: new Set(["bid_pdf"]),
    });
    expect(v.passed).toBe(true);
  });

  it("skips the artifact check entirely when presentDocKinds is not provided", () => {
    const resolved = resolveRequirements(
      [req({ id: "price", category: "pricing", satisfied_by: "auto_generated" })],
      ctx
    );
    const v = validatePackage({
      resolved,
      hasIdentifiers: true,
      pricingReconciles: true,
      bidAmount: 50000,
      nowIso: "2026-01-01T00:00:00Z",
    });
    expect(v.passed).toBe(true);
  });
});
