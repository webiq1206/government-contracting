import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "7dbd9b8b-c9fc-4b1f-85e3-59866816b75c";
const OTHER_ORG = "fa8a9198-b687-48c4-ab78-f5f8413b41a1";

const mocks = vi.hoisted(() => ({
  txQuery: vi.fn(),
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  removeExternal: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({
  query: mocks.query,
  queryOne: mocks.queryOne,
  transaction: vi.fn(async (work: (client: { query: typeof mocks.txQuery }) => unknown) =>
    work({ query: mocks.txQuery })
  ),
}));
vi.mock("@/lib/integrations/storage", () => ({
  storage: {
    removeExternal: mocks.removeExternal,
  },
}));

function sqlOf(call: unknown[]): string {
  return String(call[0]).replace(/\s+/g, " ").trim();
}

function installRows(input: {
  objects: { path: string; backend: string | null }[];
  otherOwners?: string[];
}) {
  mocks.txQuery.mockImplementation(async (sqlValue: string) => {
    const sql = sqlValue.replace(/\s+/g, " ").trim();
    if (sql.startsWith("select id from organizations")) return { rows: [{ id: ORG }] };
    if (sql.startsWith("select u.id, u.email")) {
      return {
        rows: [{ id: "25ff93c7-f598-4e33-a7e8-f33def46c325", email: "owner@example.test" }],
      };
    }
    if (sql.startsWith("select distinct path, backend")) return { rows: input.objects };
    if (sql.startsWith("select distinct owner.org_id")) {
      return { rows: (input.otherOwners ?? []).map((org_id) => ({ org_id })) };
    }
    if (sql.includes("from information_schema.columns")) return { rows: [] };
    return { rows: [], rowCount: 0 };
  });
}

describe("physical storage cleanup during account purge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue([]);
    mocks.queryOne.mockResolvedValue(null);
    delete process.env.PLATFORM_ADMIN_EMAILS;
    delete process.env.OPERATOR_EMAIL;
  });

  it("removes external bytes and then deletes orphaned login identities", async () => {
    installRows({ objects: [{ path: `orgs/${ORG}/private/w9.pdf`, backend: "supabase" }] });
    const { purgeOrganization } = await import("@/lib/admin/accounts");

    await purgeOrganization(ORG);

    expect(mocks.removeExternal).toHaveBeenCalledWith(
      `orgs/${ORG}/private/w9.pdf`,
      "supabase"
    );
    const statements = mocks.txQuery.mock.calls.map(sqlOf);
    expect(statements.some((sql) => sql.startsWith("delete from file_blobs"))).toBe(true);
    expect(statements.some((sql) => sql.startsWith("delete from organizations"))).toBe(true);
    expect(statements.some((sql) => sql.startsWith("delete from users"))).toBe(true);
  });

  it("keeps a shared legacy object and transfers its DB ownership", async () => {
    installRows({
      objects: [{ path: "legacy/shared.pdf", backend: "db" }],
      otherOwners: [OTHER_ORG],
    });
    const { purgeOrganization } = await import("@/lib/admin/accounts");

    await purgeOrganization(ORG);

    expect(mocks.removeExternal).not.toHaveBeenCalled();
    const transfer = mocks.txQuery.mock.calls.find((call) =>
      sqlOf(call).startsWith("update file_blobs set org_id")
    );
    expect(transfer?.[1]).toEqual([ORG, "legacy/shared.pdf", OTHER_ORG]);
  });

  it("writes a required deletion audit on the purge transaction client", async () => {
    installRows({ objects: [] });
    const { purgeOrganization } = await import("@/lib/admin/accounts");

    await purgeOrganization(ORG, {
      adminEmail: "admin@example.test",
      orgName: "Example",
      detail: { via: "immediate deletion" },
    });

    const statements = mocks.txQuery.mock.calls.map(sqlOf);
    const orgDelete = statements.findIndex((sql) => sql.startsWith("delete from organizations"));
    const auditInsert = statements.findIndex((sql) => sql.startsWith("insert into admin_audit_log"));
    expect(orgDelete).toBeGreaterThanOrEqual(0);
    expect(auditInsert).toBeGreaterThan(orgDelete);
  });

  it("surfaces external deletion failures and leaves account metadata undeleted", async () => {
    installRows({ objects: [{ path: `orgs/${ORG}/private/w9.pdf`, backend: "supabase" }] });
    mocks.removeExternal.mockRejectedValueOnce(new Error("provider unavailable"));
    const { purgeOrganization } = await import("@/lib/admin/accounts");

    await expect(purgeOrganization(ORG)).rejects.toThrow(
      /Could not remove stored file.*provider unavailable/
    );
    const statements = mocks.txQuery.mock.calls.map(sqlOf);
    expect(statements.some((sql) => sql.startsWith("delete from organizations"))).toBe(false);
  });

  it("does not report a verification outage as a missing account", async () => {
    const { deleteAccount } = await import("@/lib/admin/accounts");
    mocks.queryOne.mockRejectedValueOnce(new Error("database unavailable"));

    const result = await deleteAccount({
      orgId: ORG,
      confirmName: "Example",
      adminEmail: "admin@example.test",
    });

    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/could not be verified.*nothing was deleted.*try again/i),
    });
  });

  it("lets the scheduled purge fail loudly when its due-account query fails", async () => {
    const { accountsDueForPurge } = await import("@/lib/admin/accounts");
    mocks.query.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(accountsDueForPurge()).rejects.toThrow(/database unavailable/);
  });
});
