/**
 * One number on Today.
 *
 * The home screen used to print three: a ledger sum that counted the same
 * opportunity in urgent, bid work and flagged (404), a work-queue remaining
 * counter (351), and a tab badge that added the buckets again. A person
 * cannot plan a morning around any of them once they disagree.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  dedupeWorkItems,
  needsYou,
  needsYouCount,
  queueCounts,
  type WorkItem,
} from "@/lib/domain/work-queue";

function item(over: Partial<WorkItem> & { key: string }): WorkItem {
  return {
    kind: "fix_blocker",
    title: "Resolve blocker",
    context: "Hangar paint",
    href: "/today",
    recordHref: "/today",
    actionLabel: "Open",
    ...over,
  };
}

describe("what Today is allowed to count", () => {
  it("counts one opportunity once even when it matches two queue kinds", () => {
    const items = dedupeWorkItems([
      item({ key: "decide:opp-1", kind: "decide", title: "Pursue or pass: Hangar paint" }),
      item({ key: "act:opp-1", kind: "fix_blocker", title: "Resolve blocker: Hangar paint" }),
    ]);
    expect(items).toHaveLength(1);
    expect(needsYouCount(items)).toBe(1);
  });

  it("makes overdue, due today and remaining add up to the headline", () => {
    const now = new Date("2026-09-02T17:00:00Z");
    const items = needsYou([
      item({ key: "a", due: "2026-08-01T00:00:00Z" }),
      item({ key: "b", due: "2026-09-02T20:00:00Z" }),
      item({ key: "c" }),
      item({
        key: "d",
        waitingOn: { party: "A subcontractor" },
      }),
    ]);
    const c = queueCounts(items, now);
    expect(c.overdue + c.dueToday + c.remaining).toBe(c.total);
    expect(c.total).toBe(3);
  });
});

describe("the three surfaces cannot diverge", () => {
  it("Today prints the work-queue total, not the overlapping ledger sum", () => {
    const src = readFileSync("app/(dash)/today/page.tsx", "utf8");
    expect(src).toContain("const actionable = needsYou(queueItems)");
    expect(src).toContain("const totalActions = counts.total");
    expect(src).toContain("actionBreakdown={summarizeQueue(actionable)}");
    expect(src).not.toMatch(/const totalActions = ledger\.total/);
    expect(src).not.toContain("actionBreakdown={ledgerBreakdown(ledger)}");
  });

  it("the Today tab badge counts distinct records, not a sum of buckets", () => {
    const src = readFileSync("lib/data.ts", "utf8");
    const at = src.indexOf("export async function queueCounts()");
    expect(at).toBeGreaterThan(-1);
    const fn = src.slice(at, src.indexOf("export const PIPELINE_STAGES", at));
    expect(fn).toContain("union");
    expect(fn).toContain("from needs");
    expect(fn).not.toMatch(/Number\(row\?\.urgent/);
  });

  it("Guide Me uses the same badge total when it has one", () => {
    const src = readFileSync("lib/guide/load.ts", "utf8");
    expect(src).toContain("needsYouTotal: badge.today");
  });

  it("keeps queue actions inside the card, with one button per row", () => {
    const src = readFileSync("components/work-queue.tsx", "utf8");
    expect(src).toContain("sm:grid-cols-[minmax(0,1fr)_auto]");
    expect(src).not.toContain("pointer-events-none");
  });

  it("does not lead the home screen with a bare integer", () => {
    const src = readFileSync("components/today-greeting.tsx", "utf8");
    const headline = src.slice(src.indexOf("{settingUp ?"), src.indexOf("Work the queue"));
    expect(headline.indexOf("{parts.greeting}")).toBeLessThan(headline.indexOf("{actionCount}"));
  });
});
