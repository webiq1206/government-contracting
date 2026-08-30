/**
 * The guards around the recap, read from the source.
 *
 * Every one of these is invisible: nothing on screen changes if a guard stops
 * working, and the failure mode is a recap of somebody else's account, a mail
 * relay behind a login page, or a support session sending mail as the customer
 * it is helping. Static checks because the mistake is always an omission, and
 * an omission is exactly what reading the file catches.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

const ROUTES = {
  settings: "app/api/recap/settings/route.ts",
  preview: "app/api/recap/preview/route.ts",
  test: "app/api/recap/test/route.ts",
  retry: "app/api/recap/deliveries/[id]/retry/route.ts",
  preferences: "app/api/account/recap-preferences/route.ts",
};

describe("every recap endpoint requires a session", () => {
  it.each(Object.entries(ROUTES))("%s is behind an auth guard", (_name, path) => {
    const src = read(path);
    expect(src).toMatch(/require(User|Subscriber|Capability)\(/);
  });

  it("gates writing the account's settings behind a capability, not mere membership", () => {
    const src = read(ROUTES.settings);
    const post = src.slice(src.indexOf("export async function POST"));
    expect(post).toContain('requireCapability("manage_rules")');
  });

  it("resolves the account from the session rather than from the request", () => {
    for (const path of [ROUTES.settings, ROUTES.preview, ROUTES.test, ROUTES.retry]) {
      const src = read(path);
      expect(src, path).toContain("tryResolveTenantOrgId");
      // An org id arriving in the body or the query string would let any
      // member read any account's morning.
      expect(src, path).not.toMatch(/body\.orgId|searchParams\.get\("orgId"\)/);
    }
  });
});

describe("mail-sending endpoints", () => {
  it("sends a test only to the caller's own address", () => {
    const src = read(ROUTES.test);
    expect(src).toContain("to: auth.email");
    expect(src).not.toMatch(/to:\s*body\./);
  });

  it("rate limits the test send per person and per account", () => {
    const src = read(ROUTES.test);
    expect(src).toContain('consume("recap-test"');
    expect(src).toContain('consume("recap-test-org"');
  });

  it("rate limits retries too, so the history is not a send button in a loop", () => {
    expect(read(ROUTES.retry)).toContain("consume(");
  });

  it("refuses to send anything while somebody is impersonating", () => {
    for (const path of [ROUTES.test, ROUTES.retry]) {
      expect(read(path), path).toContain("impersonatedBy");
    }
  });

  it("resends the stored copy on retry instead of rebuilding the day", () => {
    const src = read(ROUTES.retry);
    // Rebuilding would send a different day than the one that was promised.
    expect(src).not.toContain("buildRecapFor");
    expect(src).toContain("getDelivery");
  });
});

describe("viewing never changes anything", () => {
  it("previews and pages build without recording ages", () => {
    for (const path of [ROUTES.preview, ROUTES.test, "app/(dash)/recap/page.tsx"]) {
      expect(read(path), path).toContain("recordAges: false");
    }
  });

  it("the preview is never cached, because it is live data", () => {
    expect(read(ROUTES.preview)).toMatch(/no-store/);
  });
});

describe("the platform-wide recap", () => {
  it("is behind the platform-admin guard, which answers 404", () => {
    const src = read("app/(dash)/admin/recap/page.tsx");
    expect(src).toContain("requirePlatformAdmin");
  });

  it("carries no organization, so no tenant filter can be mistaken for one", () => {
    const src = read("lib/recap/platform.ts");
    expect(src).toContain('scope: "platform"');
    expect(src).toContain("orgId: null");
  });
});

describe("the agent", () => {
  it("does its per-account work inside the tenant context", () => {
    expect(read("lib/agents/daily-recap.ts")).toContain("runWithOrg");
  });

  it("claims a delivery before sending, so two workers cannot both send", () => {
    const src = read("lib/agents/daily-recap.ts");
    const claimAt = src.indexOf("claimDelivery");
    const sendAt = src.indexOf("sendDigest");
    expect(claimAt).toBeGreaterThan(-1);
    expect(claimAt).toBeLessThan(sendAt);
  });

  it("is scheduled often enough to catch every recipient's send time", () => {
    const src = read("lib/agents/registry.ts");
    const line = src.split("\n").find((l) => l.includes("dailyRecap") && l.includes("cron"));
    expect(line, "dailyRecap has no cron entry").toBeTruthy();
    // Recipients choose their own time to the minute, and zones are offset by
    // 30 and 45 minutes in places. A run gap wider than 15 minutes would send
    // some people's recap noticeably late every single day.
    expect(line!).toMatch(/\*\/(1|5|10|15) \* \* \* \*/);
  });
});
