import { beforeEach, describe, expect, it, vi } from "vitest";
import { LEGACY_ORG_ID } from "@/lib/tenant-context";

const mocks = vi.hoisted(() => ({
  owner: vi.fn<() => Promise<string | null>>(async () => null),
  verifyToken: vi.fn(() => false),
  download: vi.fn(async () => {
    throw new Error("storage must not be read before ownership is proved");
  }),
}));

vi.mock("@/lib/org-guard", () => ({
  requireOrgContext: vi.fn(async () => ({
    orgId: LEGACY_ORG_ID,
    user: { id: "env-operator" },
    access: "full",
  })),
}));

vi.mock("@/lib/domain/file-ownership", () => ({
  orgIdForStorageKey: mocks.owner,
}));

vi.mock("@/lib/integrations/storage", () => ({
  verifyFileToken: mocks.verifyToken,
  storage: {
    signedUrl: vi.fn(async () => null),
    download: mocks.download,
    getMime: vi.fn(async () => null),
  },
}));

describe("stored file ownership for the founding organization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.owner.mockResolvedValue(null);
    mocks.verifyToken.mockReturnValue(false);
  });

  it("returns the same not-found response when the legacy org does not own the key", async () => {
    const { GET } = await import("@/app/api/files/[...path]/route");
    const key = "another-tenant/private/w9.pdf";
    const response = await GET(new Request(`https://app.test/api/files/${key}`), {
      params: { path: key.split("/") },
    });

    expect(response.status).toBe(404);
    expect(mocks.owner).toHaveBeenCalledWith(key, { failOnError: true });
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("revokes a valid signed token when its ownership record was deleted", async () => {
    const { GET } = await import("@/app/api/files/[...path]/route");
    const key = "deleted-tenant/private/w9.pdf";
    mocks.verifyToken.mockReturnValue(true);

    const response = await GET(
      new Request(`https://app.test/api/files/${key}?exp=9999999999&sig=valid`),
      { params: { path: key.split("/") } }
    );

    expect(response.status).toBe(404);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("explains a temporary verification failure instead of treating it as a missing file", async () => {
    const { GET } = await import("@/app/api/files/[...path]/route");
    mocks.verifyToken.mockReturnValue(true);
    mocks.owner.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await GET(
      new Request("https://app.test/api/files/docs/a.pdf?exp=9999999999&sig=valid"),
      { params: { path: ["docs", "a.pdf"] } }
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/try again/i) });
  });
});
