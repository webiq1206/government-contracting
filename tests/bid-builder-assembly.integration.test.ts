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
vi.mock("../lib/integrations/documents", () => ({
  documents: {
    buildBidPdf: async () => Buffer.from("%PDF-1.4 bid"),
    buildBidDocx: async () => Buffer.from("docx"),
    buildCoverLetterPdf: async () => Buffer.from("%PDF cover"),
    buildPricingSchedulePdf: async () => Buffer.from("%PDF pricing"),
    buildRepsAndCertsPdf: async () => Buffer.from("%PDF reps"),
    buildCapabilityStatementPdf: async () => Buffer.from("%PDF cap"),
    buildComplianceMatrixPdf: async () => Buffer.from("%PDF checklist"),
    buildAmendmentAckPdf: async () => Buffer.from("%PDF ack"),
    renderSignedW9Pdf: async () => Buffer.from("%PDF w9"),
  },
}));
vi.mock("../lib/app-settings", () => ({
  getAutomationRules: async () => ({ submit_lead_hours: 24, urgent_days: 3, retention_days: 0 }),
  areCallsEnabled: async () => false,
  isAutomationPaused: async () => false,
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
