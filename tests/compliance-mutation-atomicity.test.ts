import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "7dbd9b8b-c9fc-4b1f-85e3-59866816b75c";
const ITEM = "96dbe890-29f0-4cf7-8c36-a90f4194dc81";
const DOC = "ae31b41e-c315-49a7-806c-edf8e2c772bd";
const USER = "d72498ef-4a1d-4b8d-9443-c395b828754f";

const mocks = vi.hoisted(() => ({
  tenantTransaction: vi.fn(),
  txQuery: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  upload: vi.fn(),
  removeExternal: vi.fn(),
  requireOrgContext: vi.fn(),
  logAgent: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({
  query: mocks.query,
  queryOne: mocks.queryOne,
  tenantTransaction: mocks.tenantTransaction,
}));
vi.mock("@/lib/integrations/storage", () => ({
  storage: {
    upload: mocks.upload,
    removeExternal: mocks.removeExternal,
    download: vi.fn(),
  },
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithOrg: (_orgId: string, work: () => unknown) => work(),
}));
vi.mock("@/lib/org-guard", () => ({
  requireOrgContext: mocks.requireOrgContext,
}));
vi.mock("@/lib/logger", () => ({ logAgent: mocks.logAgent }));

function sqlOf(value: unknown): string {
  return String(value).replace(/\s+/g, " ").trim();
}

function pdf(name = "policy.pdf"): File {
  return new File([new Uint8Array(32)], name, { type: "application/pdf" });
}

function itemRow(extra: Record<string, unknown> = {}) {
  return {
    id: ITEM,
    label: "General liability",
    source: "operator",
    notes: null,
    due_at: "2027-03-15T00:00:00.000Z",
    due_at_override: null,
    recurrence: "annual",
    recurrence_months: null,
    ...extra,
  };
}

function arrangeSuccessfulRemoval(sharedFor: (sql: string) => boolean): void {
  mocks.txQuery.mockImplementation(async (sqlValue: string) => {
    const sql = sqlOf(sqlValue);
    if (sql.startsWith("select item_id")) return { rows: [{ item_id: ITEM }] };
    if (sql.startsWith("select id") && sql.includes("from compliance_items")) {
      return { rows: [{ id: ITEM }] };
    }
    if (sql.startsWith("select id, item_id")) {
      return {
        rows: [{
          id: DOC,
          item_id: ITEM,
          storage_path: `orgs/${ORG}/policy.pdf`,
          storage_backend: "supabase",
          original_filename: "policy.pdf",
        }],
      };
    }
    if (sql.startsWith("select org_id")) return { rows: [] };
    if (sql.startsWith("select exists")) {
      return { rows: [{ shared: sharedFor(sql) }] };
    }
    if (sql.startsWith("update compliance_item_documents")) return { rows: [] };
    if (sql.startsWith("delete from compliance_item_documents")) {
      return { rows: [{ id: DOC }] };
    }
    if (sql.startsWith("delete from file_blobs")) return { rows: [] };
    if (sql.startsWith("insert into compliance_item_events")) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });
}

describe("compliance document mutation boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tenantTransaction.mockImplementation(
      async (_orgId: string, work: (client: { query: typeof mocks.txQuery }) => Promise<unknown>) =>
        work({ query: mocks.txQuery })
    );
    mocks.upload.mockResolvedValue({
      path: `orgs/${ORG}/compliance/${ITEM}/upload-policy.pdf`,
      backend: "db",
    });
    mocks.removeExternal.mockResolvedValue(undefined);
  });

  it("commits the document, compliance state, supersede link, and immutable event together", async () => {
    mocks.txQuery.mockImplementation(async (sqlValue: string) => {
      const sql = sqlOf(sqlValue);
      if (sql.startsWith("select id from compliance_items")) return { rows: [{ id: ITEM }] };
      if (sql.includes("from compliance_item_documents") && sql.startsWith("select id")) {
        return { rows: [{ id: "prior" }] };
      }
      if (sql.startsWith("select id from compliance_items") || sql.includes("for update")) {
        return { rows: [{ id: ITEM }] };
      }
      if (sql.startsWith("insert into compliance_item_documents")) return { rows: [{ id: DOC }] };
      if (sql.startsWith("update compliance_item_documents")) return { rows: [{ id: "prior" }] };
      if (sql.startsWith("update compliance_items")) return { rows: [{ id: ITEM }] };
      if (sql.startsWith("insert into compliance_item_events")) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const { attachDocument } = await import("@/lib/compliance-documents");

    const result = await attachDocument({
      orgId: ORG,
      itemId: ITEM,
      file: pdf(),
      actorId: USER,
      replaces: "prior",
    });

    expect(result).toEqual({ ok: true, id: DOC });
    expect(mocks.tenantTransaction).toHaveBeenCalledTimes(2);
    const sql = mocks.txQuery.mock.calls.map((call) => sqlOf(call[0]));
    expect(sql.some((text) => text.startsWith("insert into compliance_item_documents"))).toBe(true);
    expect(sql.some((text) => text.startsWith("update compliance_item_documents"))).toBe(true);
    expect(sql.some((text) => text.startsWith("update compliance_items"))).toBe(true);
    expect(sql.some((text) => text.startsWith("insert into compliance_item_events"))).toBe(true);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.removeExternal).not.toHaveBeenCalled();
  });

  it("reports an event failure and removes the uncommitted upload before allowing a retry", async () => {
    mocks.txQuery.mockImplementation(async (sqlValue: string) => {
      const sql = sqlOf(sqlValue);
      if (sql.startsWith("select id from compliance_items")) return { rows: [{ id: ITEM }] };
      if (sql.startsWith("select id") && sql.includes("for update")) return { rows: [{ id: ITEM }] };
      if (sql.startsWith("insert into compliance_item_documents")) return { rows: [{ id: DOC }] };
      if (sql.startsWith("update compliance_items")) return { rows: [{ id: ITEM }] };
      if (sql.startsWith("insert into compliance_item_events")) throw new Error("history unavailable");
      if (sql.startsWith("delete from file_blobs")) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const { attachDocument } = await import("@/lib/compliance-documents");

    const result = await attachDocument({
      orgId: ORG,
      itemId: ITEM,
      file: pdf(),
      actorId: USER,
    });

    expect(result).toMatchObject({ ok: false, retryable: true });
    if (result.ok) return;
    expect(result.error).toContain("record and its history could not be saved");
    expect(result.error).toContain("temporary copy was removed");
    expect(result.cleanupRequired).not.toBe(true);
    expect(mocks.removeExternal).toHaveBeenCalledWith(expect.any(String), "db");
    expect(mocks.tenantTransaction).toHaveBeenCalledTimes(3);
  });

  it("does not hide a failed compensating cleanup", async () => {
    mocks.txQuery.mockImplementation(async (sqlValue: string) => {
      const sql = sqlOf(sqlValue);
      if (sql.startsWith("select id from compliance_items") && sql.includes("for update")) {
        return { rows: [] };
      }
      if (sql.startsWith("select id from compliance_items")) return { rows: [{ id: ITEM }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    mocks.removeExternal.mockRejectedValueOnce(new Error("provider delete failed"));
    const { attachDocument } = await import("@/lib/compliance-documents");

    const result = await attachDocument({
      orgId: ORG,
      itemId: ITEM,
      file: pdf(),
      actorId: USER,
    });

    expect(result).toMatchObject({ ok: false, retryable: true, cleanupRequired: true });
    if (result.ok) return;
    expect(result.error).toContain("temporary stored copy also could not be removed");
    expect(result.error).toContain("Do not assume the file is attached");
  });

  it("keeps a removal retry target and returns 503 when its history insert fails", async () => {
    mocks.txQuery.mockImplementation(async (sqlValue: string) => {
      const sql = sqlOf(sqlValue);
      if (sql.startsWith("select item_id")) return { rows: [{ item_id: ITEM }] };
      if (sql.startsWith("select id") && sql.includes("from compliance_items")) {
        return { rows: [{ id: ITEM }] };
      }
      if (sql.startsWith("select id, item_id")) {
        return {
          rows: [{
            id: DOC,
            item_id: ITEM,
            storage_path: `orgs/${ORG}/policy.pdf`,
            storage_backend: "supabase",
            original_filename: "policy.pdf",
          }],
        };
      }
      if (sql.startsWith("select org_id")) return { rows: [] };
      if (sql.startsWith("select exists")) return { rows: [{ shared: false }] };
      if (sql.startsWith("update compliance_item_documents")) return { rows: [] };
      if (sql.startsWith("delete from compliance_item_documents")) return { rows: [{ id: DOC }] };
      if (sql.startsWith("delete from file_blobs")) return { rows: [] };
      if (sql.startsWith("insert into compliance_item_events")) throw new Error("history unavailable");
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const { removeDocument } = await import("@/lib/compliance-documents");

    const result = await removeDocument(ORG, DOC, USER);

    expect(result).toMatchObject({ ok: false, status: 503, retryable: true });
    if (result.ok) return;
    expect(result.error).toContain("Nothing is confirmed removed");
    expect(mocks.removeExternal).toHaveBeenCalledWith(`orgs/${ORG}/policy.pdf`, "supabase");
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("checks same-tenant references first and keeps their shared bytes", async () => {
    arrangeSuccessfulRemoval((sql) => sql.includes("org_id = $3"));
    const { removeDocument } = await import("@/lib/compliance-documents");

    const result = await removeDocument(ORG, DOC, USER);

    expect(result).toEqual({ ok: true });
    const referenceChecks = mocks.txQuery.mock.calls.filter((call) =>
      sqlOf(call[0]).startsWith("select exists")
    );
    expect(referenceChecks).toHaveLength(1);
    expect(sqlOf(referenceChecks[0][0]).match(/org_id = \$3/g)).toHaveLength(4);
    expect(referenceChecks[0][1]).toEqual([`orgs/${ORG}/policy.pdf`, DOC, ORG]);
    expect(mocks.removeExternal).not.toHaveBeenCalled();
    expect(
      mocks.txQuery.mock.calls.some((call) => sqlOf(call[0]).startsWith("delete from file_blobs"))
    ).toBe(false);
  });

  it("keeps shared legacy bytes when only another tenant references the path", async () => {
    arrangeSuccessfulRemoval((sql) => sql.includes("org_id is distinct from $3"));
    const { removeDocument } = await import("@/lib/compliance-documents");

    const result = await removeDocument(ORG, DOC, USER);

    expect(result).toEqual({ ok: true });
    const referenceChecks = mocks.txQuery.mock.calls.filter((call) =>
      sqlOf(call[0]).startsWith("select exists")
    );
    expect(referenceChecks).toHaveLength(2);
    expect(sqlOf(referenceChecks[0][0]).match(/org_id = \$3/g)).toHaveLength(4);
    expect(sqlOf(referenceChecks[1][0]).match(/org_id is distinct from \$3/g)).toHaveLength(4);
    expect(referenceChecks[1][1]).toEqual([`orgs/${ORG}/policy.pdf`, DOC, ORG]);
    expect(mocks.removeExternal).not.toHaveBeenCalled();
    expect(
      mocks.txQuery.mock.calls.some((call) => sqlOf(call[0]).startsWith("delete from file_blobs"))
    ).toBe(false);
  });
});

describe("compliance item route transaction boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upload.mockResolvedValue({
      path: `orgs/${ORG}/compliance/${ITEM}/upload-policy.pdf`,
      backend: "db",
    });
    mocks.removeExternal.mockResolvedValue(undefined);
    mocks.requireOrgContext.mockResolvedValue({
      orgId: ORG,
      user: { id: USER, email: "operator@example.test" },
    });
    mocks.tenantTransaction.mockImplementation(
      async (_orgId: string, work: (client: { query: typeof mocks.txQuery }) => Promise<unknown>) =>
        work({ query: mocks.txQuery })
    );
  });

  it("writes the edit, immutable event, and tenant audit on the transaction client", async () => {
    mocks.txQuery.mockImplementation(async (sqlValue: string) => {
      const sql = sqlOf(sqlValue);
      if (sql.startsWith("select *")) return { rows: [itemRow()] };
      if (sql.startsWith("update compliance_items")) {
        return { rows: [itemRow({ notes: "New proof" })] };
      }
      if (sql.startsWith("insert into compliance_item_events")) return { rows: [] };
      if (sql.startsWith("insert into agent_logs")) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const { POST } = await import("@/app/api/compliance/[id]/route");

    const response = await POST(
      new Request("https://app.test/api/compliance/item", {
        method: "POST",
        body: JSON.stringify({ notes: "New proof" }),
      }),
      { params: { id: ITEM } }
    );

    expect(response.status).toBe(200);
    expect(mocks.tenantTransaction).toHaveBeenCalledTimes(1);
    const sql = mocks.txQuery.mock.calls.map((call) => sqlOf(call[0]));
    expect(sql.some((text) => text.startsWith("insert into compliance_item_events"))).toBe(true);
    expect(sql.some((text) => text.startsWith("insert into agent_logs"))).toBe(true);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("returns a retryable 503 when an item edit cannot commit its event", async () => {
    mocks.txQuery.mockImplementation(async (sqlValue: string) => {
      const sql = sqlOf(sqlValue);
      if (sql.startsWith("select *")) return { rows: [itemRow()] };
      if (sql.startsWith("update compliance_items")) {
        return { rows: [itemRow({ notes: "New proof" })] };
      }
      if (sql.startsWith("insert into compliance_item_events")) throw new Error("event failed");
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const { POST } = await import("@/app/api/compliance/[id]/route");

    const response = await POST(
      new Request("https://app.test/api/compliance/item", {
        method: "POST",
        body: JSON.stringify({ notes: "New proof" }),
      }),
      { params: { id: ITEM } }
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ retryable: true });
    expect(mocks.logAgent).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("preserves a retryable storage failure status through the upload route", async () => {
    mocks.upload.mockRejectedValueOnce(new Error("storage offline"));
    mocks.txQuery.mockImplementation(async (sqlValue: string) => {
      const sql = sqlOf(sqlValue);
      if (sql.startsWith("select id from compliance_items")) return { rows: [{ id: ITEM }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const { POST } = await import("@/app/api/compliance/[id]/documents/route");
    const form = new FormData();
    form.append("file", pdf());

    const response = await POST(
      new Request("https://app.test/api/compliance/item/documents", {
        method: "POST",
        body: form,
      }),
      { params: { id: ITEM } }
    );

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, retryable: true });
    expect(body.failed[0]).toMatchObject({ status: 503, retryable: true });
  });

  it("rolls deletion back when its durable audit row cannot be written", async () => {
    mocks.txQuery.mockImplementation(async (sqlValue: string) => {
      const sql = sqlOf(sqlValue);
      if (sql.startsWith("select id, label")) return { rows: [itemRow()] };
      if (sql.startsWith("select count")) return { rows: [{ count: "0" }] };
      if (sql.startsWith("delete from compliance_items")) return { rows: [{ id: ITEM }] };
      if (sql.startsWith("insert into agent_logs")) throw new Error("audit unavailable");
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const { DELETE } = await import("@/app/api/compliance/[id]/route");

    const response = await DELETE(new Request("https://app.test/api/compliance/item"), {
      params: { id: ITEM },
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ retryable: true });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("blocks parent deletion until stored evidence is explicitly removed", async () => {
    mocks.txQuery.mockImplementation(async (sqlValue: string) => {
      const sql = sqlOf(sqlValue);
      if (sql.startsWith("select id, label")) return { rows: [itemRow()] };
      if (sql.startsWith("select count")) return { rows: [{ count: "1" }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const { DELETE } = await import("@/app/api/compliance/[id]/route");

    const response = await DELETE(new Request("https://app.test/api/compliance/item"), {
      params: { id: ITEM },
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("Remove the files"),
    });
    expect(
      mocks.txQuery.mock.calls.some((call) => sqlOf(call[0]).startsWith("delete from compliance_items"))
    ).toBe(false);
  });
});
