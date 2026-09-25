/**
 * One definition of "did not arrive", shared by every surface.
 *
 * The recap reported "10 emails sent, 10 did not arrive" for a day of held
 * sends because a held approach was written as `failed` with no provider and
 * every report read that as vanished mail. These guard the predicates and
 * the caveat that replaced the ambiguous count.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  bouncedEmailSql,
  deliveredEmailSql,
  failedEmailSql,
  neverSentEmailSql,
  sentEmailSql,
  undeliveredNote,
} from "@/lib/domain/email-reporting";

const squash = (sql: string) => sql.replace(/\s+/g, " ");

describe("email reporting predicates", () => {
  it("excludes deliberate holds and drafts from every failure count", () => {
    expect(squash(neverSentEmailSql())).toContain("delivery_state not in ('draft', 'held')");
    expect(squash(failedEmailSql())).toContain("not in ('draft', 'held')");
  });

  it("counts a bounce only after a real provider handoff", () => {
    expect(squash(bouncedEmailSql())).toContain("provider is not null");
    expect(squash(bouncedEmailSql())).toContain("delivery_state = 'bounced'");
  });

  it("treats a provider handoff as a send, and engagement as delivery", () => {
    expect(squash(sentEmailSql())).toContain("in ('sent', 'delivered', 'bounced', 'deferred')");
    expect(squash(deliveredEmailSql())).toContain("opened_at is not null");
    expect(squash(deliveredEmailSql())).toContain("replied_at is not null");
  });

  it("is an OR of two predicates, so callers must wrap it", () => {
    // A bare `where ${failedEmailSql()} and c.created_at >= $1` would bind
    // the date filter to the second half only.
    expect(failedEmailSql().trim().startsWith("(")).toBe(true);
    for (const file of ["lib/recap/platform.ts", "lib/recap/gather.ts", "lib/admin/platform-health.ts"]) {
      const src = readFileSync(file, "utf8");
      for (const match of src.matchAll(/failedEmailSql\(\)/g)) {
        const before = src.slice(Math.max(0, match.index! - 4), match.index!);
        const wrapped = before.includes("(") || src.slice(match.index! - 40, match.index!).includes("FAILED_SEND_SQL");
        expect(wrapped, `${file} at ${match.index}`).toBe(true);
      }
    }
  });
});

describe("undeliveredNote", () => {
  it("says which kind of trouble it was", () => {
    expect(undeliveredNote(6, 0)).toBe("6 bounced");
    expect(undeliveredNote(0, 10)).toBe("10 never left");
    expect(undeliveredNote(2, 3)).toBe("2 bounced, 3 never left");
  });

  it("says nothing when nothing went wrong", () => {
    expect(undeliveredNote(0, 0)).toBeUndefined();
  });
});
