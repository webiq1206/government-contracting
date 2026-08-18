import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The "Test connection" button must test the credential the app would actually
 * use, and must only report on the saved configuration when that is what it
 * tested.
 *
 * Both halves were wrong. It read process.env while the page beside it said
 * "saved here" about a per-organization row in the database, so in production
 * it tested a leftover value and reported the failure as SAM.gov's fault. And
 * it recorded the outcome even when the operator was trying an unsaved key,
 * which stamps a result on a credential nobody tested.
 */

const requireUser = vi.fn();
const orgApiKey = vi.fn();
const recordValidation = vi.fn();
const samValidator = vi.fn();

vi.mock("@/lib/api-auth", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/integration-keys", () => ({
  orgApiKey: (k: string, o?: string) => orgApiKey(k, o),
}));
vi.mock("@/lib/integration-settings", async () => {
  const actual = await vi.importActual<typeof import("../lib/integration-settings")>(
    "../lib/integration-settings"
  );
  return {
    isAllowedKey: actual.isAllowedKey,
    recordValidation: (...a: unknown[]) => recordValidation(...a),
  };
});
vi.mock("@/lib/integration-defs", () => ({
  INTEGRATION_DEFS: [{ id: "sam", fields: [{ env: "SAM_API_KEY" }] }],
}));
vi.mock("@/lib/integration-validators", () => ({
  VALIDATORS: { sam: (v: Record<string, string>) => samValidator(v) },
}));

const post = async (body: unknown) => {
  const { POST } = await import("../app/api/integrations/test/route");
  const res = await POST(
    new Request("http://localhost/api/integrations/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  return { status: res.status, json: await res.json() };
};

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "user-1", organizationId: "org-7" });
  orgApiKey.mockResolvedValue("the-saved-key");
  recordValidation.mockResolvedValue(undefined);
  samValidator.mockResolvedValue({ ok: true, message: "Connected." });
});

describe("POST /api/integrations/test", () => {
  it("tests the organization's saved key, not the process environment", async () => {
    process.env.SAM_API_KEY = "a-leftover-deployment-value";

    const { json } = await post({ integration: "sam" });

    expect(orgApiKey).toHaveBeenCalledWith("SAM_API_KEY", "org-7");
    expect(samValidator).toHaveBeenCalledWith({ SAM_API_KEY: "the-saved-key" });
    expect(json.ok).toBe(true);
  });

  it("lets an unsaved key typed into the form win, so it can be checked first", async () => {
    await post({ integration: "sam", values: { SAM_API_KEY: "  typed-draft  " } });

    expect(samValidator).toHaveBeenCalledWith({ SAM_API_KEY: "typed-draft" });
    expect(orgApiKey).not.toHaveBeenCalled();
  });

  it("records the result against the saved key when the saved key was tested", async () => {
    await post({ integration: "sam" });

    expect(recordValidation).toHaveBeenCalledWith("SAM_API_KEY", true, undefined);
  });

  it("records nothing when a draft key was tested instead", async () => {
    samValidator.mockResolvedValue({ ok: false, message: "SAM.gov did not recognize this key." });

    await post({ integration: "sam", values: { SAM_API_KEY: "mistyped" } });

    // A mistyped draft must not mark the working saved key as broken.
    expect(recordValidation).not.toHaveBeenCalled();
  });

  it("reports a thrown validator as unreachable rather than crashing", async () => {
    samValidator.mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.sam.gov"));

    const { json } = await post({ integration: "sam" });

    expect(json.ok).toBe(false);
    expect(json.message).toMatch(/couldn't reach the service/i);
  });

  it("rejects an integration it does not know", async () => {
    const { status } = await post({ integration: "not-a-thing" });
    expect(status).toBe(400);
  });
});
