import { describe, expect, it } from "vitest";
import {
  PANE_CHIP,
  PANE_INTENT,
  PANE_TITLE,
  completableHere,
  paneFor,
  type WorkbenchPane,
} from "@/lib/domain/workbench";
import type { WorkKind } from "@/lib/domain/work-queue";

const KINDS: WorkKind[] = [
  "read_reply",
  "review_bid",
  "enter_quote",
  "call",
  "decide",
  "fix_blocker",
];

describe("which workspace a task opens into", () => {
  it("gives every queue kind a pane", () => {
    for (const kind of KINDS) {
      expect(paneFor({ kind })).toBeTruthy();
    }
  });

  it("opens a borderline score into the decision brief", () => {
    expect(paneFor({ kind: "decide" })).toBe("decide");
  });

  it("opens an unanswered quote request into the wait, not the decision", () => {
    /*
     * The one real judgment in the module. An unanswered request arrives as
     * `decide` because that is what it becomes; opening it into the brief
     * would offer pursue-or-pass on a bid pursued a week ago.
     */
    expect(paneFor({ kind: "decide", waitingOn: { party: "Rivera Mechanical" } })).toBe(
      "waiting"
    );
  });

  it("lets the wait override every kind, not just decisions", () => {
    expect(paneFor({ kind: "call", waitingOn: { party: "Someone" } })).toBe("waiting");
  });

  it("ignores a wait that is explicitly absent", () => {
    expect(paneFor({ kind: "call", waitingOn: null })).toBe("call");
  });
});

describe("what each pane says it is for", () => {
  const PANES: WorkbenchPane[] = [
    "decide",
    "reply",
    "call",
    "quote",
    "bid",
    "blocker",
    "waiting",
  ];

  it("titles, intents and chips cover every pane", () => {
    for (const pane of PANES) {
      expect(PANE_TITLE[pane]).toBeTruthy();
      expect(PANE_INTENT[pane]).toBeTruthy();
      expect(PANE_CHIP[pane]).toBeTruthy();
    }
  });

  it("says a wait cannot be completed here", () => {
    // A Complete button on a task nobody here can complete teaches people to
    // press it to make the row go away.
    expect(completableHere("waiting")).toBe(false);
  });

  it("says everything else can", () => {
    for (const pane of PANES.filter((p) => p !== "waiting")) {
      expect(completableHere(pane)).toBe(true);
    }
  });
});
