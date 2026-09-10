import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

describe("expired session recovery", () => {
  it("returns JSON without redirecting protected API requests to login HTML", async () => {
    const response = middleware(new NextRequest("https://example.test/api/automation", { method: "POST" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toEqual({ error: "Your sign-in has expired. Sign in again to continue." });
  });
  it("keeps page sign-in redirects and public auth endpoints working", () => {
    expect(middleware(new NextRequest("https://example.test/today")).headers.get("location")).toBe("https://example.test/login?next=%2Ftoday");
    expect(middleware(new NextRequest("https://example.test/api/auth/login", { method: "POST" })).headers.get("x-middleware-next")).toBe("1");
  });
  it("leaves session validation and tenant permissions to protected handlers", () => {
    const request = new NextRequest("https://example.test/api/automation", { headers: { cookie: "brostco_session=unverified-test-token" } });
    expect(middleware(request).headers.get("x-middleware-next")).toBe("1");
  });
});
