import { describe, it, expect, vi, beforeEach } from "vitest";

const queryOne = vi.fn();
const logAgent = vi.fn(async () => undefined);
const txnQuery = vi.fn();
const suppress = vi.fn(async () => ({ id: "suppression-1" }));

vi.mock("../lib/db", () => ({
  queryOne: (...args: unknown[]) => queryOne(...args),
  transaction: async (fn: (c: { query: typeof txnQuery }) => Promise<unknown>) =>
    fn({ query: txnQuery }),
}));
vi.mock("../lib/logger", () => ({
  logAgent: (...args: unknown[]) => logAgent(...args),
}));
vi.mock("../lib/suppressions", () => ({
  suppress: (...args: unknown[]) => suppress(...args),
}));

import { shouldPreserveCallCardStatus, skipCallCard } from "../lib/skip-call";

const ORG_ID = "00000000-0000-4000-8000-000000000111";

describe("shouldPreserveCallCardStatus", () => {
  it("preserves completed and skipped cards", () => {
    expect(shouldPreserveCallCardStatus("called")).toBe(true);
    expect(shouldPreserveCallCardStatus("skipped")).toBe(true);
    expect(shouldPreserveCallCardStatus("pending")).toBe(false);
  });
});

describe("skipCallCard", () => {
  beforeEach(() => {
    queryOne.mockReset();
    logAgent.mockReset();
    txnQuery.mockReset();
    suppress.mockClear();
  });

  it("marks the card skipped, writes a note, and audits the choice", async () => {
    txnQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("from call_cards cc")) {
        return {
          rows: [
            {
              opportunity_id: "opp-1",
              subcontractor_id: "sub-1",
              status: "pending",
              response_json: null,
              company_name: "Acme HVAC",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const result = await skipCallCard("card-1", { orgId: ORG_ID });

    expect(result).toEqual({
      opportunityId: "opp-1",
      subcontractorId: "sub-1",
      companyName: "Acme HVAC",
    });

    const updateSql = txnQuery.mock.calls.find((c) =>
      String(c[0]).includes("status = 'skipped'")
    );
    expect(updateSql).toBeTruthy();
    expect(JSON.parse(updateSql![1][1])).toMatchObject({
      outcome: "skipped",
      notes: "Operator chose not to call.",
    });

    const noteSql = txnQuery.mock.calls.find((c) =>
      String(c[0]).includes("Skipped call")
    );
    expect(noteSql).toBeTruthy();
    expect(noteSql![1]).toEqual([
      "sub-1",
      "opp-1",
      "Operator chose not to call.",
      ORG_ID,
    ]);

    expect(logAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "operator",
        action: "call-skipped",
        opportunityId: "opp-1",
        subcontractorId: "sub-1",
      })
    );
  });

  it("refuses to skip an already completed call", async () => {
    txnQuery.mockResolvedValueOnce({
      rows: [
        {
          opportunity_id: "opp-1",
          subcontractor_id: "sub-1",
          status: "called",
          response_json: { outcome: "success" },
          company_name: "Acme HVAC",
        },
      ],
    });

    await expect(skipCallCard("card-1", { orgId: ORG_ID })).rejects.toThrow(
      /already completed/
    );
    expect(logAgent).not.toHaveBeenCalled();
  });

  it("writes a standing suppression on the same transaction client", async () => {
    txnQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("from call_cards cc")) {
        return {
          rows: [
            {
              opportunity_id: "opp-1",
              subcontractor_id: "sub-1",
              status: "pending",
              response_json: null,
              company_name: "Acme HVAC",
              trade: "HVAC",
            },
          ],
        };
      }
      return { rows: [] };
    });

    await skipCallCard("card-1", {
      orgId: ORG_ID,
      scope: "subcontractor",
      skipReason: "prefer_email",
      actor: "operator@example.com",
    });

    expect(suppress).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG_ID,
        subcontractorId: "sub-1",
        opportunityId: null,
        channel: "call",
        actor: "operator@example.com",
      }),
      expect.objectContaining({ query: txnQuery })
    );
  });

  it("restores a skipped card to the queue on undo", async () => {
    txnQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("from call_cards cc")) {
        return {
          rows: [
            {
              opportunity_id: "opp-1",
              subcontractor_id: "sub-1",
              status: "skipped",
              company_name: "Acme HVAC",
            },
          ],
        };
      }
      return { rows: [] };
    });

    await skipCallCard("card-1", { undo: true, orgId: ORG_ID });

    expect(
      txnQuery.mock.calls.some((c) => String(c[0]).includes("status = 'pending'"))
    ).toBe(true);
    expect(logAgent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "call-skip-undone" })
    );
  });
});
