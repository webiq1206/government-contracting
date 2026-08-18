/**
 * Package fidelity: the assembled bid must match THIS solicitation exactly.
 *
 * The existing package.test.ts checks each function's own behaviour. What is
 * asserted here is the property that decides whether a submitted bid is
 * responsive: every requirement the solicitation states reaches the package
 * exactly once, nothing is invented, nothing is silently dropped, and the
 * package can only read as ready when every mandatory item is genuinely done.
 *
 * The fixture is shaped like a real construction RFQ: an SF-1449 offer form,
 * a bid schedule, reps and certs, a technical approach with a page limit, a
 * bid bond, an amendment acknowledgment, and one optional item.
 */
import { describe, it, expect } from "vitest";
import {
  resolveRequirements,
  buildManifest,
  validatePackage,
  computeReady,
} from "@/lib/domain/package";
import { enclosureList } from "@/lib/agents/package-builder";
import type { ComplianceRequirement } from "@/lib/types";

const SOL = "W912DY-26-R-0007";

/** A realistic federal solicitation's stated submission requirements. */
function solicitationRequirements(): ComplianceRequirement[] {
  return [
    {
      id: "sf1449",
      title: "Signed SF-1449 (offer form)",
      category: "form",
      mandatory: true,
      source: "Section A",
      signature_required: true,
      satisfied_by: "operator_signature",
      official_form: "SF 1449",
    },
    {
      id: "bid_schedule",
      title: "Bid schedule with unit pricing",
      category: "pricing",
      mandatory: true,
      source: "Section B",
      signature_required: false,
      satisfied_by: "auto_generated",
    },
    {
      id: "reps_certs",
      title: "Representations and certifications",
      category: "certification",
      mandatory: true,
      source: "Section K",
      signature_required: true,
      satisfied_by: "from_profile",
    },
    {
      id: "tech_approach",
      title: "Technical approach narrative",
      category: "narrative",
      mandatory: true,
      source: "Section L.3",
      format: "10 pages maximum, 12pt Times New Roman",
      signature_required: false,
      satisfied_by: "auto_generated",
    },
    {
      id: "bid_bond",
      title: "Bid bond at 20% of the offered price",
      category: "attachment",
      mandatory: true,
      source: "Section L.5",
      signature_required: false,
      satisfied_by: "operator_provided",
      instructions: "Obtain a bid bond from your surety and attach it.",
    },
    {
      id: "amendment_ack",
      title: "Acknowledgment of Amendments 0001-0002",
      category: "acknowledgment",
      mandatory: true,
      source: "Amendments 0001, 0002",
      signature_required: true,
      satisfied_by: "operator_signature",
    },
    {
      id: "past_perf_optional",
      title: "Additional past performance references",
      category: "attachment",
      mandatory: false,
      source: "Section L.7 (optional)",
      signature_required: false,
      satisfied_by: "operator_provided",
    },
  ];
}

const ctx = { confirmed: new Set<string>(), hasNarrative: true, hasIdentifiers: true };
const validate = (resolved: ReturnType<typeof resolveRequirements>, over = {}) =>
  validatePackage({
    resolved,
    hasIdentifiers: true,
    pricingReconciles: true,
    bidAmount: 250000,
    nowIso: "2026-08-18T00:00:00.000Z",
    ...over,
  });

describe("no requirement is dropped or invented", () => {
  it("every stated requirement reaches the manifest exactly once", () => {
    const reqs = solicitationRequirements();
    const manifest = buildManifest(resolveRequirements(reqs, ctx), SOL);

    // The priced offer leads the package; every requirement follows it.
    expect(manifest[0].document_kind).toBe("bid_pdf");
    const reqItems = manifest.filter((m) => m.requirement_id !== "__bid_pdf");
    expect(reqItems).toHaveLength(reqs.length);
    const manifestIds = reqItems.map((m) => m.requirement_id).sort();
    expect(manifestIds).toEqual(reqs.map((r) => r.id).sort());
    expect(new Set(manifestIds).size).toBe(manifestIds.length);
  });

  it("orders are contiguous starting at 1, so nothing is missing from the sequence", () => {
    const manifest = buildManifest(resolveRequirements(solicitationRequirements(), ctx), SOL);
    expect(manifest.map((m) => m.order)).toEqual(
      Array.from({ length: manifest.length }, (_, i) => i + 1)
    );
  });

  it("names every file for THIS solicitation, so a package cannot be confused with another", () => {
    const manifest = buildManifest(resolveRequirements(solicitationRequirements(), ctx), SOL);
    for (const item of manifest) {
      expect(item.filename.toLowerCase()).toContain("w912dy_26_r_0007");
    }
    // A different solicitation produces different filenames for the same reqs.
    const other = buildManifest(resolveRequirements(solicitationRequirements(), ctx), "FA8501-26-Q-0042");
    expect(other[0].filename).not.toBe(manifest[0].filename);
  });

  it("puts the offer form and pricing ahead of supporting attachments", () => {
    const manifest = buildManifest(resolveRequirements(solicitationRequirements(), ctx), SOL);
    const pos = (id: string) => manifest.findIndex((m) => m.requirement_id === id);
    expect(pos("tech_approach")).toBeLessThan(pos("sf1449")); // narrative first
    expect(pos("sf1449")).toBeLessThan(pos("bid_schedule"));
    expect(pos("bid_schedule")).toBeLessThan(pos("reps_certs"));
    expect(pos("reps_certs")).toBeLessThan(pos("amendment_ack"));
    expect(pos("amendment_ack")).toBeLessThan(pos("bid_bond"));
  });
});

describe("the package cannot read as ready while the solicitation is unmet", () => {
  it("blocks on every unmet mandatory item, naming each one", () => {
    const resolved = resolveRequirements(solicitationRequirements(), ctx);
    const v = validate(resolved);
    expect(v.passed).toBe(false);
    const text = v.blockers.join(" | ");
    // The four items a human must actually do are each called out.
    expect(text).toContain("SF-1449");
    expect(text).toContain("Representations");
    expect(text).toContain("Bid bond");
    expect(text).toContain("Acknowledgment of Amendments");
    // The optional item is a warning, never a blocker.
    expect(text).not.toContain("Additional past performance");
    expect(v.warnings.join(" ")).toContain("Additional past performance");
  });

  it("still blocks when only ONE mandatory item is outstanding", () => {
    const reqs = solicitationRequirements();
    // Everything confirmed except the bid bond.
    const confirmed = new Set(reqs.filter((r) => r.id !== "bid_bond").map((r) => r.id));
    const resolved = resolveRequirements(reqs, { ...ctx, confirmed });
    const v = validate(resolved);
    expect(v.passed).toBe(false);
    expect(v.blockers.join(" ")).toContain("Bid bond");
    expect(computeReady(v, [])).toBe(false);
  });

  it("passes only when every mandatory item is done, and the optional one never blocks", () => {
    const reqs = solicitationRequirements();
    const confirmed = new Set(reqs.filter((r) => r.mandatory).map((r) => r.id));
    const resolved = resolveRequirements(reqs, { ...ctx, confirmed });
    const v = validate(resolved);
    expect(v.passed).toBe(true);
    expect(v.total_mandatory).toBe(6);
    expect(computeReady(v, [])).toBe(true);
  });

  it("a required official agency form is never auto-satisfied, even if the model said so", () => {
    // The model mislabels the SF-1449 as auto_generated. The package must
    // still route it to the operator: we cannot reproduce an agency form.
    const reqs = solicitationRequirements().map((r) =>
      r.id === "sf1449" ? { ...r, satisfied_by: "auto_generated" as const } : r
    );
    const resolved = resolveRequirements(reqs, ctx);
    const sf = resolved.find((r) => r.id === "sf1449")!;
    expect(sf.status).toBe("needs_operator");
    expect(validate(resolved).passed).toBe(false);
  });
});

describe("an unextracted requirements matrix fails closed", () => {
  it("blocks an empty matrix instead of shipping an empty package as ready", () => {
    // The dangerous state: analysis never ran, or the documents were scans.
    // Every mandatory loop iterates zero items, so without an explicit check
    // this validated as passed and displayed as ready to submit.
    const v = validate([]);
    expect(v.passed).toBe(false);
    expect(v.blockers.join(" ")).toMatch(/have not been extracted/i);
    expect(computeReady(v, [])).toBe(false);
    // And the package would have carried nothing but the bid PDF: not one
    // of the forms, certifications, or acknowledgments the agency asked for.
    expect(buildManifest([], SOL).filter((m) => m.requirement_id !== "__bid_pdf")).toHaveLength(0);
  });

  it("does not fire that blocker once requirements exist", () => {
    const reqs = solicitationRequirements();
    const confirmed = new Set(reqs.filter((r) => r.mandatory).map((r) => r.id));
    const v = validate(resolveRequirements(reqs, { ...ctx, confirmed }));
    expect(v.blockers.join(" ")).not.toMatch(/have not been extracted/i);
    expect(v.passed).toBe(true);
  });
});

describe("generated documents must actually exist", () => {
  it("blocks when a document the package claims to have generated is not in storage", () => {
    const reqs = solicitationRequirements();
    const confirmed = new Set(reqs.filter((r) => r.mandatory).map((r) => r.id));
    const resolved = resolveRequirements(reqs, { ...ctx, confirmed });
    // Operator-confirmed items are exempt by design, so use an unconfirmed
    // auto-generated requirement to exercise the storage check.
    const onlyGenerated = resolveRequirements(
      [reqs.find((r) => r.id === "bid_schedule")!],
      ctx
    );
    const v = validate(onlyGenerated, { presentDocKinds: new Set(["bid_pdf"]) });
    expect(v.passed).toBe(false);
    expect(v.blockers.join(" ")).toMatch(/missing from storage/i);
    expect(resolved).toHaveLength(reqs.length); // sanity
  });
});

describe("the transmittal letter's enclosure list", () => {
  it("names only what is actually in the envelope", () => {
    const resolved = resolveRequirements(solicitationRequirements(), ctx);
    const list = enclosureList(resolved);
    // The priced offer is always produced and always enclosed. The compliance
    // checklist is NOT: it is an internal pre-flight page whose rows say
    // things like "You must provide this", so it rides in the archive marked
    // do-not-submit and must never be certified as enclosed.
    expect(list[0]).toBe("Priced offer");
    expect(list.some((l) => /checklist/i.test(l))).toBe(false);
    // The bond is the operator's and is not in the package yet, so the letter
    // must not certify it as enclosed.
    const outstanding = resolved.filter((r) => r.status !== "satisfied").map((r) => r.title);
    for (const title of outstanding) expect(list).not.toContain(title);
    // And the letter does not enclose itself.
    expect(list.filter((l) => /cover|transmittal/i.test(l))).toHaveLength(0);
  });
});
