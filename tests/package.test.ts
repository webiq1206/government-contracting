import { describe, it, expect } from "vitest";
import {
  resolveRequirements,
  buildManifest,
  validatePackage,
  computeReady,
  openAuditBlockers,
  confirmedKeys,
  auditFindingKey,
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
        req({ id: "cover", title: "Cover letter", category: "narrative", satisfied_by: "auto_generated" }),
        req({ id: "cap", title: "Capability statement", category: "attachment", satisfied_by: "from_profile" }),
      ],
      ctx
    );
    expect(r.map((x) => x.status)).toEqual(["satisfied", "satisfied", "satisfied"]);
    expect(r[0].artifact_kind).toBe("pricing_schedule");
    expect(r[1].artifact_kind).toBe("cover_letter");
    // A requirement that names a capability statement still gets one.
    expect(r[2].artifact_kind).toBe("capability_statement");
  });

  it("does not answer a written volume with the transmittal letter", () => {
    // A technical approach is scored against the evaluation factors and is
    // usually page limited. Satisfying it with the cover letter produced a
    // package that looked complete and was unresponsive.
    const r = resolveRequirements(
      [
        req({
          id: "tech",
          title: "Technical approach",
          category: "narrative",
          satisfied_by: "auto_generated",
        }),
        req({
          id: "mgmt",
          title: "Management plan",
          category: "narrative",
          satisfied_by: "auto_generated",
        }),
      ],
      ctx
    );
    expect(r.map((x) => x.status)).toEqual(["needs_operator", "needs_operator"]);
    expect(r[0].artifact_kind).toBeUndefined();
    expect(r[1].artifact_kind).toBeUndefined();
  });

  it("stops calling an item done when a format rule has not been checked", () => {
    const r = resolveRequirements(
      [
        req({
          id: "price",
          title: "Pricing schedule",
          category: "pricing",
          satisfied_by: "auto_generated",
          format: "Submit on the agency Excel worksheet, Attachment 3",
        }),
        req({
          id: "cover",
          title: "Cover letter",
          category: "narrative",
          satisfied_by: "auto_generated",
          format: "2 pages maximum",
        }),
        req({
          id: "plain",
          title: "Capability statement",
          category: "attachment",
          satisfied_by: "from_profile",
          format: "PDF",
        }),
      ],
      ctx
    );
    expect(r[0].status).toBe("needs_operator");
    expect(r[0].note).toContain("Attachment 3");
    expect(r[1].status).toBe("needs_operator");
    expect(r[1].note).toContain("2 pages maximum");
    // A plain "PDF" is a rule we do meet, so it must not block anything.
    expect(r[2].status).toBe("satisfied");
  });

  it("keeps a confirmation when re-analysis regenerates the requirement id", () => {
    // The model invents the slug each run. Matching on it alone threw away
    // the operator's signed-and-uploaded confirmations on every re-analysis.
    const before = resolveRequirements(
      [req({ id: "sf1449", title: "Signed SF-1449 offer form", official_form: "SF-1449" })],
      { ...ctx, confirmed: new Set(["sf1449"]) }
    );
    expect(before[0].status).toBe("satisfied");
    const keys = confirmedKeys(before);
    const after = resolveRequirements(
      [
        req({
          id: "signed_sf_1449_offer",
          title: "SF-1449 offer form, signed",
          official_form: "SF 1449",
        }),
      ],
      { ...ctx, confirmed: keys }
    );
    expect(after[0].status).toBe("satisfied");
    expect(after[0].operator_confirmed).toBe(true);
  });

  it("does not offer a generated document for a supporting attachment", () => {
    // We cannot produce a certificate of insurance or a licence. Mapping
    // these onto the capability statement gave two requirements the same
    // file under two official-looking names.
    const r = resolveRequirements(
      [
        req({ id: "coi", title: "Certificate of insurance", category: "attachment", satisfied_by: "from_profile" }),
        req({ id: "lic", title: "State contractor licence", category: "attachment", satisfied_by: "from_profile" }),
      ],
      ctx
    );
    expect(r[0].artifact_kind).toBeUndefined();
    expect(r[1].artifact_kind).toBeUndefined();
  });

  it("lets only one requirement claim a given generated document", () => {
    const r = resolveRequirements(
      [
        req({ id: "a", title: "Pricing schedule", category: "pricing", satisfied_by: "auto_generated" }),
        req({ id: "b", title: "Unit price breakdown", category: "pricing", satisfied_by: "auto_generated" }),
      ],
      ctx
    );
    expect(r[0].artifact_kind).toBe("pricing_schedule");
    expect(r[0].status).toBe("satisfied");
    // The second cannot be satisfied by the same file.
    expect(r[1].artifact_kind).toBeUndefined();
    expect(r[1].status).toBe("needs_operator");
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
    // The priced offer itself leads every package.
    expect(m[0].document_kind).toBe("bid_pdf");
    expect(m[0].order).toBe(1);
    expect(m[1].category).toBe("narrative"); // then the cover letter
    expect(m[1].order).toBe(2);
    expect(m[1].filename).toMatch(/^02_cover_letter_w912_25_r_0001\.pdf$/);
    expect(m[2].category).toBe("pricing");
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

describe("auditFindingKey", () => {
  it("identifies a finding by what it says, not by where it sits", () => {
    // AI findings are renumbered af_1..af_n on every audit. Keying on the id
    // meant an acknowledged finding came straight back unacknowledged after
    // any rebuild, and re-blocked the submission.
    const a = { id: "af_2", finding: "No bonding capacity is stated.", requirement_id: "bond" };
    const b = { id: "af_5", finding: "no  bonding capacity is stated", requirement_id: "bond" };
    expect(auditFindingKey(a)).toBe(auditFindingKey(b));
    expect(auditFindingKey(a)).not.toBe(
      auditFindingKey({ finding: "No insurance certificate.", requirement_id: "bond" })
    );
    // The same sentence about a different requirement is a different finding.
    expect(auditFindingKey(a)).not.toBe(
      auditFindingKey({ finding: "No bonding capacity is stated.", requirement_id: "insurance" })
    );
  });
});
