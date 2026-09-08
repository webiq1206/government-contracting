import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("orphaned user cleanup migration", () => {
  const sql = readFileSync("db/migrations/104_user_actor_delete_behavior.sql", "utf8")
    .replace(/\s+/g, " ")
    .toLowerCase();

  for (const [table, column] of [
    ["platform_key_grants", "granted_by"],
    ["conversation_flags", "resolved_by"],
    ["subcontractor_documents", "verified_by"],
    ["influencer_payouts", "approved_by"],
  ] as const) {
    it(`keeps ${table}.${column} history without retaining a deleted login`, () => {
      expect(sql).toMatch(
        new RegExp(
          `alter table ${table} .*foreign key \\(${column}\\) references users\\(id\\) on delete set null`
        )
      );
    });
  }
});
