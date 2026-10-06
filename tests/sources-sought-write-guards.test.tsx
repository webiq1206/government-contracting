import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const m = vi.hoisted(() => ({
  research: true,
  query: vi.fn(async () => []),
  queryOne: vi.fn(),
  savePricing: vi.fn(async () => ({ trade: "Electrical" })),
  deletePricing: vi.fn(async () => true),
  updateRequirement: vi.fn(async () => ({ ok: true, record: { state: "in_progress" } })),
  packageChange: vi.fn(async () => ({ ok: true, validation: {}, ready: true })),
  workspace: vi.fn(),
}));
vi.mock("@/lib/org-guard", () => ({ requireOrgContext: async () => ({
  orgId: "synthetic-org", user: { id: "synthetic-user", email: "operator@example.test", orgRole: "owner" },
}) }));
vi.mock("@/lib/db", () => ({ query: m.query, queryOne: m.queryOne }));
vi.mock("@/lib/logger", () => ({ logAgent: async () => undefined }));
vi.mock("@/lib/queue", () => ({ enqueue: async () => "synthetic-job" }));
vi.mock("@/lib/pricing-rows", () => ({
  savePricingRow: m.savePricing, deletePricingRow: m.deletePricing, pricingRowsWithQuotes: async () => [],
  PricingRowRejected: class extends Error {},
}));
vi.mock("@/lib/requirement-states", () => ({
  updateRequirement: m.updateRequirement, requirementHistory: async () => [],
  requirementViews: async () => ({ states: {}, history: {} }),
}));
vi.mock("@/lib/bid-package-state", () => ({ setRequirementConfirmed: m.packageChange, applyPackageChange: m.packageChange }));
vi.mock("@/lib/data", () => ({ opportunityDetail: async () => ({
  opp: { id: "synthetic-opp", title: "Saved research notice", is_sources_sought: m.research, solicitation_analysis: {} },
  documents: [],
}) }));
vi.mock("@/lib/ownership", () => ({ assignableMembers: async () => [] }));
vi.mock("@/lib/domain/opportunity-brief", () => ({
  briefInputFrom: (value: unknown) => value,
  buildOpportunityBrief: () => ({ requirements: [{ id: "req-1", label: "Saved requirement" }], disqualifiers: [] }),
}));
vi.mock("@/components/page-frame", () => ({ PageFrame: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("@/components/requirements-workspace", () => ({ RequirementsWorkspace: (props: { canEdit: boolean }) => {
  m.workspace(props); return <div>{props.canEdit ? "Editable checklist" : "Read-only checklist"}</div>;
} }));

import { PUT, DELETE } from "@/app/api/opportunities/[id]/pricing/route";
import { POST as updateRequirement } from "@/app/api/opportunities/[id]/requirement-state/route";
import { POST as confirmRequirement } from "@/app/api/opportunities/[id]/requirements/route";
import RequirementsPage from "@/app/(dash)/opportunity/[id]/requirements/page";
const params = { params: Promise.resolve({ id: "synthetic-opp" }) };
const request = (body: unknown) => new Request("http://local.test", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  m.research = true;
  m.queryOne.mockImplementation(async (sql: string) => ({
    id: "synthetic-opp", stage: "quote_entry", status: "open", pursuit_state: "active", submission_state: null,
    ...(sql.includes("is_sources_sought") ? { is_sources_sought: m.research } : {}),
  }));
});

describe("Sources Sought saved bid records stay read-only", () => {
  it.each([["save", PUT], ["delete", DELETE]] as const)("refuses a direct pricing %s before changing history", async (_name, handler) => {
    const response = await handler(request({ trade: "Electrical", baseQuote: 1000 }), params);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/Sources Sought|market research/i);
    expect(m.savePricing).not.toHaveBeenCalled();
    expect(m.deletePricing).not.toHaveBeenCalled();
    expect(m.query).not.toHaveBeenCalled();
  });
  it("refuses checklist edits submitted directly to the API", async () => {
    const response = await updateRequirement(request({ requirement_id: "req-1", state: "in_progress" }), params);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/Sources Sought|market research/i);
    expect(m.updateRequirement).not.toHaveBeenCalled();
  });
  it("keeps the requirements deep link read-only for an owner", async () => {
    const html = renderToStaticMarkup(await RequirementsPage(params));
    expect(html).toContain("Read-only checklist");
    expect(html).not.toContain("What it takes to bid");
    expect(m.workspace).toHaveBeenCalledWith(expect.objectContaining({ canEdit: false }));
  });
  it("refuses direct bid-package requirement confirmation", async () => {
    const response = await confirmRequirement(request({ requirement_id: "req-1", confirmed: true }), params);
    expect(response.status).toBe(409);
    expect(m.packageChange).not.toHaveBeenCalled();
  });
  it("continues to save pricing for an ordinary bid", async () => {
    m.research = false;
    const response = await PUT(request({ trade: "Electrical", baseQuote: 1000 }), params);
    expect(response.status).toBe(200);
    expect(m.savePricing).toHaveBeenCalledTimes(1);
  });
  it("leaves an ordinary bid checklist editable", async () => {
    m.research = false;
    const html = renderToStaticMarkup(await RequirementsPage(params));
    expect(html).toContain("Editable checklist");
  });
});
