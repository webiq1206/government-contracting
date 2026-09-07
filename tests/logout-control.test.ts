import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("sign-out controls", () => {
  it("never uses a state-changing GET link from the expired-trial modal", () => {
    const modal = readFileSync("components/trial-expired-modal.tsx", "utf8");
    const control = readFileSync("components/logout-control.tsx", "utf8");

    expect(modal).not.toContain('href="/api/auth/logout"');
    expect(modal).toContain("<LogoutControl");
    expect(control).toContain('fetch("/api/auth/logout", { method: "POST" })');
    expect(control).toContain("if (!response.ok)");
    expect(control).toContain('role="alert"');
  });
});
