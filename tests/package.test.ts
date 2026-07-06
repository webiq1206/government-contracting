import { describe, it, expect } from "vitest";
import {
  resolveRequirements,
  buildManifest,
  validatePackage,
  type ResolveContext,
} from "../lib/domain/package";
import type { ComplianceRequirement } from "../lib/types";

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
});
