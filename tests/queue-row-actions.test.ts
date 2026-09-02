import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * What a queue row can do without leaving the list.
 *
 * The rows were links and nothing else. Deciding meant opening the record,
 * deciding, and coming back to a list that had moved, while the themed
 * sections further down the same page had had snooze, pursue and pass inline
 * all along. That made the one list the least capable place to work from,
 * which is the opposite of what a single task list is for.
 */

const SRC = readFileSync("components/work-queue.tsx", "utf8");
const DATA = readFileSync("lib/data.ts", "utf8");
const ROW_ACTIONS = readFileSync("components/row-actions.tsx", "utf8");

/**
 * The queue row's markup, located rather than assumed.
 *
 * `SRC.indexOf("<li key={item.key}")` was the locator, and the tag is spread
 * over two lines now, so it returned -1 and every slice taken from it silently
 * addressed the whole file instead of the row. The guard below it went on
 * passing while measuring nothing, which is the failure mode a source-scanning
 * test is most prone to: it cannot tell "the rule holds" from "I did not find
 * the code". So this throws when it cannot find the row.
 */
function queueRow(): { start: number; end: number; text: string } {
  const m = /<li[\s\S]{0,60}?key=\{item\.key\}/.exec(SRC);
  if (!m) throw new Error("the queue row markup moved; these guards need updating");
  const start = m.index;
  const end = SRC.indexOf("</li>", start);
  if (end === -1) throw new Error("the queue row has no closing tag; guards need updating");
  return { start, end, text: SRC.slice(start, end) };
}

describe("the controls on a row", () => {
  it("are outside the link rather than inside it swallowing clicks", () => {
    /*
     * A button inside an anchor is invalid, needs a click stopped to work at
     * all, and lands in a strange place in the tab order. Outside, a keyboard
     * reaches it in the order it reads.
     */
    const { start } = queueRow();
    const linkEnd = SRC.indexOf("</Link>", start);
    const actions = SRC.indexOf("<RowActionsForItem", start);
    expect(linkEnd).toBeGreaterThan(start);
    expect(actions).toBeGreaterThan(linkEnd);
  });

  it("appear under the row on a phone rather than being hidden there", () => {
    /*
     * Hiding them below sm would mean the device most of this queue is worked
     * from is the one that cannot work it.
     *
     * Written against the property rather than the class that once carried
     * it. The row was a flex line with the controls pulled out of the flow by
     * `px-4 pb-3 sm:shrink-0`; it is a grid now, one column on a phone so the
     * controls land under the row and two from sm so they sit beside it. Both
     * satisfy the rule, and a guard pinned to either spelling fails the next
     * time somebody re-lays out a row without breaking anything. What must
     * stay true is that the row stacks before sm and that nothing hides the
     * action column on the way.
     */
    const row = queueRow().text;

    // One column on a phone, two from the small breakpoint up.
    expect(row).toMatch(/grid-cols-1\b/);
    expect(row).toMatch(/\bsm:grid-cols-\[/);

    // And nothing takes the controls away on a narrow screen.
    const actionsAt = row.indexOf("<RowActionsForItem");
    expect(actionsAt, "the row no longer renders RowActionsForItem").toBeGreaterThan(-1);
    const actionColumn = row.slice(row.lastIndexOf("<div", actionsAt), actionsAt);
    expect(actionColumn).not.toMatch(/\bhidden\b/);
    expect(actionColumn).not.toMatch(/\bsm:(?:inline-)?(?:flex|block)\b/);
  });

  it("offer undo on the one that archives something", () => {
    /*
     * A pass made from a list is the one most likely to have been the wrong
     * row, so it goes through the control that asks for a reason and offers
     * the undo. The queue no longer draws that control itself: it asks the
     * shared module what this row can do, and the shared component hands a
     * pass to the same PassButton the record page uses. Two thinner copies of
     * one decision is how two screens end up disagreeing about what it means.
     */
    expect(SRC).toContain("workItemRowActions");
    expect(ROW_ACTIONS).toContain("PassButton");
  });
});

describe("which rows get which", () => {
  it("does not offer Pass beside a bid that is already being built", () => {
    /*
     * Pursue and pass belong to a scoring decision. Offering "pass" next to a
     * package in bid_building would put an archive button beside a week of
     * somebody's work.
     */
    const actionable = DATA.slice(DATA.indexOf("...actionable.map"));
    const block = actionable.slice(0, actionable.indexOf("...awaitingReply.map"));
    expect(block).toContain('actions: { snooze: { kind: "opportunity" as const');
    expect(block).not.toContain("decide: {");
  });

  it("snoozes the call card rather than the opportunity", () => {
    // The bid is not on hold because one subcontractor is being rung on
    // Thursday instead.
    const calls = DATA.slice(DATA.indexOf("...calls.map"));
    expect(calls.slice(0, calls.indexOf("...actionable.map"))).toContain('kind: "call_card" as const');
  });

  it("gives a reply waiting to be read no snooze at all", () => {
    /*
     * The thing to snooze would be the conversation, and a conversation
     * somebody outside this company is waiting on is not something to hide.
     */
    const replies = DATA.slice(DATA.indexOf("...replies.map"));
    expect(replies.slice(0, replies.indexOf("...decisions.map"))).not.toContain("actions:");
  });
});
