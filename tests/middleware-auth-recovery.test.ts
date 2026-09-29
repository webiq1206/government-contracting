import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

describe("expired session recovery", () => {
  it.each(["/marketing/hero-background.mp4", "/marketing/hero-poster.jpg"])("serves public hero media without a session: %s", (path) => {
    const response = middleware(new NextRequest(`https://example.test${path}`));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });
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

describe("one public host", () => {
  it("sends www to the apex host permanently, keeping path and query", () => {
    const response = middleware(new NextRequest("https://www.brostco.com/resources/idaho-government-contracts?ref=x", { headers: { host: "www.brostco.com" } }));
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://brostco.com/resources/idaho-government-contracts?ref=x");
  });
  it("respects the forwarded scheme behind a proxy", () => {
    const response = middleware(new NextRequest("http://www.brostco.com/", { headers: { host: "www.brostco.com", "x-forwarded-proto": "https" } }));
    expect(response.headers.get("location")).toBe("https://brostco.com/");
  });
  it("leaves the apex host and preview hosts alone", () => {
    for (const host of ["brostco.com", "localhost:3000", "abc.replit.dev"]) {
      const response = middleware(new NextRequest(`https://${host}/platform`, { headers: { host } }));
      expect(response.headers.get("location"), host).toBeNull();
    }
  });
});
