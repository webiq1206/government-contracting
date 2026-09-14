/**
 * Connected apps: the parts that decide what a person is told and whether
 * the same thing is sent twice.
 */
import { describe, it, expect } from "vitest";
import {
  SERVICE_DEFS,
  providerAvailable,
  syncLine,
  eventKeyFor,
  notificationText,
  signWebhook,
  verifyWebhookSignature,
  nextRetryAt,
  deadlineEvent,
  folderName,
  NOTIFY_EVENTS,
} from "@/lib/domain/connected-services";
import { acceptableWebhookUrl } from "@/lib/integrations/team-notify";
import { acceptableWebhookTarget } from "@/lib/webhooks";

describe("provider definitions", () => {
  it("say what every provider reads, writes and which way it flows", () => {
    for (const d of SERVICE_DEFS) {
      expect(d.lets.length).toBeGreaterThan(20);
      expect(d.reads.length).toBeGreaterThan(5);
      expect(d.writes.length).toBeGreaterThan(10);
      expect(d.direction).toMatch(/One-way|Two-way/);
    }
  });
  it("offer a provider only when the platform holds its app credentials", () => {
    const google = SERVICE_DEFS.find((d) => d.id === "google_calendar")!;
    expect(providerAvailable(google, {})).toBe(false);
    expect(providerAvailable(google, { GMAIL_CLIENT_ID: "a", GMAIL_CLIENT_SECRET: "b" })).toBe(true);
    const teams = SERVICE_DEFS.find((d) => d.id === "teams")!;
    expect(providerAvailable(teams, {})).toBe(true);
  });
});

describe("status line", () => {
  it("never calls a paused or broken connection connected", () => {
    expect(syncLine({ status: "paused", last_synced_at: null, last_error: null })).toMatch(/Paused/);
    expect(syncLine({ status: "needs_attention", last_synced_at: null, last_error: "Token revoked" })).toBe("Token revoked");
    expect(syncLine({ status: "disconnected", last_synced_at: null, last_error: null })).toMatch(/Disconnected/);
    expect(syncLine({ status: "connected", last_synced_at: null, last_error: null })).toMatch(/Nothing has needed syncing/);
  });
});

describe("notifications", () => {
  it("maps ledger rows to the subscriptions people choose from", () => {
    const base = { id: 1, status: "ok", actor: "system", occurred_at: "2026-09-14T00:00:00Z", opportunity_id: null, detail: null };
    expect(eventKeyFor({ ...base, category: "reply", title: "Reply from Acme" })).toBe("reply");
    expect(eventKeyFor({ ...base, category: "opportunity", title: "Deadline in 2 days" })).toBe("deadline");
    expect(eventKeyFor({ ...base, category: "opportunity", title: "New opportunity scored" })).toBe("opportunity");
    expect(eventKeyFor({ ...base, category: "email", title: "Outreach sent" })).toBeNull();
    for (const e of NOTIFY_EVENTS) expect(e.hint.length).toBeGreaterThan(10);
  });
  it("links the record in the message", () => {
    const t = notificationText({ id: 1, category: "reply", status: "ok", title: "Reply from Acme", actor: "system", occurred_at: "", opportunity_id: "abc", detail: null }, "https://x.test");
    expect(t).toBe("Reply from Acme https://x.test/opportunity/abc");
  });
});

describe("webhooks", () => {
  it("signs and verifies a body with the timestamp bound in", () => {
    const sig = signWebhook("s", "100", "{}");
    expect(verifyWebhookSignature("s", "100", "{}", sig)).toBe(true);
    expect(verifyWebhookSignature("s", "101", "{}", sig)).toBe(false);
    expect(verifyWebhookSignature("t", "100", "{}", sig)).toBe(false);
  });
  it("backs off and eventually gives up", () => {
    const now = new Date("2026-09-14T00:00:00Z");
    expect(nextRetryAt(1, now)?.toISOString()).toBe("2026-09-14T00:01:00.000Z");
    expect(nextRetryAt(5, now)?.toISOString()).toBe("2026-09-14T12:00:00.000Z");
    expect(nextRetryAt(6, now)).toBeNull();
  });
  it("accepts only https targets, and only real channel hosts for Slack and Teams", () => {
    expect(acceptableWebhookTarget("https://hooks.zapier.com/hooks/catch/1/abc")).toBe(true);
    expect(acceptableWebhookTarget("http://hooks.zapier.com/x")).toBe(false);
    expect(acceptableWebhookUrl("slack", "https://hooks.slack.com/services/T/B/x")).toBe(true);
    expect(acceptableWebhookUrl("slack", "https://example.com/hook")).toBe(false);
    expect(acceptableWebhookUrl("teams", "https://prod-12.westus.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke")).toBe(true);
    expect(acceptableWebhookUrl("teams", "https://example.com/hook")).toBe(false);
  });
});

describe("calendar events", () => {
  const opp = { id: "o1", title: "Roof repairs", agency: "USACE", solicitation_number: "W912-26", deadline: "2026-10-01T18:00:00Z", stage: "outreach", status: "open", pursuit_state: "active" };
  it("builds one event per deadline with a fingerprint that changes only when the event would", () => {
    const a = deadlineEvent(opp, "https://x.test");
    expect(a.localKey).toBe("opportunity:o1:deadline");
    expect(a.summary).toBe("Bid due: Roof repairs");
    expect(a.description).toContain("https://x.test/opportunity/o1");
    expect(a.cancelled).toBe(false);
    const same = deadlineEvent({ ...opp, stage: "bid_building" }, "https://x.test");
    expect(same.fingerprint).toBe(a.fingerprint);
    const moved = deadlineEvent({ ...opp, deadline: "2026-10-02T18:00:00Z" }, "https://x.test");
    expect(moved.fingerprint).not.toBe(a.fingerprint);
  });
  it("cancels the event when the bid is passed, aborted or closed", () => {
    expect(deadlineEvent({ ...opp, stage: "dismissed", status: "archived" }, "u").cancelled).toBe(true);
    expect(deadlineEvent({ ...opp, pursuit_state: "aborted" }, "u").cancelled).toBe(true);
  });
  it("names folders safely", () => {
    expect(folderName({ title: 'Roof / "Main" Library', solicitation_number: "RFQ:26" })).toBe("RFQ 26 Roof Main Library");
  });
});
