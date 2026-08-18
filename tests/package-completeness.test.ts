/**
 * Two properties that decide whether the downloaded archive is the whole bid:
 * the operator's own documents are in it, and the requirements it was built
 * from are still the requirements being asked for.
 */
import { describe, it, expect } from "vitest";
import {
  resolveRequirements,
  buildManifest,
  validatePackage,
  requirementsFingerprint,
  type ResolveContext,
} from "../lib/domain/package";
import type { ComplianceRequirement, ResolvedRequirement } from "../lib/types";

const ctx: ResolveContext = {
  confirmed: new Set(),
  hasNarrative: true,
  hasIdentifiers: true,
};

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

describe("operator documents in the package", () => {
  it("puts the uploaded file in the manifest instead of a placeholder", () => {
    const resolved = resolveRequirements(
      [req({ id: "bond", title: "Bid bond", category: "attachment" })],
      ctx
    );
    // Before the upload: a placeholder nobody can submit.
    const before = buildManifest(resolved, "W912DY-26-R-0007");
    expect(before[1].filename).toMatch(/__PROVIDE_THIS\.txt$/);
    expect(before[1].document_path).toBeUndefined();

    const attached: ResolvedRequirement[] = resolved.map((r) => ({
      ...r,
      operator_doc: { name: "Bid Bond signed.pdf", path: "opportunities/o1/operator/bond.pdf" },
      operator_confirmed: true,
      status: "satisfied",
    }));
    const after = buildManifest(attached, "W912DY-26-R-0007");
    expect(after[1].source).toBe("operator");
    expect(after[1].document_path).toBe("opportunities/o1/operator/bond.pdf");
    expect(after[1].filename).toMatch(/\.pdf$/);
    expect(after[1].filename).not.toMatch(/PROVIDE_THIS/);
  });

  it("keeps the uploaded file's own extension", () => {
    const resolved = resolveRequirements([req({ id: "x", title: "Pricing worksheet" })], ctx).map(
      (r) => ({
        ...r,
        operator_doc: { name: "Attachment 3 Pricing.xlsx", path: "p/a.xlsx" },
        status: "satisfied" as const,
      })
    );
    expect(buildManifest(resolved, null)[1].filename).toMatch(/\.xlsx$/);
  });

  it("prefers what the operator signed over the blank agency form", () => {
    const resolved = resolveRequirements(
      [req({ id: "sf", title: "Offer form", official_form: "SF-1449" })],
      ctx
    ).map((r) => ({
      ...r,
      official_form_doc: { name: "SF1449.pdf", path: "sol/sf1449.pdf" },
      operator_doc: { name: "SF1449 signed.pdf", path: "op/signed.pdf" },
      status: "satisfied" as const,
    }));
    expect(buildManifest(resolved, null)[1].document_path).toBe("op/signed.pdf");
  });
});

describe("requirementsFingerprint", () => {
  const base = [
    { id: "sf1449", title: "Signed SF-1449", mandatory: true, official_form: "SF-1449" },
    { id: "price", title: "Pricing schedule", mandatory: true },
  ];

  it("ignores changes that do not change what the package must contain", () => {
    const a = requirementsFingerprint(base);
    // Re-analysis renames the slug and re-words nothing material.
    const b = requirementsFingerprint([
      { id: "signed_sf_1449", title: "Signed SF-1449", mandatory: true, official_form: "SF 1449" },
      { id: "pricing", title: "Pricing schedule", mandatory: true },
    ]);
    expect(a).toBe(b);
    // Order is not meaning.
    expect(requirementsFingerprint([...base].reverse())).toBe(a);
  });

  it("changes when a requirement, a form, or an amendment changes", () => {
    const a = requirementsFingerprint(base);
    expect(requirementsFingerprint([...base, { id: "bond", title: "Bid bond", mandatory: true }])).not.toBe(a);
    expect(requirementsFingerprint([base[0]])).not.toBe(a);
    expect(
      requirementsFingerprint([{ ...base[0], official_form: "SF-33" }, base[1]])
    ).not.toBe(a);
    expect(requirementsFingerprint(base, [{ label: "Amendment 0001" }])).not.toBe(a);
  });
});

describe("validatePackage drift", () => {
  const resolved = resolveRequirements(
    [req({ id: "price", title: "Pricing schedule", category: "pricing", satisfied_by: "auto_generated" })],
    ctx
  );
  const input = {
    resolved,
    hasIdentifiers: true,
    pricingReconciles: true,
    bidAmount: 125_000,
    nowIso: new Date().toISOString(),
  };

  it("blocks when the requirements moved after the package was built", () => {
    const v = validatePackage({ ...input, builtFingerprint: "aaaa1111", currentFingerprint: "bbbb2222" });
    expect(v.passed).toBe(false);
    expect(v.blockers.join(" ")).toMatch(/requirements changed after this package was assembled/i);
  });

  it("does not block when they match, or when one side is unknown", () => {
    expect(
      validatePackage({ ...input, builtFingerprint: "aaaa1111", currentFingerprint: "aaaa1111" }).passed
    ).toBe(true);
    // An older bid row has no fingerprint at all; that is not drift.
    expect(
      validatePackage({ ...input, builtFingerprint: null, currentFingerprint: "bbbb2222" }).passed
    ).toBe(true);
  });
});
