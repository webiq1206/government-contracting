/**
 * Documentation that quotes a setting goes stale the day somebody changes it.
 *
 * This product had exactly that: "after about 48 hours" was true of every
 * account until the follow-up window became a setting, and then it was true
 * of some of them and read as authoritative on all of them. The fix was to
 * render the account's own value, and the risk is that the next person to
 * write a sentence about behaviour types the number again.
 *
 * So this reads the prose the product ships and fails when a sentence states
 * a figure that is really a setting. The failure names the file and the
 * sentence, which is the documentation review task: rewrite it to read the
 * live value, the way the surrounding prose already does.
 *
 * Deliberately narrow. It guards the numbers that ARE settings on this
 * account, not every number anybody writes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WORKFLOW_STEPS } from "@/lib/domain/knowledge";
import { PAGE_HELP } from "@/lib/help-content";

const ROOT = join(__dirname, "..");

/**
 * Sentences that state a duration or a score threshold.
 *
 * Both are configurable per account: the follow-up window, the calling
 * window, the review timer, the retention period, and the pursue and review
 * thresholds. A sentence that names one is describing somebody else's
 * account as if it were everybody's.
 */
const HARDCODED = [
  /\b\d+\s*(?:-|\s)?hours?\b/i,
  /\b\d+\s*(?:-|\s)?days?\b/i,
  /\bscor\w* (?:of|above|below|over|under|at least) \d+/i,
];

/** Prose where a bare number is genuinely not a setting. */
const ALLOWED = [
  // Counting what happened, not stating a rule.
  /last 7 days/i,
  // The government's own fixed rules, which this product does not set.
  /5 (?:letters|digits)/i,
];

function offendingLines(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => {
      if (ALLOWED.some((a) => a.test(line))) return false;
      return HARDCODED.some((h) => h.test(line));
    })
    .map((l) => l.trim());
}

describe("shipped prose does not quote a setting", () => {
  it("keeps the workflow map free of hardcoded windows", () => {
    const bad: string[] = [];
    for (const s of WORKFLOW_STEPS) {
      const prose = [s.what, s.next, s.input, s.output, s.recovery, s.automatic, s.manual, ...s.blockers];
      for (const line of prose) {
        if (ALLOWED.some((a) => a.test(line))) continue;
        if (HARDCODED.some((h) => h.test(line))) bad.push(`${s.key}: ${line}`);
      }
    }
    // A failure here is a documentation review task: rewrite the sentence to
    // read the account's own value, the way triggerText and settingNotes do.
    expect(bad).toEqual([]);
  });

  it("keeps the per-page help free of them too", () => {
    const bad: string[] = [];
    for (const [page, help] of Object.entries(PAGE_HELP)) {
      const prose = [help.what, ...(help.how ?? []), ...(help.watch ?? [])].filter(
        (x): x is string => typeof x === "string"
      );
      for (const line of prose) {
        if (ALLOWED.some((a) => a.test(line))) continue;
        if (HARDCODED.some((h) => h.test(line))) bad.push(`${page}: ${line}`);
      }
    }
    expect(bad).toEqual([]);
  });

  /**
   * Guards the guard. A regex that matches nothing would make both
   * assertions above pass forever, including on the sentence they exist to
   * catch.
   */
  it("catches the sentence this test was written for", () => {
    expect(offendingLines("A follow-up goes out after about 48 hours.")).toHaveLength(1);
    expect(offendingLines("Opportunities scoring above 70 are pursued.")).toHaveLength(1);
    expect(offendingLines("Counts the last 7 days.")).toHaveLength(0);
  });
});
