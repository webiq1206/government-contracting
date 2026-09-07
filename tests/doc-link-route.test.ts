import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeDocToken } from "@/lib/domain/doc-link";

const OPPORTUNITY = "991f1e31-4c12-4a3c-80af-0fb8c8c67784";

const mocks = vi.hoisted(() => ({
  org: "7dbd9b8b-c9fc-4b1f-85e3-59866816b75c",
  opportunity: vi.fn(async () => ({
    org_id: "7dbd9b8b-c9fc-4b1f-85e3-59866816b75c",
  } as { org_id: string } | null)),
  fileOwner: vi.fn(async () => "7dbd9b8b-c9fc-4b1f-85e3-59866816b75c" as string | null),
  download: vi.fn(async () => Buffer.from("document bytes")),
}));
const ORG = mocks.org;

vi.mock("@/lib/db", () => ({ queryOne: mocks.opportunity }));
vi.mock("@/lib/domain/file-ownership", () => ({
  orgIdForStorageKey: mocks.fileOwner,
}));
vi.mock("@/lib/integrations/storage", () => ({
  storage: { download: mocks.download },
}));

describe("public document link revocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_SECRET = "doc-link-route-test-secret";
    mocks.opportunity.mockResolvedValue({ org_id: ORG });
    mocks.fileOwner.mockResolvedValue(ORG);
    mocks.download.mockResolvedValue(Buffer.from("document bytes"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stops a package link as soon as its opportunity is purged", async () => {
    const { GET } = await import("@/app/d/[token]/route");
    const token = encodeDocToken({
      k: "p",
      v: OPPORTUNITY,
      n: "Bid documents",
      e: Math.floor(Date.now() / 1000) + 3600,
      d: [{ k: "u", v: "https://sam.gov/api/spec.pdf", n: "Spec.pdf" }],
    });
    mocks.opportunity.mockResolvedValueOnce(null);

    const response = await GET(new Request(`https://app.test/d/${token}`), {
      params: { token },
    });

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toMatch(/no longer available/i);
  });

  it("refuses a stored file whose owner does not match the scoped opportunity", async () => {
    const { GET } = await import("@/app/d/[token]/route");
    const token = encodeDocToken({
      k: "s",
      v: "orgs/other/private.pdf",
      n: "Private.pdf",
      e: Math.floor(Date.now() / 1000) + 3600,
      o: OPPORTUNITY,
    });
    mocks.fileOwner.mockResolvedValueOnce("fa8a9198-b687-48c4-ab78-f5f8413b41a1");

    const response = await GET(new Request(`https://app.test/d/${token}`), {
      params: { token },
    });

    expect(response.status).toBe(404);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("serves an active scoped file without allowing it to be cached", async () => {
    const { GET } = await import("@/app/d/[token]/route");
    const storagePath = `orgs/${ORG}/opportunities/spec.pdf`;
    const token = encodeDocToken({
      k: "s",
      v: storagePath,
      n: "Spec.pdf",
      e: Math.floor(Date.now() / 1000) + 3600,
      o: OPPORTUNITY,
    });

    const response = await GET(new Request(`https://app.test/d/${token}`), {
      params: { token },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
    expect(mocks.fileOwner).toHaveBeenCalledWith(storagePath, { failOnError: true });
  });

  it("reports a verification outage as retryable", async () => {
    const { GET } = await import("@/app/d/[token]/route");
    const token = encodeDocToken({
      k: "u",
      v: "https://sam.gov/api/spec.pdf",
      n: "Spec.pdf",
      e: Math.floor(Date.now() / 1000) + 3600,
      o: OPPORTUNITY,
    });
    mocks.opportunity.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await GET(new Request(`https://app.test/d/${token}`), {
      params: { token },
    });

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toMatch(/try again/i);
  });

  it("does not follow an allowed upstream URL onto an unapproved host", async () => {
    const { GET } = await import("@/app/d/[token]/route");
    const token = encodeDocToken({
      k: "u",
      v: "https://sam.gov/api/spec.pdf",
      n: "Spec.pdf",
      e: Math.floor(Date.now() / 1000) + 3600,
      o: OPPORTUNITY,
    });
    const fetchMock = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/internal" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request(`https://app.test/d/${token}`), {
      params: { token },
    });

    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://sam.gov/api/spec.pdf", {
      redirect: "manual",
    });
  });
});
