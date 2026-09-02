import { describe, expect, it } from "vitest";
import {
  compactSections,
  conversationQuickView,
  opportunityQuickView,
  parseQuickView,
  quickViewValue,
  subcontractorQuickView,
  workItemQuickView,
  type OpportunityQuickFacts,
} from "../lib/domain/quick-view";
import { queuePosition } from "../lib/domain/workspace-queue";

/**
 * The Quick View contract.
 *
 * What the drawer shows is decided here rather than in the component, so the
 * two things most easily got wrong -- a section that draws as a heading over
 * nothing, and a link that opens a record the surface never meant to show --
 * can be checked without rendering anything.
 */

const NOW = new Date("2026-03-10T17:00:00Z");

function opp(over: Partial<OpportunityQuickFacts> = {}): OpportunityQuickFacts {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Fort Carson roofing",
    agency: "Department of the Army",
    stage: "outreach",
    deadline: "2026-03-20T17:00:00Z",
    requiredTrades: [],
    tradesRequired: 0,
    tradesCovered: 0,
    quoteCount: 0,
    subsContacted: 0,
    subsResponded: 0,
    bidSubmitted: false,
    outcome: null,
    riskFlags: [],
    attachments: [],
    messages: [],
    ...over,
  };
}

describe("a section with nothing in it", () => {
  it("is left out rather than drawn as a heading over blanks", () => {
    const sections = compactSections([
      { key: "status", title: "Where it stands", facts: [{ label: "Stage", value: "Outreach" }] },
      {
        key: "detail",
        title: "The solicitation",
        facts: [
          { label: "NAICS", value: null },
          { label: "Set aside", value: "" },
          null,
        ],
      },
    ]);
    expect(sections.map((s) => s.key)).toEqual(["status"]);
  });

  it("keeps a fact whose blank is worth saying out loud", () => {
    const sections = compactSections([
      {
        key: "subs",
        title: "Subcontractors",
        facts: [{ label: "Contacted", value: null, unknown: "Nobody contacted yet" }],
      },
    ]);
    expect(sections).toHaveLength(1);
    expect(sections[0].facts[0].unknown).toBe("Nobody contacted yet");
  });

  it("keeps a fact carried by badges instead of a value", () => {
    const sections = compactSections([
      {
        key: "detail",
        title: "The solicitation",
        facts: [{ label: "Trades it needs", value: null, badges: ["Roofing"] }],
      },
    ]);
    expect(sections).toHaveLength(1);
  });
});

describe("an opportunity with almost nothing known about it", () => {
  it("shows the sections it can fill and drops the rest", () => {
    const view = opportunityQuickView(opp({ agency: null, deadline: null }), NOW);
    const keys = view.sections.map((s) => s.key);
    expect(keys).toContain("status");
    // No value, no NAICS, no set aside, no trades: nothing to say about the
    // solicitation, so the heading does not appear either.
    expect(keys).not.toContain("detail");
    expect(keys).not.toContain("progress");
  });

  it("still says what to do next, in a sentence", () => {
    const view = opportunityQuickView(opp(), NOW);
    expect(view.nextAction).toBeTruthy();
    expect(view.nextAction!.endsWith(".")).toBe(true);
  });

  it("always offers the way into the full record", () => {
    const view = opportunityQuickView(opp(), NOW);
    expect(view.openHref).toBe(`/opportunity/${opp().id}`);
    expect(view.openLabel).toBeTruthy();
  });

  it("names a risk flag as something in the way rather than a field", () => {
    const view = opportunityQuickView(opp({ riskFlags: ["missing_wage_determination"] }), NOW);
    expect(view.blockers).toHaveLength(1);
    expect(view.blockers[0]).not.toContain("_");
  });

  it("puts the sections in one order whatever the record is", () => {
    const full = opportunityQuickView(
      opp({
        naics: "238160",
        requiredTrades: ["Roofing"],
        tradesRequired: 2,
        tradesCovered: 1,
        subsContacted: 3,
        subsResponded: 1,
      }),
      NOW
    );
    expect(full.sections.map((s) => s.key)).toEqual([
      "status",
      "dates",
      "detail",
      "progress",
      "subs",
    ]);
  });
});

describe("the other record kinds", () => {
  it("describes a firm nobody has contacted without inventing numbers", () => {
    const view = subcontractorQuickView({
      id: "22222222-2222-4222-8222-222222222222",
      companyName: "Peak Mechanical",
      email: null,
      phone: null,
      stateLabel: "No way to reach them",
      stateDetail: "There is no email address and no phone number on this record.",
      canContact: false,
      canAward: true,
      reliability: null,
      outreach: 0,
      respondedAny: 0,
      quoteCount: 0,
      messages: [],
      attachments: [],
    });
    expect(view.title).toBe("Peak Mechanical");
    expect(view.sections.every((s) => s.facts.length > 0)).toBe(true);
    expect(view.messages).toHaveLength(0);
  });

  it("keeps a work item that has no record of its own useful", () => {
    const view = workItemQuickView(
      {
        key: "reply:33333333-3333-4333-8333-333333333333",
        kind: "reply_review",
        title: "Reply from Peak Mechanical",
        context: "Fort Carson roofing",
        actionLabel: "Read the reply",
        href: "/communications?c=pair:a:b",
        recordHref: "/communications?c=pair:a:b",
        blocker: "The draft commits to a price nobody has approved.",
      },
      NOW
    );
    expect(view.blockers).toEqual(["The draft commits to a price nobody has approved."]);
    expect(view.nextAction).toContain("read the reply");
    expect(view.openHref).toBe("/communications?c=pair:a:b");
  });

  it("carries a thread's own recommendation rather than restating its state", () => {
    const view = conversationQuickView({
      threadKey: "pair:aaaa:bbbb",
      subject: "Fort Carson roofing",
      subcontractorId: "44444444-4444-4444-8444-444444444444",
      subcontractorName: "Peak Mechanical",
      subcontractorEmail: "bids@peak.example",
      opportunityId: null,
      opportunityTitle: "Fort Carson roofing",
      trade: "Roofing",
      state: "needs_reply",
      stateLabel: "Needs a reply",
      reason: "They answered four days ago and nobody has written back.",
      nextAction: "Write back with the quote deadline.",
      lastAt: "2026-03-06T17:00:00Z",
      messageCount: 4,
      unreadCount: 1,
      followUpAt: null,
      failedState: null,
      messages: [],
      attachments: [],
      openHref: "/communications?c=pair:aaaa:bbbb",
    });
    expect(view.nextAction).toBe("Write back with the quote deadline.");
  });
});

describe("the drawer's address", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("round trips a record through the query parameter", () => {
    const value = quickViewValue({ kind: "opportunity", id });
    expect(parseQuickView(value, { allowed: ["opportunity"] })).toEqual({
      kind: "opportunity",
      id,
    });
  });

  it("refuses a kind the surface does not show", () => {
    const value = quickViewValue({ kind: "subcontractor", id });
    expect(parseQuickView(value, { allowed: ["opportunity"] })).toBeNull();
  });

  it("closes when the parameter is gone", () => {
    expect(parseQuickView(undefined, { allowed: ["opportunity"] })).toBeNull();
    expect(parseQuickView("", { allowed: ["opportunity"] })).toBeNull();
  });

  it("keeps the links the two original surfaces already wrote working", () => {
    // A bookmark from before the drawer was addressed by kind: a bare id.
    expect(parseQuickView(id, { allowed: ["opportunity"], defaultKind: "opportunity" })).toEqual({
      kind: "opportunity",
      id,
    });
  });

  it("survives a thread key with colons of its own", () => {
    const threadKey = "pair:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const value = quickViewValue({ kind: "conversation", id: threadKey });
    expect(parseQuickView(value, { allowed: ["conversation"] })).toEqual({
      kind: "conversation",
      id: threadKey,
    });
  });

  it("does not open a record from a value that is not an id", () => {
    expect(parseQuickView("opportunity:../../admin", { allowed: ["opportunity"] })).toBeNull();
    expect(parseQuickView("opportunity:1 or 1=1", { allowed: ["opportunity"] })).toBeNull();
  });
});

describe("walking the list behind the drawer", () => {
  const values = ["a", "b", "c"].map((id) => quickViewValue({ kind: "work", id }));

  it("moves in the order the list is showing", () => {
    const at = queuePosition(values, values[1]);
    expect(at.prevId).toBe(values[0]);
    expect(at.nextId).toBe(values[2]);
    expect(at.index).toBe(1);
    expect(at.total).toBe(3);
  });

  it("stops at both ends instead of wrapping", () => {
    expect(queuePosition(values, values[0]).prevId).toBeNull();
    expect(queuePosition(values, values[2]).nextId).toBeNull();
  });

  it("offers no arrows for a record that is not in the list", () => {
    const at = queuePosition(values, quickViewValue({ kind: "work", id: "z" }));
    expect(at.prevId).toBeNull();
    expect(at.nextId).toBeNull();
    expect(at.index).toBe(-1);
  });
});

describe("the queue surfaces, where a row is a piece of work rather than a record", () => {
  /*
   * Today and the Workbench rail show work items, and their drawers show the
   * record behind the item. The controls must still be the row's: building
   * them from the record would offer stage moves, reruns and aborts that the
   * row never offered, so the same person would get two different answers
   * about the same item depending on where they clicked.
   */
  const SOURCES = ["app/(dash)/today/page.tsx", "app/(dash)/workbench/page.tsx"];

  for (const file of SOURCES) {
    it(`${file} builds its drawer's controls from the row it was opened from`, async () => {
      const { readFileSync } = await import("node:fs");
      const src = readFileSync(file, "utf8");
      const peekBlock = src.slice(src.indexOf("peekActions"));
      expect(peekBlock).toContain("workItemRowActions");
      expect(peekBlock).not.toContain("peekActions = opportunityRowActions");
      expect(peekBlock).not.toContain("peekActions = callCardRowActions");
    });
  }
});

describe("the two surfaces that had a peek before this one", () => {
  const readSrc = async (file: string) =>
    (await import("node:fs")).readFileSync(file, "utf8");

  for (const file of ["app/(dash)/pipeline/page.tsx", "app/(dash)/subs/page.tsx"]) {
    it(`${file} accepts the shared address as well as the bare id it writes`, async () => {
      const src = await readSrc(file);
      expect(src).toContain("parseQuickView(");
      expect(src).toContain("defaultKind");
    });
  }
});

describe("the opportunities board", () => {
  /*
   * The drawer was mounted for all four views but only the table offered a way
   * into it, which made the quick look a table feature on a board where most
   * people work from cards.
   */
  it("offers a quick look from every view, not just the table", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("app/(dash)/pipeline/page.tsx", "utf8");

    // The card the lanes and stages boards render, and the compact list the
    // simple view and every phone render.
    const cardRenders = src.match(/<PipelineCard/g)?.length ?? 0;
    expect(cardRenders).toBeGreaterThan(0);
    expect(src.match(/peekHref=\{`\$\{peekBase\}peek=\$\{o\.id\}`\}/g)?.length).toBe(
      cardRenders
    );
    expect(src).toContain("peekHrefFor={(o) => `${peekBase}peek=${o.id}`}");
    // And the table, which had it first.
    expect(src).toContain("peekBase={peekBase}");
  });
});
