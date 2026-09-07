import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("app/api/account/password/route.ts", "utf8");

describe("password change atomicity", () => {
  it("changes the password and revokes older sessions in one transaction", () => {
    expect(source).toContain("transaction(async (client)");
    expect(source).toContain("select password_hash from users where id = $1 for update");
    expect(source).toContain("update users set password_hash");
    expect(source).toContain("delete from sessions where user_id");
  });

  it("does not turn account or session write failures into success", () => {
    expect(source).not.toContain("queryOne<{ password_hash: string }>");
    expect(source).not.toContain(".catch(() => [])");
    expect(source).toContain("Your existing password and sessions are unchanged");
    expect(source).toContain("status: 503");
  });
});
