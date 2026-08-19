/**
 * The forgot-password endpoint must never answer "a link is on its way" when
 * nothing was sent.
 *
 * There are three ways to send nothing: no mail transport, a caller who has hit
 * the rate limit, and the request failing outright (the database being
 * unreachable is the one that has actually happened, and it is exactly when
 * someone is trying to get back in). All three used to be indistinguishable
 * from success.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const requestPasswordReset = vi.fn();

vi.mock("@/lib/auth-password-reset", () => ({
  requestPasswordReset: (...args: unknown[]) => requestPasswordReset(...(args as [string])),
}));

import { POST } from "@/app/api/auth/forgot-password/route";
import { __resetRateLimits } from "@/lib/rate-limit";

function forgotRequest(email: string, ip = "10.1.0.1") {
  return new Request("http://localhost/api/auth/forgot-password", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimits();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("forgot-password never claims a link was sent when none was", () => {
  it("reports delivered when a link went out", async () => {
    requestPasswordReset.mockResolvedValue({ ok: true, delivery: "sent" });
    const res = await POST(forgotRequest("owner@example.invalid"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, delivered: true });
  });

  it("reports not delivered when there is no mail transport", async () => {
    requestPasswordReset.mockResolvedValue({ ok: true, delivery: "unavailable" });
    expect(await (await POST(forgotRequest("owner@example.invalid"))).json()).toEqual({
      ok: true,
      delivered: false,
    });
  });

  it("reports not delivered when the request itself fails", async () => {
    // The database being down must not surface as "check your email".
    requestPasswordReset.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const res = await POST(forgotRequest("owner@example.invalid"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, delivered: false });
  });

  it("keeps the underlying error out of the response", async () => {
    requestPasswordReset.mockRejectedValue(new Error("password authentication failed for prod_owner"));
    expect(JSON.stringify(await (await POST(forgotRequest("owner@example.invalid"))).json())).not.toMatch(
      /prod_owner/
    );
  });

  it("reports not delivered once the caller is rate limited", async () => {
    requestPasswordReset.mockResolvedValue({ ok: true, delivery: "sent" });
    const ip = "10.1.0.99";
    for (let i = 0; i < 5; i++) {
      expect(await (await POST(forgotRequest("owner@example.invalid", ip))).json()).toEqual({
        ok: true,
        delivered: true,
      });
    }
    const throttled = await POST(forgotRequest("owner@example.invalid", ip));
    expect(throttled.status).toBe(200);
    expect(await throttled.json()).toEqual({ ok: true, delivered: false });
    expect(requestPasswordReset).toHaveBeenCalledTimes(5);
  });

  it("answers 200 for every case, so the status code is not an account oracle", async () => {
    requestPasswordReset.mockResolvedValue({ ok: true, delivery: "sent" });
    const known = await POST(forgotRequest("owner@example.invalid", "10.1.0.2"));
    requestPasswordReset.mockResolvedValue({ ok: true, delivery: "unavailable" });
    const unknown = await POST(forgotRequest("nobody@example.invalid", "10.1.0.3"));
    expect(known.status).toBe(unknown.status);
    expect(known.status).toBe(200);
  });
});
