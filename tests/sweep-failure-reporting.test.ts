/**
 * A sweep may not report work it did not do.
 *
 * Two swallowed failures sat in the compliance sweep, and the inner one was
 * the dangerous half. `update subcontractor_documents set status = ...` ended
 * in `.catch(() => {})`, and the document was pushed onto `justExpired`
 * regardless, so a failed write produced a digest telling the operator a
 * subcontractor was LAPSED while the row still said active. That row is what
 * the rest of the product reads: the rule that no work goes out behind a
 * lapsed certificate is enforced off the status, so an uninsured
 * subcontractor stayed cleared for work, and nothing recorded that a write
 * had failed.
 *
 * Verified against a real database by making the update throw: the run now
 * logs `status-write-failed` at error level naming the subcontractor, and
 * says so in its summary. Before, the same run reported "1 newly lapsed".
 *
 * Source assertions, because both failures need a broken database to reach
 * and neither is worth a fixture that installs a trigger on a shared table.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const SWEEP = readFileSync("lib/agents/compliance-sweep.ts", "utf8");

describe("what the compliance sweep does when a write fails", () => {
  it("does not swallow the status write", () => {
    expect(SWEEP).not.toContain(".catch(() => {})");
    expect(SWEEP).toContain("writeFailed.push");
  });

  it("does not count a document it could not write as newly lapsed", () => {
    // `continue` before the justExpired push is the whole fix.
    const block = SWEEP.slice(SWEEP.indexOf("for (const doc of docs)"), SWEEP.indexOf("Said once per run"));
    expect(block.indexOf("writeFailed.push")).toBeLessThan(block.indexOf("justExpired.push"));
    expect(block).toContain("continue;");
  });

  it("reports the failure at error level, which is what automation health reads", () => {
    expect(SWEEP).toContain('action: "status-write-failed"');
    expect(SWEEP).toContain('status: "error"');
  });

  it("names an account it could not sweep instead of quietly moving on", () => {
    expect(SWEEP).toContain("failedOrgs");
    // "across 5 of 5" rather than "across 5", so a skipped account is visible
    // in the sentence rather than only in the totals.
    expect(SWEEP).toContain("${swept} of ${orgs.length} org(s)");
  });

  it("asks for a person when its own picture of coverage is out of date", () => {
    expect(SWEEP).toContain("humanAction || unrecorded > 0");
  });
});
