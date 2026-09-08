import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "7dbd9b8b-c9fc-4b1f-85e3-59866816b75c";
const SUB_A = "96dbe890-29f0-4cf7-8c36-a90f4194dc81";
const SUB_B = "ae31b41e-c315-49a7-806c-edf8e2c772bd";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  txQuery: vi.fn(),
  transaction: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  query: mocks.query,
  transaction: mocks.transaction,
}));

vi.mock("@/lib/queue", () => ({
  enqueue: mocks.enqueue,
}));

function sqlOf(call: unknown[]): string {
  return String(call[0]).replace(/\s+/g, " ").trim();
}

describe("bulk roster transaction integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(
      async (work: (client: { query: typeof mocks.txQuery }) => Promise<unknown>) =>
        work({ query: mocks.txQuery })
    );
  });

  it.each([
    { action: "tag", run: () => import("@/lib/sub-bulk").then((m) => m.bulkTag({ orgId: ORG, actorId: null, ids: [SUB_A], tag: "Ready" })) },
    { action: "untag", run: () => import("@/lib/sub-bulk").then((m) => m.bulkTag({ orgId: ORG, actorId: null, ids: [SUB_A], tag: "Ready", remove: true })) },
    { action: "archive", run: () => import("@/lib/sub-bulk").then((m) => m.bulkArchive({ orgId: ORG, actorId: null, ids: [SUB_A], reason: "Not a current fit" })) },
  ])("does not report $action success when its audit insert fails", async ({ run }) => {
    mocks.txQuery
      .mockResolvedValueOnce({ rows: [{ id: SUB_A }], rowCount: 1 })
      .mockRejectedValueOnce(new Error("ledger unavailable"));

    await expect(run()).rejects.toThrow("ledger unavailable");

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.txQuery).toHaveBeenCalledTimes(2);
    expect(sqlOf(mocks.txQuery.mock.calls[1])).toContain("insert into subcontractor_bulk_actions");
    // The mutation and ledger both use the transaction client. A standalone
    // mutation would commit before a failed ledger insert could roll it back.
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("returns the durable batch id after mutation and ledger succeed together", async () => {
    mocks.txQuery
      .mockResolvedValueOnce({ rows: [{ subcontractor_id: SUB_A }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: "batch-123" }], rowCount: 1 });
    const { bulkTag } = await import("@/lib/sub-bulk");

    const result = await bulkTag({ orgId: ORG, actorId: null, ids: [SUB_A], tag: "Ready" });

    expect(result).toMatchObject({ ok: true, changed: 1, batchId: "batch-123" });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("records deliberate pauses and queue failures as different outcomes", async () => {
    mocks.query.mockResolvedValue([
      { id: SUB_A, checkable: true, blocked: false, merged: false },
      { id: SUB_B, checkable: true, blocked: false, merged: false },
    ]);
    mocks.enqueue
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("queue connection lost"));
    mocks.txQuery.mockResolvedValueOnce({ rows: [{ id: "verify-batch" }], rowCount: 1 });
    const { bulkVerify } = await import("@/lib/sub-bulk");

    const result = await bulkVerify({ orgId: ORG, actorId: null, ids: [SUB_A, SUB_B] });

    expect(result).toMatchObject({ ok: true, changed: 0, batchId: "verify-batch" });
    if (!result.ok) return;
    expect(result.skipped).toEqual([
      { id: SUB_A, reason: "automation_paused" },
      { id: SUB_B, reason: "queue_failed" },
    ]);
  });

  it("does not report queued verification work when its ledger cannot be saved", async () => {
    mocks.query.mockResolvedValue([
      { id: SUB_A, checkable: true, blocked: false, merged: false },
    ]);
    mocks.enqueue.mockResolvedValue("job-123");
    mocks.txQuery.mockRejectedValueOnce(new Error("ledger unavailable"));
    const { bulkVerify } = await import("@/lib/sub-bulk");

    await expect(
      bulkVerify({ orgId: ORG, actorId: null, ids: [SUB_A] })
    ).rejects.toThrow("ledger unavailable");
  });
});
