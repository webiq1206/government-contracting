import { describe, it, expect } from "vitest";
import { buildActivityTimeline } from "../lib/domain/activity-timeline";

describe("buildActivityTimeline", () => {
  it("merges agent logs and communications newest first", () => {
    const events = buildActivityTimeline({
      logs: [
        {
          agent: "outreach",
          action: "send",
          message: "Email sent",
          created_at: "2026-08-10T10:00:00.000Z",
        },
        {
          agent: "operator",
          action: "call-logged",
          message: "Call completed",
          created_at: "2026-08-11T12:00:00.000Z",
        },
      ],
      communications: [
        {
          id: "c1",
          channel: "email",
          direction: "outbound",
          subject: "Quote request",
          body: "Hi there",
          created_at: "2026-08-10T10:05:00.000Z",
        },
      ],
    });
    expect(events[0].kind).toBe("human");
    expect(events[0].title).toContain("call-logged");
    expect(events.some((e) => e.kind === "email")).toBe(true);
    expect(events.some((e) => e.kind === "system")).toBe(true);
  });

  it("credits outbound notes and calls to the person, email to the platform", () => {
    const events = buildActivityTimeline({
      communications: [
        {
          id: "n1",
          channel: "note",
          direction: "outbound",
          subject: "Note",
          body: "Spoke at the site walk",
          created_at: "2026-08-12T09:00:00.000Z",
        },
        {
          id: "k1",
          channel: "call",
          direction: "outbound",
          subject: "Call logged",
          body: "They can start in March",
          created_at: "2026-08-12T10:00:00.000Z",
        },
        {
          id: "e1",
          channel: "email",
          direction: "outbound",
          subject: "Quote request",
          created_at: "2026-08-12T11:00:00.000Z",
        },
        {
          id: "e2",
          channel: "email",
          direction: "inbound",
          subject: "Re: Quote request",
          created_at: "2026-08-12T12:00:00.000Z",
        },
      ],
    });
    const byId = new Map(events.map((e) => [e.id, e]));
    expect(byId.get("comm-n1")?.actor).toBe("You");
    expect(byId.get("comm-k1")?.actor).toBe("You");
    expect(byId.get("comm-e1")?.actor).toBe("Brost Co");
    expect(byId.get("comm-e2")?.actor).toBe("Subcontractor");
  });

  it("respects the limit", () => {
    const events = buildActivityTimeline({
      logs: Array.from({ length: 10 }, (_, i) => ({
        agent: "system",
        action: `a${i}`,
        created_at: `2026-08-0${(i % 9) + 1}T00:00:00.000Z`,
      })),
      limit: 3,
    });
    expect(events).toHaveLength(3);
  });
});

/**
 * The audit's finding, as a test: an opportunity page saying "No activity"
 * while emails, quotes, files and calls plainly exist. An empty panel is
 * fine; a panel asserting that nothing happened, over a record that has a
 * price on it, teaches the operator not to believe the page.
 */
describe("the record is more than logs and emails", () => {
  it("carries a quote, which is the most consequential event there is", () => {
    const events = buildActivityTimeline({
      quotes: [
        {
          id: "q1",
          company_name: "Rivera Mechanical",
          trade: "HVAC",
          quote_amount: 121951.22,
          created_at: "2026-08-20T10:00:00Z",
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("quote");
    expect(events[0].title).toBe("Quote from Rivera Mechanical for HVAC");
    expect(events[0].detail).toBe("$121,951.22");
  });

  it("tells a file we fetched apart from one a person uploaded", () => {
    const events = buildActivityTimeline({
      documents: [
        { id: "d1", filename: "amendment-2.pdf", source: "sam", created_at: "2026-08-19T09:00:00Z" },
        { id: "d2", filename: "our-w9.pdf", source: "upload", created_at: "2026-08-19T10:00:00Z" },
      ],
    });
    expect(events.map((e) => e.title)).toEqual([
      "Uploaded our-w9.pdf",
      "Attached amendment-2.pdf",
    ]);
    expect(events.map((e) => e.actor)).toEqual(["You", "Brost Co"]);
  });

  it("records calls, prepared and completed, distinctly", () => {
    const events = buildActivityTimeline({
      calls: [
        { id: "c1", company_name: "Delta Electric", trade: "electrical", status: "done", created_at: "2026-08-18T12:00:00Z" },
        { id: "c2", company_name: "Peak Roofing", status: "pending", created_at: "2026-08-18T11:00:00Z" },
      ],
    });
    expect(events[0].title).toBe("Called Delta Electric about electrical");
    expect(events[1].title).toBe("Call prepared for Peak Roofing");
  });

  it("merges every source into one feed, newest first", () => {
    const events = buildActivityTimeline({
      logs: [{ agent: "scoring-engine", action: "score", created_at: "2026-08-17T08:00:00Z" }],
      communications: [
        { id: "m1", channel: "email", direction: "outbound", subject: "Quote request", created_at: "2026-08-18T08:00:00Z" },
      ],
      quotes: [{ id: "q1", company_name: "Rivera", quote_amount: 1000, created_at: "2026-08-20T08:00:00Z" }],
      documents: [{ id: "d1", filename: "sow.pdf", created_at: "2026-08-19T08:00:00Z" }],
      calls: [{ id: "c1", company_name: "Delta", status: "done", created_at: "2026-08-21T08:00:00Z" }],
    });
    expect(events.map((e) => e.kind)).toEqual([
      "call",
      "quote",
      "document",
      "email",
      "system",
    ]);
  });
});

describe("timestamps from the database", () => {
  /*
   * node-postgres returns a Date for a timestamptz, and every row fed to this
   * builder comes straight from a query. The string-only check that used to
   * guard these dropped every event, so a record with a hundred emails on it
   * rendered "No activity yet" -- not an empty state but a false statement,
   * and invisible because the failure mode of a timeline is silence.
   */
  const when = new Date("2026-08-26T09:30:00.000Z");

  it("accepts a Date on a log line", () => {
    const events = buildActivityTimeline({
      logs: [{ agent: "scoring-engine", action: "scored", created_at: when }],
    });
    expect(events).toHaveLength(1);
    expect(events[0].at).toBe(when.toISOString());
  });

  it("accepts a Date on every source", () => {
    const events = buildActivityTimeline({
      logs: [{ agent: "operator", action: "note", created_at: when }],
      communications: [{ channel: "email", direction: "outbound", subject: "Quote request", created_at: when }],
      quotes: [{ company_name: "Acme", trade: "electrical", quote_amount: 1000, created_at: when }],
      documents: [{ filename: "sow.pdf", doc_type: "solicitation", created_at: when }],
      calls: [{ company_name: "Acme", created_at: when }],
    });
    expect(events.length).toBeGreaterThanOrEqual(5);
    for (const e of events) expect(e.at).toBe(when.toISOString());
  });

  it("still accepts an ISO string", () => {
    const events = buildActivityTimeline({
      logs: [{ agent: "scoring-engine", action: "scored", created_at: when.toISOString() }],
    });
    expect(events[0].at).toBe(when.toISOString());
  });

  it("drops a row with no usable date rather than dating it to the epoch", () => {
    const events = buildActivityTimeline({
      logs: [
        { agent: "a", action: "x", created_at: null },
        { agent: "b", action: "y", created_at: new Date("nonsense") },
        { agent: "c", action: "z", created_at: 1234 },
      ],
    });
    expect(events).toHaveLength(0);
  });
});
