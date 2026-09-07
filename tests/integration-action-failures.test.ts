import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

const {
  disconnectGoogleInboxRequest,
  saveGoogleSenderRequest,
} = await import("../components/google-inbox-card");
const { removeIntegrationKeyRequest } = await import("../components/integration-manager");

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("Google Inbox settings actions", () => {
  it("keeps a rejected sender change visible as a failure", async () => {
    const request = vi.fn(async () =>
      jsonResponse({ error: "Google does not list that address as verified." }, 400)
    );

    const result = await saveGoogleSenderRequest("bids@example.com", request);

    expect(result).toEqual({
      ok: false,
      message: "Google does not list that address as verified. Check the address and try again.",
    });
    expect(request).toHaveBeenCalledWith(
      "/api/integrations/gmail/sender",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ address: "bids@example.com" }),
      })
    );
  });

  it("does not treat an unreadable sender response as success", async () => {
    const result = await saveGoogleSenderRequest(
      null,
      vi.fn(async () => new Response("not json", { status: 200 }))
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("could not be confirmed");
  });

  it("turns a sender transport failure into retry guidance", async () => {
    const result = await saveGoogleSenderRequest("bids@example.com", async () => {
      throw new Error("socket closed");
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("server could not be reached");
      expect(result.message).toContain("refresh this page");
    }
  });

  it("accepts only an explicitly confirmed sender change", async () => {
    await expect(
      saveGoogleSenderRequest(
        "bids@example.com",
        vi.fn(async () => jsonResponse({ ok: true, sendAs: "bids@example.com" }))
      )
    ).resolves.toEqual({ ok: true });

    const unconfirmed = await saveGoogleSenderRequest(
      "bids@example.com",
      vi.fn(async () => jsonResponse({ sendAs: "bids@example.com" }))
    );
    expect(unconfirmed.ok).toBe(false);
  });

  it("surfaces a rejected disconnect instead of refreshing as if it worked", async () => {
    const result = await disconnectGoogleInboxRequest(
      vi.fn(async () => jsonResponse({ error: "You no longer have permission." }, 403))
    );

    expect(result).toEqual({
      ok: false,
      message: "You no longer have permission. Try again.",
    });
  });

  it("does not confirm a disconnect after malformed or interrupted responses", async () => {
    const malformed = await disconnectGoogleInboxRequest(
      vi.fn(async () => new Response("gateway page", { status: 200 }))
    );
    const interrupted = await disconnectGoogleInboxRequest(async () => {
      throw new Error("connection reset");
    });

    expect(malformed.ok).toBe(false);
    expect(interrupted.ok).toBe(false);
    if (!malformed.ok) expect(malformed.message).toMatch(/refresh this page/i);
    if (!interrupted.ok) expect(interrupted.message).toMatch(/refresh this page/i);
  });
});

describe("integration credential removal", () => {
  it("returns the replacement list only after explicit success", async () => {
    const integrations = [{ id: "sam" }];
    const request = vi.fn(async () => jsonResponse({ ok: true, integrations }));

    const result = await removeIntegrationKeyRequest("SAM_API_KEY", request);

    expect(result).toEqual({ ok: true, integrations });
    expect(request).toHaveBeenCalledWith(
      "/api/integrations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ remove: ["SAM_API_KEY"] }),
      })
    );
  });

  it("surfaces the API reason when removal is rejected", async () => {
    const result = await removeIntegrationKeyRequest(
      "SAM_API_KEY",
      vi.fn(async () => jsonResponse({ error: "Removal is not allowed." }, 403))
    );

    expect(result).toEqual({
      ok: false,
      message:
        "Removal is not allowed. The current value remains shown; try again.",
    });
  });

  it("preserves the current state when a success response has no replacement list", async () => {
    const result = await removeIntegrationKeyRequest(
      "SAM_API_KEY",
      vi.fn(async () => jsonResponse({ ok: true }))
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("could not be confirmed");
      expect(result.message).toContain("current value remains shown");
    }
  });

  it("surfaces malformed and transport failures with refresh guidance", async () => {
    const malformed = await removeIntegrationKeyRequest(
      "SAM_API_KEY",
      vi.fn(async () => new Response("not json", { status: 502 }))
    );
    const interrupted = await removeIntegrationKeyRequest("SAM_API_KEY", async () => {
      throw new Error("offline");
    });

    expect(malformed.ok).toBe(false);
    expect(interrupted.ok).toBe(false);
    if (!malformed.ok) {
      expect(malformed.message).toContain("HTTP 502");
      expect(malformed.message).toContain("current value remains shown");
    }
    if (!interrupted.ok) expect(interrupted.message).toMatch(/refresh this page/i);
  });
});
