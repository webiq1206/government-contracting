import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "db/migrations/110_skip_suppression_provenance.sql",
  "utf8"
);

describe("skip suppression provenance migration", () => {
  it("adds a tenant-guarded call-card relationship without guessing history", () => {
    expect(migration).toContain("add column if not exists source_call_card_id uuid");
    expect(migration).toMatch(
      /foreign key \(source_call_card_id\) references public\.call_cards\(id\)[\s\S]*on delete set null not valid/i
    );
    expect(migration).toContain("outreach_suppressions_source_call_card_idx");
    expect(migration).toContain("select public.install_tenant_reference_guards()");
    expect(migration).not.toMatch(/update[\s\S]+source_call_card_id\s*=/i);
  });
});
