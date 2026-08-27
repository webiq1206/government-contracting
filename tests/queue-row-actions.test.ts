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

describe("the controls on a row", () => {
  it("are outside the link rather than inside it swallowing clicks", () => {
    /*
     * A button inside an anchor is invalid, needs a click stopped to work at
     * all, and lands in a strange place in the tab order. Outside, a keyboard
     * reaches it in the order it reads.
     */
    const rowStart = SRC.indexOf("<li key={item.key}");
    const linkEnd = SRC.indexOf("</Link>", rowStart);
    const actions = SRC.indexOf("item.actions?.snooze", rowStart);
    expect(actions).toBeGreaterThan(linkEnd);
  });

  it("appear under the row on a phone rather than being hidden there", () => {
    // Hiding them below sm would mean the device most of this queue is worked
    // from is the one that cannot work it.
    expect(SRC).not.toContain("hidden shrink-0 sm:inline-flex");
    expect(SRC).toContain("px-4 pb-3 sm:shrink-0");
  });

  it("offer undo on the one that archives something", () => {
    // A pass made from a list is the one most likely to have been the wrong
    // row.
    const pass = SRC.slice(SRC.indexOf('body={{ action: "dismiss" }}'));
    expect(pass.slice(0, 700)).toContain('action: "restore"');
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
