import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  opportunityQuickView,
  type OpportunityQuickFacts,
} from "../lib/domain/quick-view";

/**
 * The drawer, as it actually draws.
 *
 * Two things are worth protecting here. The first is that a section with
 * nothing in it never reaches the screen, because the omission is the whole
 * reason the contract exists. The second is parity: the controls pinned at
 * the foot of the drawer are built by the same function the row calls, so the
 * same person looking at the same record is offered the same things whether
 * they act from the list or from the drawer. A drawer that quietly offered
 * less would send somebody back to the record page for a button they had
 * already been shown once.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

const { QuickViewDrawer } = await import("../components/quick-view");
const { RowActions } = await import("../components/row-actions");
const { opportunityRowActions } = await import("../lib/domain/row-actions");

const NOW = new Date("2026-03-10T17:00:00Z");
const ID = "11111111-1111-4111-8111-111111111111";
const viewer = { role: "owner" };

function facts(over: Partial<OpportunityQuickFacts> = {}): OpportunityQuickFacts {
  return {
    id: ID,
    title: "Fort Carson roofing",
    agency: "Department of the Army",
    stage: "call_queue",
    deadline: "2026-03-20T17:00:00Z",
    requiredTrades: ["Roofing"],
    tradesRequired: 2,
    tradesCovered: 1,
    quoteCount: 1,
    subsContacted: 4,
    subsResponded: 2,
    bidSubmitted: false,
    outcome: null,
    riskFlags: [],
    attachments: [],
    messages: [],
    ...over,
  };
}

function drawer(over: Partial<OpportunityQuickFacts> = {}) {
  const f = facts(over);
  return renderToStaticMarkup(
    <QuickViewDrawer
      view={opportunityQuickView(f, NOW)}
      closeHref="/pipeline"
      actions={opportunityRowActions(
        { id: f.id, title: f.title, stage: f.stage },
        viewer
      )}
    />
  );
}

describe("the drawer and the row it was opened from", () => {
  it("offer the same person the same actions on the same record", () => {
    const row = renderToStaticMarkup(
      <RowActions
        actions={opportunityRowActions(
          { id: ID, title: "Fort Carson roofing", stage: "call_queue" },
          viewer
        )}
        recordLabel="Fort Carson roofing"
      />
    );
    const inDrawer = drawer();
    // The primary control, by its label rather than its markup: the two are
    // laid out differently and that is allowed. What they offer is not.
    const labels = ["Enter a quote", "Snooze", "Pass on it"];
    for (const label of labels) {
      expect(row.includes(label)).toBe(inDrawer.includes(label));
    }
  });

  it("shows nothing where a reader with no permissions would get nothing", () => {
    const f = facts();
    const html = renderToStaticMarkup(
      <QuickViewDrawer
        view={opportunityQuickView(f, NOW)}
        closeHref="/pipeline"
        actions={opportunityRowActions(
          { id: f.id, title: f.title, stage: f.stage },
          { role: "viewer" }
        )}
      />
    );
    expect(html).not.toContain('aria-haspopup="menu"');
    expect(html).toContain("Open the workspace");
  });
});

describe("what the drawer draws", () => {
  it("leads with the recommendation and always offers the full record", () => {
    const html = drawer();
    expect(html).toContain("Do next");
    expect(html).toContain("Open the workspace");
    expect(html).toContain(`/opportunity/${ID}`);
  });

  it("draws no heading for a section the record cannot fill", () => {
    const bare = drawer({
      agency: null,
      naics: null,
      setAside: null,
      place: null,
      value: null,
      requiredTrades: [],
      tradesRequired: 0,
      tradesCovered: 0,
      quoteCount: 0,
      subsContacted: 0,
      subsResponded: 0,
      stage: "scoring",
    });
    expect(bare).not.toContain("The solicitation");
    expect(bare).not.toContain("Progress");
    expect(bare).toContain("Where it stands");
  });

  it("says what is in the way before the facts behind it", () => {
    const html = drawer({ riskFlags: ["sam_registration_expired"] });
    expect(html).toContain("In the way");
    expect(html.indexOf("In the way")).toBeLessThan(html.indexOf("Where it stands"));
  });

  it("shows the latest messages and leaves the section out when there are none", () => {
    expect(drawer()).not.toContain("Latest messages");
    const withMail = drawer({
      messages: [
        {
          id: "m1",
          direction: "in",
          at: "2026-03-09T16:00:00Z",
          who: "Peak Mechanical",
          subject: "Re: Fort Carson roofing",
          preview: "We can price the roofing scope by Thursday.",
        },
      ],
    });
    expect(withMail).toContain("Latest messages");
    expect(withMail).toContain("Peak Mechanical");
    expect(withMail).toContain("price the roofing scope");
  });

  it("opens a solicitation attachment in its own tab so the list survives", () => {
    const html = drawer({
      attachments: [{ name: "Wage determination.pdf", href: "https://sam.gov/wd.pdf" }],
    });
    expect(html).toContain("Attachments");
    expect(html).toContain('target="_blank"');
    expect(html).toContain("Wage determination.pdf");
  });

  it("walks the list from the drawer when there is one either side", () => {
    const f = facts();
    const html = renderToStaticMarkup(
      <QuickViewDrawer
        view={opportunityQuickView(f, NOW)}
        closeHref="/pipeline"
        nav={{
          prevHref: "/pipeline?peek=a",
          nextHref: "/pipeline?peek=b",
          index: 3,
          total: 12,
        }}
      />
    );
    expect(html).toContain("/pipeline?peek=a");
    expect(html).toContain("/pipeline?peek=b");
    expect(html).toContain("12");
  });
});

describe("the compact list every phone gets", () => {
  it("offers a quick look only where the page hosting it has a drawer", async () => {
    const { OpportunityList } = await import("../components/opportunity-list");
    const row = {
      id: ID,
      title: "Fort Carson roofing",
      stage: "call_queue",
      status: "active",
      score: 78,
      agency: "Department of the Army",
      deadline: "2026-03-20T17:00:00Z",
    } as never;
    const props = {
      rows: [row],
      coverage: new Map(),
      owners: new Map(),
      role: "owner",
    };

    const withDrawer = renderToStaticMarkup(
      <OpportunityList {...props} peekHrefFor={() => `/pipeline?view=lanes&peek=${ID}`} />
    );
    expect(withDrawer).toContain("Quick look");
    expect(withDrawer).toContain(`/pipeline?view=lanes&amp;peek=${ID}`);

    const without = renderToStaticMarkup(<OpportunityList {...props} />);
    expect(without).not.toContain("Quick look");
  });
});
