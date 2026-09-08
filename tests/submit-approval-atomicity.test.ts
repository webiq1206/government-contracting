import { beforeEach, describe, expect, it, vi } from "vitest";
import { requirementsFingerprint } from "@/lib/domain/package";
import type { PricingRow } from "@/lib/domain/pricing-row";

const ORG = "7dbd9b8b-c9fc-4b1f-85e3-59866816b75c";
const OPP = "96dbe890-29f0-4cf7-8c36-a90f4194dc81";
const BID = "ae31b41e-c315-49a7-806c-edf8e2c772bd";

const mocks = vi.hoisted(() => ({
  requireOrgContext: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn(),
  clientQuery: vi.fn(),
  pricingRows: vi.fn(),
  transactionPricingRows: vi.fn(),
  profile: vi.fn(),
  logAgent: vi.fn(async () => undefined),
}));

vi.mock("@/lib/org-guard", () => ({ requireOrgContext: mocks.requireOrgContext }));
vi.mock("@/lib/db", () => ({
  queryOne: mocks.queryOne,
  transaction: mocks.transaction,
}));
vi.mock("@/lib/ai/companyProfile", () => ({ getProfileJson: mocks.profile }));
vi.mock("@/lib/logger", () => ({ logAgent: mocks.logAgent }));
vi.mock("@/lib/pricing-rows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pricing-rows")>();
  return {
    ...actual,
    pricingRowsWithQuotes: mocks.pricingRows,
    pricingRowsWithQuotesInTransaction: mocks.transactionPricingRows,
  };
});

const requirement = {
  id: "price",
  title: "Pricing schedule",
  mandatory: true,
  official_form: "",
  category: "pricing",
  format: "PDF",
  signature_required: false,
  satisfied_by: "auto_generated",
  instructions: "Include the completed schedule",
};

const analysis = {
  required_trades: ["electrical"],
  compliance_matrix: [requirement],
  qa_addenda: [],
};

function opportunity() {
  return {
    id: OPP,
    stage: "bid_building",
    status: "open",
    pursuit_state: "active",
    past_perf_classification: "not_required",
    deadline: "2099-01-01T12:00:00.000Z",
    solicitation_analysis: analysis,
    updated_at_token: "2026-09-07T09:00:00.000Z",
  };
}

function bid(requirementsFingerprintValue: string | null) {
  return {
    id: BID,
    human_flags: [],
    qa_checklist: [],
    package_ready: true,
    validation_json: { blockers: [] },
    requirements_fingerprint: requirementsFingerprintValue,
    audit_findings: [],
    bid_amount: "130000",
    submission_state: "package_ready",
    updated_at_token: "2026-09-07T09:00:00.000Z",
    compliance_matrix: [],
    package_manifest: [{ order: 1, filename: "bid.pdf", status: "satisfied" }],
    documents_json: [{ kind: "bid_pdf", storage_path: `orgs/${ORG}/bid.pdf` }],
  };
}

function pricing(baseQuote = 100_000): PricingRow[] {
  return [{
    id: "2d92b8a3-f851-4497-8054-a6946c928dd6",
    scopeKey: "electrical",
    trade: "electrical",
    selectedSubId: "d72498ef-4a1d-4b8d-9443-c395b828754f",
    selectedSubName: "Sparks",
    backupSubId: null,
    backupSubName: null,
    baseQuote,
    taxes: null,
    freight: null,
    mobilization: null,
    bonding: null,
    manualAdjustment: null,
    manualAdjustmentReason: null,
    pendingComponents: [],
    alternates: [],
    exclusions: [],
    paymentTerms: null,
    quoteExpiresOn: "2099-01-01",
    availability: null,
    leadTimeDays: null,
    confidence: "firm",
    supportingDocumentId: null,
    candidates: [],
  }];
}

function request() {
  return new Request(`https://app.test/api/opportunities/${OPP}/submit`, {
    method: "POST",
    body: "{}",
  });
}

function installTransaction(locked: ReturnType<typeof bid> & ReturnType<typeof opportunity>) {
  mocks.clientQuery.mockImplementation(async (sqlValue: string) => {
    const sql = sqlValue.replace(/\s+/g, " ").trim();
    if (sql.startsWith("set ") || sql.startsWith("lock table")) return { rows: [] };
    if (sql.startsWith("select b.id")) return { rows: [locked] };
    if (sql.startsWith("update bids b")) return { rows: [{ id: BID }] };
    if (sql.startsWith("insert into")) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  mocks.transaction.mockImplementation(
    async (work: (client: { query: typeof mocks.clientQuery }) => Promise<unknown>) =>
      work({ query: mocks.clientQuery })
  );
}

describe("submission approval fact and audit boundary", () => {
  const fingerprint = requirementsFingerprint([requirement], []);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOrgContext.mockResolvedValue({
      orgId: ORG,
      user: { id: "operator", email: "operator@example.test" },
    });
    mocks.profile.mockResolvedValue({ decision_thresholds: { submit_lead_hours: 2 } });
  });

  it("refuses a legacy package with no requirements fingerprint when requirements exist", async () => {
    mocks.queryOne
      .mockResolvedValueOnce(opportunity())
      .mockResolvedValueOnce(bid(null));
    const { POST } = await import("@/app/api/opportunities/[id]/submit/route");

    const response = await POST(request(), { params: { id: OPP } });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      needsForce: false,
      blockers: ["The package is not tied to the current solicitation requirements"],
    });
    expect(mocks.pricingRows).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("refuses pricing that changed after preflight even when both versions are complete", async () => {
    const outerBid = bid(fingerprint);
    const opp = opportunity();
    mocks.queryOne.mockResolvedValueOnce(opp).mockResolvedValueOnce(outerBid);
    mocks.pricingRows.mockResolvedValue(pricing(100_000));
    mocks.transactionPricingRows.mockResolvedValue(pricing(101_000));
    installTransaction({ ...outerBid, ...opp, opportunity_updated_at_token: opp.updated_at_token });
    const { POST } = await import("@/app/api/opportunities/[id]/submit/route");

    const response = await POST(request(), { params: { id: OPP } });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/package changed/i);
    expect(
      mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes("set submission_state='approved'"))
    ).toBe(false);
  });

  it("refuses requirements that changed after preflight while holding the opportunity lock", async () => {
    const outerBid = bid(fingerprint);
    const opp = opportunity();
    const changedAnalysis = {
      ...analysis,
      compliance_matrix: [
        ...analysis.compliance_matrix,
        { ...requirement, id: "signed-offer", title: "Signed offer", signature_required: true },
      ],
    };
    mocks.queryOne.mockResolvedValueOnce(opp).mockResolvedValueOnce(outerBid);
    mocks.pricingRows.mockResolvedValue(pricing());
    mocks.transactionPricingRows.mockResolvedValue(pricing());
    installTransaction({
      ...outerBid,
      ...opp,
      solicitation_analysis: changedAnalysis,
      opportunity_updated_at_token: opp.updated_at_token,
    });
    const { POST } = await import("@/app/api/opportunities/[id]/submit/route");

    const response = await POST(request(), { params: { id: OPP } });

    expect(response.status).toBe(409);
    expect((await response.json()).blockers).toContain(
      "The package is not tied to the current solicitation requirements"
    );
  });

  it("refuses package artifacts that changed without relying only on updated_at", async () => {
    const outerBid = bid(fingerprint);
    const opp = opportunity();
    mocks.queryOne.mockResolvedValueOnce(opp).mockResolvedValueOnce(outerBid);
    mocks.pricingRows.mockResolvedValue(pricing());
    mocks.transactionPricingRows.mockResolvedValue(pricing());
    installTransaction({
      ...outerBid,
      ...opp,
      package_manifest: [
        { order: 1, filename: "bid.pdf", status: "satisfied" },
        { order: 2, filename: "late.pdf", status: "satisfied" },
      ],
      opportunity_updated_at_token: opp.updated_at_token,
    });
    const { POST } = await import("@/app/api/opportunities/[id]/submit/route");

    const response = await POST(request(), { params: { id: OPP } });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/package changed/i);
  });

  it("keeps the pricing snapshot, state event, and activity log in the approval transaction", async () => {
    const outerBid = bid(fingerprint);
    const opp = opportunity();
    mocks.queryOne.mockResolvedValueOnce(opp).mockResolvedValueOnce(outerBid);
    mocks.pricingRows.mockResolvedValue(pricing());
    mocks.transactionPricingRows.mockResolvedValue(pricing());
    installTransaction({ ...outerBid, ...opp, opportunity_updated_at_token: opp.updated_at_token });
    const { POST } = await import("@/app/api/opportunities/[id]/submit/route");

    const response = await POST(request(), { params: { id: OPP } });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, state: "approved" });
    const statements = mocks.clientQuery.mock.calls.map(([sql]) =>
      String(sql).replace(/\s+/g, " ").trim()
    );
    expect(statements.some((sql) => sql.startsWith("insert into bid_calculation_snapshots"))).toBe(true);
    expect(statements.some((sql) => sql.startsWith("insert into bid_submission_events"))).toBe(true);
    expect(statements.some((sql) => sql.startsWith("insert into agent_logs"))).toBe(true);
    expect(statements.find((sql) => sql.startsWith("update bids b"))).not.toContain("submitted_at");
    expect(mocks.logAgent).not.toHaveBeenCalled();
  });

  it.each([
    ["immutable snapshot", "insert into bid_calculation_snapshots"],
    ["activity log", "insert into agent_logs"],
  ])("returns failure rather than approving without its %s", async (_label, failingSql) => {
    const outerBid = bid(fingerprint);
    const opp = opportunity();
    mocks.queryOne.mockResolvedValueOnce(opp).mockResolvedValueOnce(outerBid);
    mocks.pricingRows.mockResolvedValue(pricing());
    mocks.transactionPricingRows.mockResolvedValue(pricing());
    installTransaction({ ...outerBid, ...opp, opportunity_updated_at_token: opp.updated_at_token });
    mocks.clientQuery.mockImplementation(async (sqlValue: string) => {
      const sql = sqlValue.replace(/\s+/g, " ").trim();
      if (sql.startsWith("set ") || sql.startsWith("lock table")) return { rows: [] };
      if (sql.startsWith("select b.id")) {
        return { rows: [{ ...outerBid, ...opp, opportunity_updated_at_token: opp.updated_at_token }] };
      }
      if (sql.startsWith("update bids b")) return { rows: [{ id: BID }] };
      if (sql.startsWith(failingSql)) throw new Error("approval evidence store unavailable");
      if (sql.startsWith("insert into")) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const { POST } = await import("@/app/api/opportunities/[id]/submit/route");

    const response = await POST(request(), { params: { id: OPP } });

    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/nothing was approved/i);
    expect(mocks.logAgent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "approve-bid-failed", status: "error" })
    );
  });
});
