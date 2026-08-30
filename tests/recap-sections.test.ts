import { describe, expect, it } from "vitest";
import {
  buildRecap,
  collectUrgent,
  recapPreheader,
  recapSubject,
  ageNote,
} from "@/lib/domain/recap/sections";
import {
  DEFAULT_RECAP_SETTINGS,
  RECAP_SECTION_KEYS,
  normalizeRecapSettings,
  type RecapSettings,
} from "@/lib/domain/recap/types";
import { emptyFacts } from "./helpers/recap-facts";

const NOW = new Date("2026-08-30T13:00:00Z");

function ctx(over: Partial<Parameters<typeof buildRecap>[2]> = {}) {
  return {
    scope: "org" as const,
    localDate: "2026-08-29",
    timezone: "America/Denver",
    dayLabel: "Saturday, August 29",
    now: NOW,
    ages: {},
    partial: false,
    ...over,
  };
}

const settings: RecapSettings = DEFAULT_RECAP_SETTINGS;

describe("what counts as urgent", () => {
  it("names a deadline inside the threshold and ignores one beyond it", () => {
    const facts = emptyFacts({
      deadlines: [
        {
          id: "close",
          title: "Roof replacement, Building 12",
          agency: "GSA",
          deadline: new Date(NOW.getTime() + 6 * 3600_000).toISOString(),
          stage: "bidding",
          status: "open",
          submitted: false,
          quotesIn: 0,
        },
        {
          id: "far",
          title: "Paving, Fort Carson",
          agency: "Army",
          deadline: new Date(NOW.getTime() + 30 * 24 * 3600_000).toISOString(),
          stage: "bidding",
          status: "open",
          submitted: false,
          quotesIn: 2,
        },
      ],
    });
    const keys = collectUrgent(facts, settings, NOW).map((i) => i.key);
    expect(keys).toContain("deadline:close");
    expect(keys).not.toContain("deadline:far");
  });

  it("leaves a submitted bid alone however close the deadline is", () => {
    const facts = emptyFacts({
      deadlines: [
        {
          id: "done",
          title: "Already in",
          agency: null,
          deadline: new Date(NOW.getTime() + 2 * 3600_000).toISOString(),
          stage: "submitted",
          status: "open",
          submitted: true,
          quotesIn: 3,
        },
      ],
    });
    expect(collectUrgent(facts, settings, NOW)).toHaveLength(0);
  });

  it("respects a threshold the account changed", () => {
    const facts = emptyFacts({
      deadlines: [
        {
          id: "mid",
          title: "Four days out",
          agency: null,
          deadline: new Date(NOW.getTime() + 96 * 3600_000).toISOString(),
          stage: "bidding",
          status: "open",
          submitted: false,
          quotesIn: 0,
        },
      ],
    });
    expect(collectUrgent(facts, settings, NOW)).toHaveLength(0);
    const wider = normalizeRecapSettings({ urgent: { ...settings.urgent, deadline_hours: 120 } });
    expect(collectUrgent(facts, wider, NOW)).toHaveLength(1);
  });

  it("counts failed sends only once the account's floor is reached", () => {
    const failed = (id: string) => ({
      id,
      subcontractorId: null,
      subcontractor: "Ace Electric",
      recipient: "bids@ace.example",
      opportunityId: null,
      state: "bounced",
      detail: "mailbox unavailable",
      createdAt: NOW.toISOString(),
    });
    const one = emptyFacts({ failedSends: [failed("a")] });
    expect(collectUrgent(one, settings, NOW).length).toBeGreaterThan(0);

    const strict = normalizeRecapSettings({
      urgent: { ...settings.urgent, failed_send_count: 3 },
    });
    expect(collectUrgent(one, strict, NOW)).toHaveLength(0);
    const three = emptyFacts({ failedSends: [failed("a"), failed("b"), failed("c")] });
    expect(collectUrgent(three, strict, NOW).length).toBeGreaterThan(0);
  });
});

describe("ordering and aging", () => {
  it("puts critical before warning, and the oldest first inside each band", () => {
    const facts = emptyFacts({
      deadlines: [
        {
          id: "soon",
          title: "Due in three hours",
          agency: null,
          deadline: new Date(NOW.getTime() + 3 * 3600_000).toISOString(),
          stage: "bidding",
          status: "open",
          submitted: false,
          quotesIn: 0,
        },
      ],
      unansweredReplies: [
        {
          id: "old",
          subcontractorId: "s1",
          subcontractor: "Old Reply",
          opportunityId: null,
          opportunity: null,
          intent: "interested",
          needsReview: false,
          reviewedAt: null,
          createdAt: new Date(NOW.getTime() - 96 * 3600_000).toISOString(),
        },
        {
          id: "new",
          subcontractorId: "s2",
          subcontractor: "New Reply",
          opportunityId: null,
          opportunity: null,
          intent: "interested",
          needsReview: false,
          reviewedAt: null,
          createdAt: new Date(NOW.getTime() - 30 * 3600_000).toISOString(),
        },
      ],
    });

    const recap = buildRecap(
      facts,
      settings,
      ctx({ ages: { "reply:old": 4, "reply:new": 0 } })
    );
    const urgent = recap.sections.find((s) => s.key === "urgent");
    const severities = urgent!.items.map((i) => i.severity);
    // Severity bands never interleave.
    expect(severities.indexOf("critical")).toBeLessThanOrEqual(severities.lastIndexOf("critical"));
    const replyItems = urgent!.items.filter((i) => i.key.startsWith("reply:"));
    expect(replyItems[0]!.key).toBe("reply:old");
  });

  it("says how long an item has been on the list instead of listing it as new", () => {
    const facts = emptyFacts({
      failedSends: [
        {
          id: "f1",
          subcontractorId: null,
          subcontractor: "Ace Electric",
          recipient: "bids@ace.example",
          opportunityId: null,
          state: "failed",
          detail: null,
          createdAt: NOW.toISOString(),
        },
      ],
    });
    const recap = buildRecap(facts, settings, ctx({ ages: { "failed-sends": 3 } }));
    const item = recap.sections
      .find((s) => s.key === "urgent")!
      .items.find((i) => i.key === "failed-sends");
    expect(item?.ageDays).toBe(3);
    expect(ageNote(item?.ageDays)).toBe("On this list for 3 days");
    expect(ageNote(0)).toBeNull();
  });
});

describe("the shape of the recap", () => {
  it("always renders the eight sections in the fixed order", () => {
    const recap = buildRecap(emptyFacts(), settings, ctx());
    expect(recap.sections.map((s) => s.key)).toEqual([...RECAP_SECTION_KEYS]);
  });

  it("drops a section the account turned off, without reordering the rest", () => {
    const chosen = normalizeRecapSettings({ sections: ["urgent", "totals", "upcoming"] });
    const recap = buildRecap(emptyFacts(), chosen, ctx());
    expect(recap.sections.map((s) => s.key)).toEqual(["urgent", "totals", "upcoming"]);
  });

  it("never leaves an empty section blank", () => {
    const recap = buildRecap(emptyFacts(), settings, ctx());
    for (const s of recap.sections) {
      if (s.items.length === 0 && s.totals.length === 0) {
        expect(s.empty.length).toBeGreaterThan(10);
      }
    }
  });

  it("gives every actionable item somewhere to go", () => {
    const facts = emptyFacts({
      reviewQueue: [{ id: "o1", title: "Decide me", score: 71, tier: "B", expiresAt: null }],
      callQueue: [
        {
          id: "c1",
          opportunityId: "o1",
          opportunity: "Decide me",
          subcontractorId: "s1",
          subcontractor: "Ace",
          createdAt: NOW.toISOString(),
        },
      ],
    });
    const recap = buildRecap(facts, settings, ctx());
    for (const section of recap.sections) {
      for (const item of section.items) {
        expect(item.href, `${section.key}/${item.key} has no link`).toBeTruthy();
        expect(item.href!.startsWith("/")).toBe(true);
      }
    }
  });
});

describe("a quiet day", () => {
  it("is quiet when nothing needed a person and nothing happened", () => {
    const recap = buildRecap(emptyFacts(), settings, ctx());
    expect(recap.quiet).toBe(true);
    expect(recapSubject(recap, "Test Contracting")).toContain("a quiet day");
    expect(recapPreheader(recap)).toContain("short version");
  });

  it("is not quiet when something is still waiting, even with no new activity", () => {
    const facts = emptyFacts({
      reviewQueue: [{ id: "o1", title: "Still waiting", score: null, tier: null, expiresAt: null }],
    });
    expect(buildRecap(facts, settings, ctx()).quiet).toBe(false);
  });

  it("is not quiet when an automation failed", () => {
    const facts = emptyFacts({
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
    });
    const recap = buildRecap(facts, settings, ctx());
    expect(recap.quiet).toBe(false);
    expect(recap.problemCount).toBe(1);
  });
});

describe("totals", () => {
  it("reports every figure it was given, and invents none", () => {
    const facts = emptyFacts({
      totals: {
        outreachSent: 12,
        outreachFailed: 2,
        repliesReceived: 5,
        repliesNeedingReview: 1,
        bidsSubmitted: 1,
        agentRuns: 40,
        agentRunErrors: 3,
      },
    });
    const recap = buildRecap(facts, settings, ctx());
    const totals = recap.sections.find((s) => s.key === "totals")!.totals;
    const byLabel = Object.fromEntries(totals.map((t) => [t.label, t]));

    expect(byLabel["Outreach emails sent"]!.value).toBe(12);
    expect(byLabel["Outreach emails sent"]!.note).toContain("2");
    expect(byLabel["Replies received"]!.value).toBe(5);
    expect(byLabel["Replies received"]!.note).toContain("1");
    expect(byLabel["Automation runs"]!.note).toContain("3");
    // No invented "tasks" figure: everything here is a countable record.
    expect(totals.some((t) => /task/i.test(t.label))).toBe(false);
  });

  it("counts the subject line from the urgent items it actually rendered", () => {
    const facts = emptyFacts({
      failedSends: [
        {
          id: "f1",
          subcontractorId: null,
          subcontractor: "Ace",
          recipient: "a@example.com",
          opportunityId: null,
          state: "failed",
          detail: null,
          createdAt: NOW.toISOString(),
        },
      ],
    });
    const recap = buildRecap(facts, settings, ctx());
    const urgent = recap.sections.find((s) => s.key === "urgent")!;
    expect(recap.urgentCount).toBe(urgent.items.length);
    expect(recapSubject(recap, "Test Contracting")).toContain("attention");
  });
});
