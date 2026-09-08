/**
 * A message written on purpose and never handed to a provider is a draft, and
 * every surface has to say so.
 *
 * Production on 2026-09-08: 140 Sources Sought responses the agent drafted
 * for a person to send, and 252 approaches the outreach agent held back for
 * firms with no verified address, all read as "Sent" on the conversation log
 * because delivery_state defaulted to 'sent' and neither writer set it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deliveryStateFor, describeDeliveryState } from "../lib/domain/email-delivery";
import {
  MESSAGE_STATE_LABEL,
  MESSAGE_STATE_MEANING,
  isFailure,
  isUnsent,
  messageState,
} from "../lib/domain/message-state";

const read = (p: string) => readFileSync(p, "utf8");

describe("draft delivery state", () => {
  it("is its own state on the conversation log, not sent and not failed", () => {
    const state = messageState({
      direction: "outbound",
      delivery_state: "draft",
      delivery_detail: null,
      opened_at: null,
      clicked_at: null,
      replied_at: null,
      subject: "Sources Sought Response",
    });
    expect(state).toBe("draft");
    expect(isFailure(state)).toBe(false);
    expect(isUnsent(state)).toBe(true);
    expect(MESSAGE_STATE_LABEL.draft).toMatch(/not sent/i);
    expect(MESSAGE_STATE_MEANING.draft).toMatch(/never sent/i);
  });

  it("is reported by the delivery view as needing a person", () => {
    expect(deliveryStateFor({ delivery_state: "draft" })).toBe("draft");
    const d = describeDeliveryState("draft");
    expect(d.attention).toBe(true);
    expect(d.label).toBe("Draft");
  });

  it("is never inferred from engagement: an opened draft is a contradiction the stored state wins", () => {
    // A tracking pixel can fire on a preview. The row says nothing was sent.
    expect(deliveryStateFor({ delivery_state: "draft", opened_at: new Date() })).toBe("draft");
  });
});

describe("writers that hold a message back say so", () => {
  it("the Sources Sought responder records its draft as a draft, with its organization", () => {
    const src = read("lib/agents/sources-sought-responder.ts");
    const insert = src.slice(src.indexOf("insert into communications"));
    expect(insert).toMatch(/org_id/);
    expect(insert).toMatch(/'draft'\)/);
  });

  it("the award-paperwork chase records a refused send as failed, with its organization", () => {
    const src = read("lib/agents/sub-onboarding.ts");
    const insert = src.slice(src.indexOf("insert into communications"));
    expect(insert).toMatch(/org_id/);
    expect(insert).toContain('sent ? "sent" : "failed"');
  });

  it("the outreach agent tells a held approach apart from a failed send", () => {
    const src = read("lib/agents/outreach.ts");
    expect(src).toContain('sent ? "sent" : outreachState === "send_failed" ? "failed" : "draft"');
  });

  it("the database accepts the state and repairs the rows that were mislabelled", () => {
    const sql = read("db/migrations/111_communications_draft_state.sql");
    expect(sql).toMatch(/check \(delivery_state in \('sent','delivered','bounced','deferred','failed','draft'\)\)/);
    // Every backfill is bounded by the two facts that prove nothing was sent.
    const updates = sql.split("update communications").slice(1);
    expect(updates.length).toBe(3);
    for (const u of updates) {
      expect(u).toContain("provider is null");
      expect(u).toContain("gmail_message_id is null");
      expect(u).toContain("delivery_state = 'sent'");
    }
  });
});
