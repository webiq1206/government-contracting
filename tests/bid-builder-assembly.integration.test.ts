/**
 * The Bid Builder, end to end, against a real database.
 *
 * The pure package tests prove the rules. This proves the AGENT applies them:
 * it runs the real bid-builder against a real opportunity carrying a realistic
 * solicitation analysis, and asserts what actually lands in the bids row — the
 * compliance matrix, the manifest, the validation, and package_ready — because
 * that row is what the operator sees and submits from.
 *
 * Only the outside world is mocked: Claude (narrative), the document
 * renderers, and blob storage. Every decision under test is the real one.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import type { ComplianceRequirement, PackageItem, ResolvedRequirement } from "../lib/types";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

const SOL = "W912DY-26-R-0007";

vi.mock("../lib/ai/claude", () => ({
  complete: vi.fn(async () => ({ text: "Technical approach narrative.", usage: {} })),
  ClaudeNotConfiguredError: class extends Error {},
  claudeEnabled: async () => true,
}));
vi.mock("../lib/ai/contentLibrary", () => ({
  retrieveRelevantContent: async () => [],
  renderContentForPrompt: () => "",
}));
vi.mock("../lib/integrations/storage", () => ({
  storage: {
    upload: vi.fn(async (key: string) => ({ path: key, backend: "db" })),
    download: vi.fn(async () => Buffer.from("x")),
  },
}));
const coverLetterCalls: unknown[] = [];
vi.mock("../lib/integrations/documents", () => ({
  documents: {
    buildBidPdf: async () => Buffer.from("%PDF-1.4 bid"),
    buildBidDocx: async () => Buffer.from("docx"),
    buildCoverLetterPdf: (...args: unknown[]) => coverLetterCalls.push(args[0]) && Promise.resolve(Buffer.from("%PDF cover")),
    buildPricingSchedulePdf: async () => Buffer.from("%PDF pricing"),
    buildRepsAndCertsPdf: async () => Buffer.from("%PDF reps"),
    buildCapabilityStatementPdf: async () => Buffer.from("%PDF cap"),
    buildComplianceMatrixPdf: async () => Buffer.from("%PDF checklist"),
    buildAmendmentAckPdf: async () => Buffer.from("%PDF ack"),
    renderSignedW9Pdf: async () => Buffer.from("%PDF w9"),
  },
}));
/*
 * The real module underneath, with only the settings this test means to pin.
 *
 * A factory that lists exports replaces the whole module, so the first agent
 * to read a new setting gets undefined and the failure surfaces as a wrong
 * assertion three files away rather than as a missing mock. Spreading the
 * original keeps the pinning explicit and lets everything else be real.
 */
vi.mock("../lib/app-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/app-settings")>()),
  getAutomationRules: async () => ({ submit_lead_hours: 24, urgent_days: 3, retention_days: 0 }),
  areCallsEnabled: async () => false,
  isAutomationPaused: async () => false,
  isAutomationStopped: async () => false,
  isPlatformAutomationPaused: async () => false,
  AUTOMATION_PAUSED_ERROR: "paused",
}));
vi.mock("../lib/ai/companyProfile", () => ({
  getProfileJson: async () => ({
    legal_name: "Prime Contracting LLC",
    uei: "ABC123DEF456",
    cage_code: "1A2B3",
    target_margin_pct: 20,
    primary_trades: ["electrical", "plumbing"],
    naics_codes: ["238210"],
    service_areas: ["California"],
    certifications: [],
    past_performance: [],
    decision_thresholds: {
      submit_lead_hours: 24,
      pursue_min_score: 70,
      review_min_score: 50,
      value_max: null,
    },
    pricing_rules: {},
    sub_standards: {},
  }),
}));

/** The requirements a real construction RFQ states. */
const REQUIREMENTS: ComplianceRequirement[] = [
  { id: "sf1449", title: "Signed SF-1449 (offer form)", category: "form", mandatory: true,
    source: "Section A", signature_required: true, satisfied_by: "operator_signature", official_form: "SF 1449" },
  { id: "bid_schedule", title: "Bid schedule with unit pricing", category: "pricing", mandatory: true,
    source: "Section B", signature_required: false, satisfied_by: "auto_generated" },
  { id: "reps_certs", title: "Representations and certifications", category: "certification", mandatory: true,
    source: "Section K", signature_required: true, satisfied_by: "from_profile" },
  { id: "tech_approach", title: "Technical approach narrative", category: "narrative", mandatory: true,
    source: "Section L.3", format: "10 pages maximum", signature_required: false, satisfied_by: "auto_generated" },
  { id: "bid_bond", title: "Bid bond at 20% of the offered price", category: "attachment", mandatory: true,
    source: "Section L.5", signature_required: false, satisfied_by: "operator_provided",
    instructions: "Obtain a bid bond from your surety." },
  { id: "transmittal", title: "Transmittal letter", category: "narrative", mandatory: true,
    source: "Section L.1", signature_required: false, satisfied_by: "auto_generated" },
];

d("bid builder assembly (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let bidBuilder: typeof import("../lib/agents/bid-builder").bidBuilder;
  const org = { id: "" }; const opp = { id: "" }; const sub = { id: "" };

  async function bidRow() {
    return queryOne<{
      compliance_matrix: ResolvedRequirement[] | null;
      package_manifest: PackageItem[] | null;
      validation_json: { passed: boolean; blockers: string[]; total_mandatory: number } | null;
      package_ready: boolean;
      bid_amount: string | null;
      human_flags: string[] | null;
    }>(
      `select compliance_matrix, package_manifest, validation_json, package_ready, bid_amount, human_flags
         from bids where opportunity_id=$1 order by created_at desc limit 1`,
      [opp.id]
    );
  }
  const run = (id = opp.id) =>
    bidBuilder.handler({ runId: randomUUID(), trigger: "queue", payload: { opportunityId: id } });

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ bidBuilder } = await import("../lib/agents/bid-builder"));
    const o = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
      [`bb-${randomUUID()}`]
    );
    org.id = o!.id;
    const op = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, solicitation_number, deadline, solicitation_analysis)
       values ($1,'test','Hangar electrical upgrade','bid_building','open',$2, now() + interval '30 days', $3::jsonb)
       returning id`,
      [org.id, SOL, JSON.stringify({
        required_trades: ["electrical"],
        compliance_matrix: REQUIREMENTS,
        qa_addenda: [{ label: "Amendment 0001", date: "2026-08-01", summary: "Revised scope" }],
      })]
    );
    opp.id = op!.id;
    const s = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories, state) values ($1,'Elec Co',$2,'CA') returning id`,
      [org.id, ["electrical"]]
    );
    sub.id = s!.id;
    await query(
      `insert into quotes (org_id, opportunity_id, subcontractor_id, trade, quote_amount) values ($1,$2,$3,'electrical',100000)`,
      [org.id, opp.id, sub.id]
    );
  });

  afterAll(async () => {
    if (!org.id) return;
    for (const t of ["documents", "quotes", "bids", "subcontractors", "opportunities", "agent_logs"]) {
      await query(`delete from ${t} where org_id=$1`, [org.id]).catch(() => {});
    }
    await query(`delete from organizations where id=$1`, [org.id]).catch(() => {});
    vi.restoreAllMocks();
  });

  it("builds a package carrying every requirement this solicitation states", async () => {
    const res = await run();
    expect(res.ok).toBe(true);
    const bid = await bidRow();
    const ids = (bid!.compliance_matrix ?? []).map((r) => r.id).sort();
    // Every stated requirement, plus the amendment acknowledgment the builder
    // adds because amendments were issued and none was captured.
    expect(ids).toContain("sf1449");
    expect(ids).toContain("bid_schedule");
    expect(ids).toContain("reps_certs");
    expect(ids).toContain("tech_approach");
    expect(ids).toContain("bid_bond");
    expect(ids).toContain("amendment_ack");
    // The manifest mirrors the matrix one-for-one, led by the priced offer.
    const manifest = bid!.package_manifest ?? [];
    expect(manifest[0].document_kind).toBe("bid_pdf");
    const reqItems = manifest.filter((m) => m.requirement_id !== "__bid_pdf");
    expect(reqItems).toHaveLength(bid!.compliance_matrix!.length);
    expect(reqItems.map((m) => m.requirement_id).sort()).toEqual(ids);
  });

  it("prices the bid to the target margin from the sub quotes", async () => {
    const bid = await bidRow();
    // 100k of sub cost at a 20% target margin = 125k.
    expect(Number(bid!.bid_amount)).toBe(125000);
  });

  it("is NOT ready while the operator still owes signatures and the bond", async () => {
    const bid = await bidRow();
    expect(bid!.package_ready).toBe(false);
    const blockers = (bid!.validation_json?.blockers ?? []).join(" | ");
    expect(blockers).toContain("SF-1449");        // official form, operator signs
    expect(blockers).toContain("Representations"); // signature required
    expect(blockers).toContain("Bid bond");        // operator provides
    expect(blockers).toContain("Acknowledgment");  // amendments issued
  });

  it("names every package file for THIS solicitation", async () => {
    const bid = await bidRow();
    for (const item of bid!.package_manifest ?? []) {
      expect(item.filename.toLowerCase()).toContain("w912dy_26_r_0007");
    }
  });

  it("puts the operator's own uploaded document into the package", async () => {
    // The bid bond is the operator's; before the requirement link existed, the
    // zip carried a "__PROVIDE_THIS.txt" placeholder in its place and their
    // actual bond was never in the archive they submit.
    const { attachToRequirement } = await import("../lib/bid-package-state");
    await query(
      `insert into documents (opportunity_id, kind, name, storage_path, storage_backend, mime, requirement_id)
       values ($1,'operator_upload','Bid Bond signed.pdf','op/bond.pdf','local','application/pdf','bid_bond')`,
      [opp.id]
    );
    const res = await attachToRequirement({
      opportunityId: opp.id,
      orgId: org.id,
      requirementId: "bid_bond",
      doc: { name: "Bid Bond signed.pdf", path: "op/bond.pdf", mime: "application/pdf" },
    });
    expect(res.ok).toBe(true);

    const bid = await bidRow();
    const row = (bid!.compliance_matrix ?? []).find((r) => r.id === "bid_bond");
    expect(row?.status).toBe("satisfied");
    expect(row?.operator_doc?.path).toBe("op/bond.pdf");
    // And the manifest, which is exactly what the download route zips.
    const item = (bid!.package_manifest ?? []).find((m) => m.requirement_id === "bid_bond");
    expect(item?.document_path).toBe("op/bond.pdf");
    expect(item?.source).toBe("operator");
    expect(item?.filename).not.toMatch(/PROVIDE_THIS/);
    // The bond no longer blocks; the signatures still do.
    expect((bid!.validation_json?.blockers ?? []).join(" | ")).not.toContain("Bid bond");
  });

  it("keeps that upload attached when the package is rebuilt", async () => {
    await run();
    const bid = await bidRow();
    const row = (bid!.compliance_matrix ?? []).find((r) => r.id === "bid_bond");
    expect(row?.operator_doc?.path).toBe("op/bond.pdf");
    expect(row?.status).toBe("satisfied");
  });

  it("refuses to submit once the requirements move under an assembled package", async () => {
    const before = await queryOne<{ requirements_fingerprint: string | null }>(
      `select requirements_fingerprint from bids where opportunity_id=$1 order by created_at desc limit 1`,
      [opp.id]
    );
    expect(before?.requirements_fingerprint).toBeTruthy();

    // An amendment adds a requirement nobody has answered yet.
    const { currentRequirementsFingerprint } = await import("../lib/bid-package-state");
    const opRow = await queryOne<{ solicitation_analysis: Record<string, unknown> }>(
      `select solicitation_analysis from opportunities where id=$1`,
      [opp.id]
    );
    const analysis = opRow!.solicitation_analysis as {
      compliance_matrix: ComplianceRequirement[];
    };
    const amended = {
      ...analysis,
      compliance_matrix: [
        ...analysis.compliance_matrix,
        {
          id: "wage_cert",
          title: "Davis-Bacon wage rate certification",
          category: "certification",
          mandatory: true,
          source: "Amendment 0002",
          signature_required: true,
          satisfied_by: "operator_signature",
        },
      ],
    };
    expect(currentRequirementsFingerprint({ solicitation_analysis: amended as never })).not.toBe(
      before!.requirements_fingerprint
    );
  });

  it("will not close a page-limited item with an over-length document", async () => {
    // Section L.3 allows 10 pages. A twelve-page technical approach is the
    // single likeliest way an otherwise good volume becomes non-responsive,
    // and it is the one format rule a machine can actually check.
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    for (let i = 0; i < 12; i++) doc.addPage([612, 792]);
    const bytes = Buffer.from(await doc.save());

    const { attachToRequirement } = await import("../lib/bid-package-state");
    const res = await attachToRequirement({
      opportunityId: opp.id,
      orgId: org.id,
      requirementId: "tech_approach",
      doc: { name: "Technical Approach.pdf", path: "op/tech.pdf", mime: "application/pdf" },
      bytes,
    });
    expect(res.ok).toBe(true);
    expect(res.error).toMatch(/12 pages and the solicitation allows 10/);

    const bid = await bidRow();
    const row = (bid!.compliance_matrix ?? []).find((r) => r.id === "tech_approach");
    // Attached, because it is their document, but not done.
    expect(row?.operator_doc?.path).toBe("op/tech.pdf");
    expect(row?.status).toBe("needs_operator");
    expect(row?.note).toContain("12 pages");
    expect(bid!.package_ready).toBe(false);
  });

  it("refreshes the transmittal letter when what is enclosed changes", async () => {
    coverLetterCalls.length = 0;
    const { attachToRequirement } = await import("../lib/bid-package-state");
    await attachToRequirement({
      opportunityId: opp.id,
      orgId: org.id,
      requirementId: "bid_bond",
      doc: { name: "Bid Bond signed.pdf", path: "op/bond.pdf", mime: "application/pdf" },
    });
    // The letter says "the following documents are enclosed". The bond just
    // became enclosed, so the letter has to say so.
    expect(coverLetterCalls.length).toBeGreaterThan(0);
    const last = coverLetterCalls[coverLetterCalls.length - 1] as { contents: string[] };
    expect(last.contents).toContain("Bid bond at 20% of the offered price");
    expect(last.contents).toContain("Priced offer");
    // And it never encloses itself or the internal checklist.
    expect(last.contents.some((c) => /transmittal|checklist/i.test(c))).toBe(false);
  });

  it("holds the bid and flags the opportunity when NO requirements were extracted", async () => {
    // A second opportunity whose analysis produced no compliance matrix (the
    // documents were scans, or analysis never ran). The package would be
    // empty, so the build must refuse to call it ready and must say why.
    const op2 = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, solicitation_number, deadline, solicitation_analysis)
       values ($1,'test','Unanalyzed job','bid_building','open','ZZ-000', now() + interval '30 days', $2::jsonb)
       returning id`,
      [org.id, JSON.stringify({ required_trades: [] })]
    );
    await query(
      `insert into quotes (org_id, opportunity_id, subcontractor_id, trade, quote_amount) values ($1,$2,$3,'electrical',50000)`,
      [org.id, op2!.id, sub.id]
    );
    const res = await run(op2!.id);
    expect(res.ok).toBe(true);

    const bid = await queryOne<{ package_ready: boolean; validation_json: { blockers: string[] } | null; human_flags: string[] | null }>(
      `select package_ready, validation_json, human_flags from bids where opportunity_id=$1 order by created_at desc limit 1`,
      [op2!.id]
    );
    expect(bid!.package_ready).toBe(false);
    expect((bid!.validation_json?.blockers ?? []).join(" ")).toMatch(/have not been extracted/i);
    expect(bid!.human_flags ?? []).toContain("requirements_missing");

    // And the operator is told on the opportunity itself, not just in the package.
    const oppRow = await queryOne<{ human_action_required: boolean; risk_flags: string[] | null }>(
      `select human_action_required, risk_flags from opportunities where id=$1`, [op2!.id]
    );
    expect(oppRow!.human_action_required).toBe(true);
    expect(oppRow!.risk_flags ?? []).toContain("requirements_missing");
  });
});
