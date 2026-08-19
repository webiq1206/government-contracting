/**
 * Sign-in must not report an outage as a wrong password.
 *
 * The login route wrapped authenticate() in a catch that turned every
 * exception into "Invalid email or password". When the published app could not
 * reach its database, that is exactly what the owner saw: a correct password
 * rejected, over and over, with nothing to suggest the fault was ours. Hours
 * went into hunting a password that was never wrong.
 *
 * A rejected password and an authentication check that could not run are
 * different events and must read differently.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const authenticate = vi.fn();
const createSession = vi.fn(async () => "session-token");
const setSessionCookie = vi.fn(async () => {});

vi.mock("@/lib/auth", () => ({
  authenticate: (...args: unknown[]) => authenticate(...(args as [string, string])),
  createSession: (...args: unknown[]) => createSession(...(args as [])),
  setSessionCookie: (...args: unknown[]) => setSessionCookie(...(args as [])),
}));

import { POST } from "@/app/api/auth/login/route";

/** A fresh IP per case, so one case's failures cannot lock out the next. */
function loginRequest(email: string, password: string, ip = `10.0.0.${Math.floor(Math.random() * 250) + 1}`) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email, password }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("sign-in tells an outage apart from a bad password", () => {
  it("answers 503 when the authentication check cannot run", async () => {
    authenticate.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:5432"));
    const res = await POST(loginRequest("owner@example.invalid", "correct-password-1"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/temporarily unavailable/i);
    // The one thing this message must never do is blame the password.
    expect(body.error).not.toMatch(/invalid email or password/i);
  });

  it("keeps the database's own error out of the response", async () => {
    authenticate.mockRejectedValue(new Error("password authentication failed for user prod_owner"));
    const res = await POST(loginRequest("owner@example.invalid", "correct-password-1"));
    expect(JSON.stringify(await res.json())).not.toMatch(/prod_owner/);
  });

  it("still answers 401 for a genuinely wrong password", async () => {
    authenticate.mockResolvedValue(null);
    const res = await POST(loginRequest("owner@example.invalid", "wrong-password-1"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/invalid email or password/i);
  });

  it("does not count an outage toward the lockout", async () => {
    // Otherwise a few minutes of downtime locks the owner out for ten more
    // after the site comes back.
    const ip = "10.0.9.9";
    authenticate.mockRejectedValue(new Error("db down"));
    for (let i = 0; i < 12; i++) {
      const res = await POST(loginRequest("locked@example.invalid", "correct-password-1", ip));
      expect(res.status).toBe(503);
    }
    authenticate.mockResolvedValue({ id: "u1", email: "locked@example.invalid", role: "operator" });
    const res = await POST(loginRequest("locked@example.invalid", "correct-password-1", ip));
    expect(res.status).toBe(200);
  });

  it("signs in normally when authentication succeeds", async () => {
    authenticate.mockResolvedValue({ id: "u1", email: "owner@example.invalid", role: "operator" });
    const res = await POST(loginRequest("owner@example.invalid", "correct-password-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, user: { email: "owner@example.invalid" } });
    expect(setSessionCookie).toHaveBeenCalled();
  });
});
