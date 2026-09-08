import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("password reset atomicity", () => {
  it("locks and consumes the token with the password and session changes in one transaction", () => {
    const source = readFileSync("lib/auth-password-reset.ts", "utf8");
    const reset = source.slice(source.indexOf("export async function resetPasswordWithToken"));

    expect(reset).toContain("transaction(async (client)");
    expect(reset).toMatch(/password_reset_tokens[\s\S]*for update/);
    expect(reset).toMatch(/update users[\s\S]*client\.query/);
    expect(reset).toMatch(/set used_at = now\(\)[\s\S]*returning id/);
    expect(reset).toMatch(/delete from sessions where user_id = \$1/);
    expect(reset).not.toMatch(/await queryOne/);
  });
});
