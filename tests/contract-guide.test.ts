import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContractRecord } from "@/lib/contract-record";
import { buildContractGuide, contractIdFromPath } from "@/lib/domain/contract-guide";

const mocks = vi.hoisted(() => ({ scope: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ tryResolveTenantOrgId: mocks.scope }));
vi.mock("@/lib/contract-record", () => ({ contractRecord: mocks.record }));

const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const record = {
  header: { id, contract_number: "QA-1", agency: "Fixture agency", status: "active", start_date: "2026-01-01", end_date: "2099-12-31", non_ss_sub_pct: 0, cpars_due_at: null, cpars_status: null },
  money: { currentValueCents: 125025, invoicedCents: null, paidCents: 0, outstandingCents: null },
  milestones: [{ name: "Inspect panels", due_at: "2099-01-01", completed_at: null }, { name: "Send kickoff notes", completed_at: "2026-01-02" }],
  issues: [{ title: "Access arrangements", severity: "normal", resolved_at: null }],
  coordination: [],
  modifications: [
    { mod_number: "OLD", summary: "Superseded amount", superseded_by: "new" },
    { mod_number: "NEW", summary: "Approved fixture change", source_document: "Signed change.pdf", source_note: "Page 2", superseded_by: null },
  ],
} as unknown as ContractRecord;

describe("contract guidance facts", () => {
  it("accepts only an exact contract record path", () => {
    expect(contractIdFromPath(`/contracts/${id}`)).toBe(id);
    for (const path of ["/contracts", `/contracts/${id}/other`, `/contracts/${id}?org=other`, "/contracts/not-an-id"]) expect(contractIdFromPath(path)).toBeNull();
  });

  it("keeps missing amounts distinct from zero and excludes superseded changes", () => {
    const guide = buildContractGuide(record);
    expect(guide.situation).toContain("$1,250.25");
    expect(guide.situation).toContain("Invoiced: Not recorded");
    expect(guide.situation).toContain("Paid: $0.00");
    expect(guide.situation).toContain("Signed change.pdf");
    expect(guide.situation).toContain("Source note: Page 2");
    expect(guide.situation).not.toContain("Superseded amount");
    expect(guide.needsAttention.join(" ")).toContain("Inspect panels");
    expect(guide.completed.join(" ")).toContain("Send kickoff notes");
    expect(guide.dataWarnings?.join(" ")).toContain("Source file contents");
    expect(guide.steps.every(step => step.kind === "link" && step.href?.startsWith(`/contracts/${id}#`))).toBe(true);
  });
});

describe("contract guidance account isolation", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.scope.mockResolvedValue("tenant-a"); mocks.record.mockResolvedValue(record); });
  const user = { id: "reader", email: "reader@example.test", organizationId: "tenant-a", orgRole: "viewer" };

  it("reads only the resolved account and returns read-only record links", async () => {
    const { loadGuideBundle } = await import("@/lib/guide/load");
    const result = await loadGuideBundle(user, `/contracts/${id}`);
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith("tenant-a", id);
    expect(result.adapters).toEqual({});
    expect(result.sources.every(source => source.href.startsWith(`/contracts/${id}#`))).toBe(true);
  });

  it("refuses missing scope or an unavailable record instead of answering from other facts", async () => {
    const { loadGuideBundle } = await import("@/lib/guide/load");
    mocks.scope.mockResolvedValueOnce(null);
    await expect(loadGuideBundle(user, `/contracts/${id}`)).rejects.toThrow("scope");
    expect(mocks.record).not.toHaveBeenCalled();
    mocks.record.mockResolvedValueOnce(null);
    await expect(loadGuideBundle(user, `/contracts/${id}`)).rejects.toThrow("unavailable");
    await expect(loadGuideBundle(user, `/contracts/${id}/other`)).rejects.toThrow("Invalid contract");
  });
});
