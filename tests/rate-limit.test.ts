import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { consume, forget, clientIp, __resetRateLimits } from "@/lib/rate-limit";
import { guardRejectedToken, guardWrite, rejectedTokenAllowed } from "@/lib/vendor-throttle";

const req = (headers: Record<string, string> = {}) =>
  new Request("https://brostco.com/api/vendor/tok/w9", { method: "POST", headers });

beforeEach(() => __resetRateLimits());
afterEach(() => vi.useRealTimers());

describe("the counter", () => {
  const rule = { limit: 3, windowMs: 60_000 };

  it("allows exactly the limit, then stops", () => {
    expect(consume("b", "k", rule).ok).toBe(true);
    expect(consume("b", "k", rule).ok).toBe(true);
    expect(consume("b", "k", rule).ok).toBe(true);
    expect(consume("b", "k", rule).ok).toBe(false);
  });

  it("counts down the allowance it reports", () => {
    expect(consume("b", "k", rule).remaining).toBe(2);
    expect(consume("b", "k", rule).remaining).toBe(1);
    expect(consume("b", "k", rule).remaining).toBe(0);
    expect(consume("b", "k", rule).remaining).toBe(0);
  });

  it("keeps separate keys separate", () => {
    for (let i = 0; i < 3; i++) consume("b", "one", rule);
    expect(consume("b", "one", rule).ok).toBe(false);
    expect(consume("b", "two", rule).ok).toBe(true);
  });

  /**
   * Namespacing is what stops a sub's signing attempts from eating into their
   * upload allowance, so it is worth pinning rather than assuming.
   */
  it("keeps the same key in different buckets separate", () => {
    for (let i = 0; i < 3; i++) consume("signing", "k", rule);
    expect(consume("signing", "k", rule).ok).toBe(false);
    expect(consume("uploads", "k", rule).ok).toBe(true);
  });

  it("gives the allowance back once the window passes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
    for (let i = 0; i < 3; i++) consume("b", "k", rule);
    expect(consume("b", "k", rule).ok).toBe(false);

    vi.setSystemTime(new Date("2026-08-13T12:01:01Z"));
    expect(consume("b", "k", rule).ok).toBe(true);
  });

  it("reports a retry-after inside the window, never zero", () => {
    const r = consume("b", "k", rule);
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
    expect(r.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("forgets a key on request", () => {
    for (let i = 0; i < 3; i++) consume("b", "k", rule);
    expect(consume("b", "k", rule).ok).toBe(false);
    forget("b", "k");
    expect(consume("b", "k", rule).ok).toBe(true);
  });
});

describe("finding the caller", () => {
  it("takes the client from the front of a proxy chain", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.5, 70.41.3.18, 150.172.238.178" }))).toBe(
      "203.0.113.5"
    );
  });

  it("falls back to x-real-ip, then to a constant", () => {
    expect(clientIp(req({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(req())).toBe("unknown");
  });
});

describe("the portal's limits", () => {
  const from = (ip: string) => req({ "x-forwarded-for": ip });

  it("lets a stale link through a few times before shutting the address down", () => {
    for (let i = 0; i < 10; i++) {
      expect(guardRejectedToken(from("198.51.100.1"))).toBeNull();
    }
    const blocked = guardRejectedToken(from("198.51.100.1"));
    expect(blocked?.status).toBe(429);
  });

  it("sets Retry-After so a well-behaved client knows when to come back", async () => {
    for (let i = 0; i < 11; i++) guardRejectedToken(from("198.51.100.2"));
    const blocked = guardRejectedToken(from("198.51.100.2"));
    expect(Number(blocked?.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("does not let one address's guessing lock out another", () => {
    for (let i = 0; i < 12; i++) guardRejectedToken(from("198.51.100.3"));
    expect(guardRejectedToken(from("198.51.100.4"))).toBeNull();
  });

  /**
   * The page and the API routes deliberately share one counter, so probing the
   * page first does not buy a fresh allowance at the POST.
   */
  it("shares the rejected-token count between the page and the routes", () => {
    for (let i = 0; i < 10; i++) rejectedTokenAllowed("198.51.100.5");
    expect(guardRejectedToken(from("198.51.100.5"))?.status).toBe(429);
  });

  it("allows a sub to sign a few times, then holds them off", () => {
    for (let i = 0; i < 5; i++) {
      expect(guardWrite(from("198.51.100.6"), "sub-a", "sign")).toBeNull();
    }
    expect(guardWrite(from("198.51.100.6"), "sub-a", "sign")?.status).toBe(429);
  });

  it("gives uploads a longer leash than signing, since a full set is four documents", () => {
    for (let i = 0; i < 20; i++) {
      expect(guardWrite(from("198.51.100.7"), "sub-b", "upload")).toBeNull();
    }
    expect(guardWrite(from("198.51.100.7"), "sub-b", "upload")?.status).toBe(429);
  });

  it("does not let one sub's signing exhaust their upload allowance", () => {
    for (let i = 0; i < 6; i++) guardWrite(from("198.51.100.8"), "sub-c", "sign");
    expect(guardWrite(from("198.51.100.8"), "sub-c", "upload")).toBeNull();
  });

  /**
   * The case that matters for a real jobsite: two firms behind one office
   * connection. The second must not be turned away because the first was busy.
   */
  it("keeps one sub's limit from blocking another at the same address", () => {
    for (let i = 0; i < 6; i++) guardWrite(from("198.51.100.9"), "sub-d", "sign");
    expect(guardWrite(from("198.51.100.9"), "sub-e", "sign")).toBeNull();
  });

  it("still caps total writes from one address across every sub", () => {
    // 60 an hour, spread over subs so no per-sub limit fires first.
    for (let s = 0; s < 20; s++) {
      for (let i = 0; i < 3; i++) {
        guardWrite(from("198.51.100.10"), `sub-${s}`, "upload");
      }
    }
    expect(guardWrite(from("198.51.100.10"), "sub-fresh", "upload")?.status).toBe(429);
  });
});
