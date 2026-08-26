/**
 * The work ledger must count work, not the size of a preview list.
 *
 * Several of Today's queries are capped because they render a preview strip
 * as well as feeding a number: `limit 8`, `limit 10`, `limit 20`. Passing such
 * a list's `.length` into the ledger reports the cap. An account with thirty
 * borderline opportunities was once told it had ten, which is the defect the
 * `totals` block was added to fix.
 *
 * It fixed nine of the eleven inputs. `compliance` still passed
 * `complianceAlerts.length`, and that query is `limit 8`, so an account with
 * twenty overdue registrations was told in its headline number that it had
 * eight. A number that is wrong in the safe direction is still a number
 * somebody plans a morning around.
 *
 * This reads the source of the call site rather than mocking it, because the
 * defect was not in any function's logic: every function was correct and the
 * wrong one was being called. Only the call site shows that.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const todaySource = readFileSync(join(process.cwd(), "app/(dash)/today/page.tsx"), "utf8");

/** The argument object literal passed to buildWorkLedger on Today. */
function ledgerCallArgs(): string {
  const at = todaySource.indexOf("buildWorkLedger({");
  expect(at, "Today no longer calls buildWorkLedger; this guard needs updating").toBeGreaterThan(-1);
  const open = todaySource.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < todaySource.length; i++) {
    if (todaySource[i] === "{") depth++;
    else if (todaySource[i] === "}") {
      depth--;
      if (depth === 0) return todaySource.slice(open, i + 1);
    }
  }
  throw new Error("unbalanced braces in the buildWorkLedger call");
}

describe("Today's work ledger inputs", () => {
  it("takes compliance from the uncapped total, not the capped preview list", () => {
    const args = ledgerCallArgs();
    expect(args).toMatch(/compliance:\s*data\.totals\.compliance/);
    expect(args).not.toMatch(/compliance:\s*data\.complianceAlerts\.length/);
  });

  it("uses no capped list length for any input except the one that is genuinely uncapped", () => {
    /*
     * awardCompliance is the single legitimate `.length`: loadAwardCompliance
     * has no LIMIT, and needsAttentionOnWonWork is a JS predicate over a
     * computed assessment. Reproducing that predicate in SQL to obtain a
     * "proper" total would create a second source of truth, which is the thing
     * this ledger exists to remove. Any OTHER `.length` is the bug returning.
     */
    const args = ledgerCallArgs();
    const lengths = [...args.matchAll(/(\w+):\s*data\.(\w+)\.length/g)].map((m) => m[1]);
    expect(lengths).toEqual(["awardCompliance"]);
  });

  it("still passes every bucket the ledger knows about", () => {
    // A guard that silently stopped covering a bucket would be worse than none.
    const args = ledgerCallArgs();
    for (const key of [
      "urgent", "replyReviews", "triage", "calls", "bidWork", "quoteReviews",
      "subFollowUps", "compliance", "awardCompliance", "flagged", "approvals",
    ]) {
      expect(args, `ledger input ${key} is missing`).toMatch(new RegExp(`\\b${key}:`));
    }
  });
});

describe("the capped query this was about", () => {
  it("is still capped, so the guard above is still guarding something", () => {
    /*
     * If somebody lifts the LIMIT from complianceAlerts, the guard above stops
     * describing a real risk and starts being folklore. This fails loudly in
     * that case so the comment can be corrected rather than quietly outliving
     * its reason.
     */
    const data = readFileSync(join(process.cwd(), "lib/data.ts"), "utf8");
    const at = data.indexOf("from compliance_items\n        where org_id = $1");
    expect(at, "the complianceAlerts query moved; re-check whether it is still capped").toBeGreaterThan(-1);
    expect(data.slice(at, at + 400)).toMatch(/limit\s+\d+/);
  });
});
