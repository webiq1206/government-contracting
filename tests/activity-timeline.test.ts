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
