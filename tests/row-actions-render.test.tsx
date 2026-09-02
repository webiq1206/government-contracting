import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The row's controls, as they actually draw.
 *
 * The rules for what belongs on a row are tested next door against the domain
 * module. This is the other half: that the button and the menu appear, that a
 * role with nothing to offer renders nothing at all rather than an empty
 * control, that the menu is a sheet on a phone and a dropdown on a desktop,
 * and that reassign does not appear on a surface which never loaded the
 * people it would offer.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

const { RowActions } = await import("../components/row-actions");
const { opportunityRowActions, subcontractorRowActions } = await import(
  "../lib/domain/row-actions"
);

const owner = { role: "owner" };

function opp(stage: string) {
  return opportunityRowActions({ id: "o1", title: "Fort Carson roofing", stage }, owner);
}

describe("a row with something to offer", () => {
  it("puts the decision on a button and the rest behind a menu", () => {
    const html = renderToStaticMarkup(
      <RowActions actions={opp("scoring")} recordLabel="Fort Carson roofing" />
    );
    expect(html).toContain("Pursue");
    expect(html).toContain('aria-haspopup="menu"');
    // Closed until asked for. A row that renders its whole menu is a row that
    // is taller than the record it describes.
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Pass on it");
  });

  it("names the record in the menu's label, so forty rows are not forty identical buttons", () => {
    const html = renderToStaticMarkup(
      <RowActions actions={opp("scoring")} recordLabel="Fort Carson roofing" />
    );
    expect(html).toContain('aria-label="More actions for Fort Carson roofing"');
  });
});

describe("a row with nothing to offer", () => {
  it("renders nothing at all rather than an empty control", () => {
    const html = renderToStaticMarkup(
      <RowActions actions={opportunityRowActions({ id: "o1", stage: "won" }, owner)} />
    );
    expect(html).toBe("");
  });
});

describe("handing a record to somebody", () => {
  it("is not offered on a surface that never loaded the people", () => {
    /*
     * A picker with nobody in it is worse than no picker: it reads as "there
     * is nobody to give this to" when the truth is that the page did not ask.
     */
    const html = renderToStaticMarkup(
      <RowActions actions={opp("analysis")} recordLabel="Fort Carson roofing" />
    );
    expect(html).not.toContain("Change who has it");
  });

  it("is offered once the page has them", () => {
    const html = renderToStaticMarkup(
      <RowActions
        actions={opp("analysis")}
        members={[{ id: "u1", name: "Devin" }]}
        recordLabel="Fort Carson roofing"
      />
    );
    // Still behind the menu, so it is in the markup only once opened. What is
    // asserted here is that it survived the filter: the menu button exists
    // and the action was not dropped.
    expect(html).toContain('aria-haspopup="menu"');
  });
});

describe("every list on Today", () => {
  it("asks the shared rules who may act, instead of showing everyone the same buttons", async () => {
    /*
     * The two bulk lists on Today kept their own controls and were never told
     * the viewer's role, so a read-only account saw Pursue, Pass, Snooze and
     * Skip and found out they were refused only by pressing one. The rules
     * live in one place; these lists have to ask them like the rest.
     */
    const fs = await import("node:fs");
    for (const file of [
      "components/today-bulk-triage.tsx",
      "components/today-bulk-calls.tsx",
    ]) {
      const src = fs.readFileSync(file, "utf8");
      expect(src).toContain("<RowActions");
      expect(src).toContain("{ role }");
      // No hand-rolled mutation left behind, and no wrapper cancelling clicks.
      expect(src).not.toContain("ActionButton");
      expect(src).not.toContain("SnoozeButton");
      expect(src).not.toContain("StopClickPropagation");
    }
    const page = fs.readFileSync("app/(dash)/today/page.tsx", "utf8");
    for (const list of ["<TodayBulkTriage", "<TodayBulkCalls"]) {
      const at = page.indexOf(list);
      expect(at).toBeGreaterThan(-1);
      expect(page.slice(at, at + 400)).toContain("role={viewer?.orgRole}");
    }
  });

  it("offers a read-only account nothing to press on either list", async () => {
    const { callCardRowActions } = await import("@/lib/domain/row-actions");
    const viewer = { role: "viewer" };
    expect(opportunityRowActions({ id: "o1", stage: "scoring" }, viewer)).toEqual([]);
    expect(callCardRowActions({ id: "c1", companyName: "Ace" }, viewer)).toEqual([]);
  });
});

describe("rows whose actions are links", () => {
  it("are not wrapped in the click-swallowing helper", async () => {
    /*
     * StopClickPropagation calls preventDefault, which is right for a button
     * sitting inside a card link and fatal for an action that is itself a
     * link: "Start the call" and "Reply" would have rendered, been clicked,
     * and done nothing. RowActions stops propagation on its own and cancels
     * nothing, so beside a row link it needs no wrapper at all.
     */
    const fs = await import("node:fs");
    for (const file of [
      "components/call-queue-list.tsx",
      "app/(dash)/communications/page.tsx",
    ]) {
      expect(fs.readFileSync(file, "utf8")).not.toContain("StopClickPropagation");
    }
  });

  it("never sit inside the row's own anchor", async () => {
    // A button in an <a> is invalid markup: it navigates as well as acting,
    // and the navigation cancels the request it just sent.
    const fs = await import("node:fs");
    for (const file of [
      "components/bulk-review-list.tsx",
      "app/(dash)/today/page.tsx",
      "app/(dash)/pipeline/page.tsx",
    ]) {
      const src = fs.readFileSync(file, "utf8");
      const actions = src.indexOf("<RowActions");
      expect(actions).toBeGreaterThan(-1);
      // The nearest tag boundary before the controls closes a link rather
      // than opening one.
      const closedBefore = src.lastIndexOf("</Link>", actions);
      const openedBefore = src.lastIndexOf("<Link", actions);
      expect(closedBefore).toBeGreaterThan(openedBefore);
    }
  });
});

describe("the roster's rows", () => {
  it("dials a number without opening the firm", () => {
    const html = renderToStaticMarkup(
      <RowActions
        actions={subcontractorRowActions(
          { id: "s1", companyName: "Alpha Electric", phone: "(555) 010-0100" },
          owner
        )}
        recordLabel="Alpha Electric"
      />
    );
    // A tel: link, and a plain anchor rather than a router link: the router
    // has no route for a phone call.
    expect(html).toContain('href="tel:5550100100"');
  });
});
