import { afterEach, describe, expect, it, vi } from "vitest";
import { actionError, requestAction, ACTION_UNCONFIRMED } from "@/lib/client/action-request";

afterEach(() => vi.unstubAllGlobals());
describe("action recovery feedback", () => {
  it("never treats an HTML login redirect or malformed success as completed work", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("<html>Sign in</html>", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await requestAction("/api/action", {})).toEqual({ ok: false, error: ACTION_UNCONFIRMED });
  });
  it("returns confirmed JSON and preserves validation failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ ok: true, id: "record" }))
      .mockResolvedValueOnce(Response.json({ error: "Choose a subcontractor before continuing." }, { status: 400 })));
    expect(await requestAction("/api/action", {})).toEqual({ ok: true, data: { ok: true, id: "record" } });
    expect(await requestAction("/api/action", {})).toEqual({ ok: false, error: "Choose a subcontractor before continuing." });
  });
  it("does not automatically retry when the response is lost after a mutation", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("ETIMEDOUT private-database.internal"));
    vi.stubGlobal("fetch", fetcher);
    expect(await requestAction("/api/action", { method: "POST" })).toEqual({ ok: false, error: ACTION_UNCONFIRMED });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("hides server diagnostics and gives sign-in, permission and rate-limit recovery", () => {
    expect(actionError(500, "password=secret SQLSTATE 42P01")).toBe(ACTION_UNCONFIRMED);
    expect(actionError(400, "relation sessions does not exist")).toBe(ACTION_UNCONFIRMED);
    expect(actionError(401)).toContain("Sign in again");
    expect(actionError(403)).toContain("review your access");
    expect(actionError(429)).toContain("Wait a moment");
  });
  it("does not treat a structured failed action with HTTP 200 as success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: false })));
    expect((await requestAction("/api/action", {})).ok).toBe(false);
  });
});
