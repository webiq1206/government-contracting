import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("support-session exit failure state", () => {
  it("does not navigate away when the server did not end impersonation", () => {
    const source = readFileSync("components/impersonation-banner.tsx", "utf8");
    const failed = source.indexOf("if (!res.ok)");
    const navigation = source.indexOf("window.location.href");
    expect(failed).toBeGreaterThan(0);
    expect(navigation).toBeGreaterThan(failed);
    expect(source.slice(failed, navigation)).toContain("return;");
    expect(source).toContain("You are still viewing the customer account");
    expect(source).toContain('role="alert"');
    expect(source).toContain("min-h-11");
  });
});
