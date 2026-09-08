import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("password reset visible failure", () => {
  it("returns an actionable unavailable response without claiming a change", () => {
    const route = readFileSync("app/api/auth/reset-password/route.ts", "utf8");
    expect(route).toContain("[reset-password] transaction failed:");
    expect(route).toContain("Your password was not changed");
    expect(route).toContain("{ status: 503 }");
  });

  it("recovers from a network failure and announces it", () => {
    const form = readFileSync("components/reset-password-form.tsx", "utf8");
    expect(form).toContain("The server could not be reached");
    expect(form).toContain("setPending(false)");
    expect(form).toContain('role="alert"');
  });
});
