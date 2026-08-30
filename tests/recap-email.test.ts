import { describe, expect, it } from "vitest";
import { renderRecapEmail, renderRecapText } from "@/lib/domain/recap/email";
import { buildRecap } from "@/lib/domain/recap/sections";
import { DEFAULT_RECAP_SETTINGS } from "@/lib/domain/recap/types";
import { emptyFacts } from "./helpers/recap-facts";

const NOW = new Date("2026-08-30T13:00:00Z");
const APP = "https://app.example.com";

function ctx(over: Record<string, unknown> = {}) {
  return {
    scope: "org" as const,
    localDate: "2026-08-29",
    timezone: "America/Denver",
    dayLabel: "Saturday, August 29",
    now: NOW,
    ages: {} as Record<string, number>,
    partial: false,
    ...over,
  };
}

const busy = () =>
  buildRecap(
    emptyFacts({
      totals: { outreachSent: 9, repliesReceived: 3, bidsSubmitted: 1 },
      deadlines: [
        {
          id: "opp-1",
          title: "Roof replacement, Building 12",
          agency: "GSA",
          deadline: new Date(NOW.getTime() + 5 * 3600_000).toISOString(),
          stage: "bidding",
          status: "open",
          submitted: false,
          quotesIn: 0,
        },
      ],
      reviewQueue: [{ id: "opp-2", title: "Paving", score: 68, tier: "B", expiresAt: null }],
      problems: [
        {
          key: "agent:scoring-engine",
          title: "Scoring stopped",
          detail: "credit balance too low",
          count: 4,
          lastAt: NOW.toISOString(),
          severity: "critical",
        },
      ],
    }),
    DEFAULT_RECAP_SETTINGS,
    ctx()
  );

describe("the recap email", () => {
  it("leads with the urgent count, in the subject and at the top of the body", () => {
    const recap = busy();
    const out = renderRecapEmail(recap, { appUrl: APP, orgName: "Test Contracting" });
    expect(out.subject).toContain("attention");

    const urgentAt = out.html.indexOf("attention");
    const totalsAt = out.html.indexOf("Key activity totals");
    expect(urgentAt).toBeGreaterThan(-1);
    expect(totalsAt).toBeGreaterThan(-1);
    expect(urgentAt).toBeLessThan(totalsAt);
  });

  it("makes every link absolute, because a mail client has no site to be relative to", () => {
    const out = renderRecapEmail(busy(), { appUrl: APP, orgName: "Test Contracting" });
    const hrefs = [...out.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(3);
    for (const href of hrefs) {
      expect(href.startsWith("http") || href.startsWith("mailto:")).toBe(true);
    }
    expect(hrefs.some((h) => h.startsWith(`${APP}/opportunity/opp-1`))).toBe(true);
    expect(hrefs.some((h) => h === `${APP}/recap?date=2026-08-29`)).toBe(true);
  });

  it("says urgency in words, not only in colour", () => {
    const out = renderRecapEmail(busy(), { appUrl: APP });
    // The tag beside a critical item is readable with styles stripped.
    expect(out.html).toContain("Deadline is close");
    expect(out.text).toContain("[Deadline is close]");
  });

  it("ships a plain-text alternative carrying the same items and links", () => {
    const recap = busy();
    const out = renderRecapEmail(recap, { appUrl: APP, orgName: "Test Contracting" });
    expect(out.text).toContain("Roof replacement, Building 12");
    expect(out.text).toContain(`${APP}/opportunity/opp-1`);
    expect(out.text).toContain("URGENT ATTENTION REQUIRED");
    expect(out.text).toContain("Scoring stopped");
    expect(out.text).not.toContain("<table");
  });

  it("names the zone the day was measured in", () => {
    const out = renderRecapEmail(busy(), { appUrl: APP });
    expect(out.html).toContain("America/Denver");
    expect(out.text).toContain("America/Denver");
  });

  it("offers a way out in every copy", () => {
    const out = renderRecapEmail(busy(), { appUrl: APP });
    expect(out.html).toContain(`${APP}/settings/account`);
    expect(out.text).toContain(`${APP}/settings/account`);
  });

  it("renders as a table-based document a mail client will not reflow", () => {
    const out = renderRecapEmail(busy(), { appUrl: APP });
    expect(out.html.toLowerCase().startsWith("<!doctype html")).toBe(true);
    expect(out.html).toContain("<table");
    // Layout by flexbox or grid is what breaks in Outlook.
    expect(out.html).not.toMatch(/display:\s*(flex|grid)/);
  });

  it("uses the same section titles in the mail as the app", () => {
    const recap = busy();
    const out = renderRecapEmail(recap, { appUrl: APP });
    for (const section of recap.sections) {
      expect(out.html).toContain(section.title);
    }
  });
});

describe("the quiet variant", () => {
  const quiet = () => buildRecap(emptyFacts(), DEFAULT_RECAP_SETTINGS, ctx());

  it("is short, says plainly that nothing happened, and still links to the page", () => {
    const recap = quiet();
    expect(recap.quiet).toBe(true);
    const out = renderRecapEmail(recap, { appUrl: APP, orgName: "Test Contracting" });
    expect(out.subject).toContain("a quiet day");
    expect(out.html).toContain("Nothing needed you");
    expect(out.html).toContain(`${APP}/recap?date=2026-08-29`);
    // Materially shorter than the full version: no eight sections.
    expect(out.html.length).toBeLessThan(
      renderRecapEmail(busy(), { appUrl: APP }).html.length / 2
    );
    expect(out.text.split("\n").length).toBeLessThan(12);
  });
});

describe("the marked variants", () => {
  it("marks a test send so nobody acts on a rehearsal", () => {
    const out = renderRecapEmail(busy(), { appUrl: APP, test: true });
    expect(out.subject.startsWith("[Test] ")).toBe(true);
    expect(out.html).toContain("Test send.");
    expect(out.text).toContain("[TEST SEND]");
  });

  it("explains itself when it arrives late instead of looking unreliable", () => {
    const out = renderRecapEmail(busy(), { appUrl: APP, late: true });
    expect(out.html).toContain("Sent late.");
    expect(out.text).toContain("[SENT LATE]");
    // The day covered does not change just because delivery slipped.
    expect(out.html).toContain("Saturday, August 29");
  });

  it("greets a named recipient and copes with an unnamed one", () => {
    expect(renderRecapEmail(busy(), { appUrl: APP, recipientName: "Jared" }).html).toContain(
      "Good morning, Jared."
    );
    expect(renderRecapEmail(busy(), { appUrl: APP }).html).toContain("Good morning.");
  });
});

describe("escaping", () => {
  it("does not let a record's own text become markup", () => {
    const recap = buildRecap(
      emptyFacts({
        reviewQueue: [
          {
            id: "opp-x",
            title: `<script>alert("x")</script> & Sons`,
            score: null,
            tier: null,
            expiresAt: null,
          },
        ],
      }),
      DEFAULT_RECAP_SETTINGS,
      ctx()
    );
    const out = renderRecapEmail(recap, { appUrl: APP });
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
    // The plain-text copy keeps it readable rather than escaped.
    expect(renderRecapText(recap, { appUrl: APP })).toContain("& Sons");
  });
});
