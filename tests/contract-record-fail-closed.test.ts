import { beforeEach, describe, expect, it, vi } from "vitest";

const CONTRACT_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const FOREIGN_ID = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  txQuery: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  query: mocks.query,
  queryOne: mocks.queryOne,
  transaction: vi.fn(
    async (
      work: (client: { query: typeof mocks.txQuery }) => Promise<unknown>,
    ) => work({ query: mocks.txQuery }),
  ),
}));

import {
  ContractRefusal,
  createContract,
  logCoordination,
  saveModification,
  seedContractStartup,
} from "@/lib/contract-record";

const found = (rows: unknown[] = [{ id: CONTRACT_ID }]) => ({
  rows,
  rowCount: rows.length,
});

describe("contract relationship writes fail closed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unowned superseded modification before inserting the replacement", async () => {
    mocks.txQuery
      .mockResolvedValueOnce(found())
      .mockResolvedValueOnce(found([]));

    const result = await saveModification({
      orgId: ORG_ID,
      contractId: CONTRACT_ID,
      modNumber: "P00002",
      kind: "value",
      summary: "Correct the earlier value",
      valueDeltaCents: 10_000,
      sourceNote: "Contracting officer email",
      supersedes: FOREIGN_ID,
      actorId: null,
    });

    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(mocks.txQuery.mock.calls.map(([sql]) => String(sql))).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/insert into contract_modifications/i),
      ]),
    );
  });

  it("rejects an unowned subcontractor before inserting coordination", async () => {
    mocks.txQuery
      .mockResolvedValueOnce(found())
      .mockResolvedValueOnce(found([]));

    const result = await logCoordination({
      orgId: ORG_ID,
      contractId: CONTRACT_ID,
      channel: "call",
      withWhom: "Foreign subcontractor",
      summary: "This must not be detached from its intended firm.",
      subcontractorId: FOREIGN_ID,
      actorId: null,
    });

    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(mocks.txQuery.mock.calls.map(([sql]) => String(sql))).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/insert into contract_coordination/i),
      ]),
    );
  });

  it("rejects an unowned opportunity before inserting a manual contract", async () => {
    mocks.txQuery.mockResolvedValueOnce(found([]));

    const result = await createContract({
      orgId: ORG_ID,
      actorId: null,
      contractNumber: "MANUAL-001",
      opportunityId: FOREIGN_ID,
    });

    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(mocks.txQuery.mock.calls.map(([sql]) => String(sql))).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/insert into contracts/i)]),
    );
  });
});

describe("contract startup failures stay visible", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when the scoped contract does not exist", async () => {
    mocks.txQuery.mockResolvedValueOnce(found([]));

    await expect(
      seedContractStartup({ orgId: ORG_ID, contractId: CONTRACT_ID }),
    ).rejects.toBeInstanceOf(ContractRefusal);
  });

  it("propagates an obligation insert failure instead of returning partial counts", async () => {
    mocks.txQuery
      .mockResolvedValueOnce(
        found([
          {
            start_date: "2026-09-01",
            end_date: "2027-08-31",
            bond_required_cents: null,
            primary_sub_id: null,
            contract_number: "W912-TEST",
          },
        ]),
      )
      .mockRejectedValueOnce(new Error("milestone table unavailable"));

    await expect(
      seedContractStartup({ orgId: ORG_ID, contractId: CONTRACT_ID }),
    ).rejects.toThrow("milestone table unavailable");
  });
});
