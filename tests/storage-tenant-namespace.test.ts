import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_A = "a66389bf-2db2-4db7-ac72-96398531ad76";
const ORG_B = "a1f9f954-a9d8-4bf3-9ddd-e68ab3c6e041";

const mocks = vi.hoisted(() => ({
  resolveOrg: vi.fn<() => Promise<string>>(),
  query: vi.fn(),
}));

vi.mock("@/lib/tenant", () => ({ resolveTenantOrgId: mocks.resolveOrg }));
vi.mock("@/lib/db", () => ({
  query: mocks.query,
  queryOne: vi.fn(async () => null),
}));

describe("tenant-owned storage keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOrg.mockResolvedValue(ORG_A);
    mocks.query.mockImplementation(async (_sql: string, params: unknown[]) => [
      { path: params[0] },
    ]);
  });

  it("gives identical logical names different physical paths for each tenant", async () => {
    const { storage } = await import("@/lib/integrations/storage");
    const a = await storage.upload("bids/shared.pdf", Buffer.from("a"), "application/pdf");
    mocks.resolveOrg.mockResolvedValueOnce(ORG_B);
    const b = await storage.upload("bids/shared.pdf", Buffer.from("b"), "application/pdf");

    expect(a.path).toBe(`orgs/${ORG_A}/bids/shared.pdf`);
    expect(b.path).toBe(`orgs/${ORG_B}/bids/shared.pdf`);
    expect(a.path).not.toBe(b.path);
  });

  it("does not double-prefix a key already in the current tenant namespace", async () => {
    const { storage } = await import("@/lib/integrations/storage");
    const key = `orgs/${ORG_A}/bids/version-2.pdf`;
    await expect(storage.upload(key, Buffer.from("a"), "application/pdf")).resolves.toMatchObject({
      path: key,
    });
  });

  it("refuses an explicit path in another tenant namespace", async () => {
    const { storage, StorageOwnershipCollisionError } = await import(
      "@/lib/integrations/storage"
    );
    await expect(
      storage.upload(`orgs/${ORG_B}/private/w9.pdf`, Buffer.from("a"), "application/pdf")
    ).rejects.toBeInstanceOf(StorageOwnershipCollisionError);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("requires a real tenant context and never falls back to the founding account", async () => {
    const { storage } = await import("@/lib/integrations/storage");
    mocks.resolveOrg.mockRejectedValueOnce(new Error("No organization context."));

    await expect(
      storage.upload("documents/orphan.pdf", Buffer.from("a"), "application/pdf")
    ).rejects.toThrow(/No organization context/);
    expect(mocks.resolveOrg).toHaveBeenCalledWith();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("does not fall back to local storage after the database rejects an ownership collision", async () => {
    const { storage, StorageOwnershipCollisionError } = await import(
      "@/lib/integrations/storage"
    );
    mocks.query.mockResolvedValueOnce([]);

    await expect(
      storage.upload("documents/existing.pdf", Buffer.from("a"), "application/pdf")
    ).rejects.toBeInstanceOf(StorageOwnershipCollisionError);
  });

  it("rejects traversal and invalid organization identifiers before writing", async () => {
    const { storageKeyForOrg } = await import("@/lib/integrations/storage");
    expect(() => storageKeyForOrg("../outside.pdf", ORG_A)).toThrow(/not valid/i);
    expect(() => storageKeyForOrg("inside.pdf", "not-an-org")).toThrow(/organization/i);
  });
});
