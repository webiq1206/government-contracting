import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentOrgId } from "@/lib/tenant-context";

const ORG_ID = "33333333-3333-4333-8333-333333333333";
const SUB_ID = "44444444-4444-4444-8444-444444444444";

const mocks = vi.hoisted(() => ({
  orgId: "33333333-3333-4333-8333-333333333333" as string | null,
  upload: vi.fn(),
  sign: vi.fn(),
}));

vi.mock("@/lib/domain/sub-portal-link", () => ({
  decodePortalToken: vi.fn(() => ({ s: SUB_ID, e: 4_000_000_000 })),
}));

vi.mock("@/lib/sub-compliance-store", () => ({
  loadPortalSubject: vi.fn(async () => ({
    id: SUB_ID,
    company_name: "Scoped Electric",
    owner_name: null,
    email: "scoped@example.test",
    org_id: mocks.orgId,
  })),
  parseComplianceUpload: vi.fn(async () => ({
    ok: true,
    value: {
      docType: "license",
      file: { name: "license.pdf", mime: "application/pdf", bytes: Buffer.from("pdf") },
    },
  })),
  recordUploadedDocument: mocks.upload,
  recordSignedW9: mocks.sign,
}));

vi.mock("@/lib/domain/w9", () => ({
  EMPTY_W9: {},
  validateW9: vi.fn(() => ({})),
}));

vi.mock("@/lib/vendor-throttle", () => ({
  guardRejectedToken: vi.fn(() => null),
  guardWrite: vi.fn(() => null),
}));

vi.mock("@/lib/logger", () => ({ logAgent: vi.fn(async () => undefined) }));

describe("vendor portal organization context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.orgId = ORG_ID;
    mocks.upload.mockImplementation(async () => ({
      id: `upload-in-${currentOrgId()}`,
      storagePath: "subcontractors/scoped/license.pdf",
    }));
    mocks.sign.mockImplementation(async () => ({
      id: `w9-in-${currentOrgId()}`,
      storagePath: "subcontractors/scoped/w9.pdf",
    }));
  });

  it("runs an unauthenticated document upload inside the token subject's org", async () => {
    const { POST } = await import("@/app/api/vendor/[token]/documents/route");
    const data = new FormData();
    data.set("file", new File(["pdf"], "license.pdf", { type: "application/pdf" }));
    const response = await POST(
      new Request("https://app.test/api/vendor/token/documents", { method: "POST", body: data }),
      { params: { token: "token" } }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: `upload-in-${ORG_ID}` });
  });

  it("runs an unauthenticated W-9 write inside the token subject's org", async () => {
    const { POST } = await import("@/app/api/vendor/[token]/w9/route");
    const response = await POST(
      new Request("https://app.test/api/vendor/token/w9", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ certified: true }),
      }),
      { params: { token: "token" } }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: `w9-in-${ORG_ID}` });
  });

  it("refuses an orphaned portal subject before either write", async () => {
    mocks.orgId = null;
    const { POST } = await import("@/app/api/vendor/[token]/documents/route");
    const response = await POST(
      new Request("https://app.test/api/vendor/token/documents", {
        method: "POST",
        body: new FormData(),
      }),
      { params: { token: "token" } }
    );

    expect(response.status).toBe(404);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
