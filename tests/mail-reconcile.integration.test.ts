/**
 * A scheduled send whose outcome was never written is settled against the
 * mailbox's Sent folder, the only authority on what left. Found becomes
 * sent with its ids; not found stays uncertain without replay; a
 * mailbox that cannot be read leaves the row alone. Nothing is sent here.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { reconcileUncertainMail } from "../lib/domain/mail-reconcile";

const state = vi.hoisted(() => ({
  db: null as PGlite | null,
  lookups: [] as Array<{ orgId: string; to: string; subject: string; afterEpochSec: number }>,
  answer: { status: "not_found" } as
    | { status: "found"; messageId: string; threadId: string | null; rfc822MessageId: string | null }
    | { status: "not_found" }
    | { status: "unavailable"; reason: string },
}));

vi.mock("../lib/db", () => ({
  query: async (sql: string, params?: unknown[]) => (await state.db!.query(sql, params)).rows,
  queryOne: async (sql: string, params?: unknown[]) => (await state.db!.query(sql, params)).rows[0] ?? null,
}));
vi.mock("../lib/integrations/gmail", () => ({
  gmail: {
    findSentMessage: async (orgId: string, match: { to: string; subject: string; afterEpochSec: number }) => {
      state.lookups.push({ orgId, ...match });
      return state.answer;
    },
  },
}));
vi.mock("../lib/app-settings", () => ({
  getAutomationRules: async () => ({ followup_max: 2, followup_hours: 48 }),
}));

import { reconcileUncertainScheduledMail } from "../lib/scheduled-mail-reconcile";

describe("reconcileUncertainMail decision", () => {
  it("records a found send, preserves a missing automatic one, and leaves the rest", () => {
    expect(reconcileUncertainMail({ deliveryState: "attempting", kind: "outreach", lookup: "found" })).toBe("record_sent");
    expect(reconcileUncertainMail({ deliveryState: "unknown", kind: "outreach", lookup: "not_found" })).toBe("leave");
    expect(reconcileUncertainMail({ deliveryState: "unknown", kind: "manual", lookup: "found" })).toBe("record_sent");
    expect(reconcileUncertainMail({ deliveryState: "unknown", kind: "manual", lookup: "not_found" })).toBe("leave");
    expect(reconcileUncertainMail({ deliveryState: "attempting", kind: "outreach", lookup: "unavailable" })).toBe("leave");
    expect(reconcileUncertainMail({ deliveryState: "sent", kind: "outreach", lookup: "not_found" })).toBe("leave");
    expect(reconcileUncertainMail({ deliveryState: "queued", kind: "outreach", lookup: "not_found" })).toBe("leave");
  });
});

describe("reconcileUncertainScheduledMail", () => {
  const org = randomUUID();
  beforeAll(async () => {
    state.db = new PGlite();
    await state.db.exec(`create table communications (
      id uuid primary key default gen_random_uuid(), org_id uuid, request_key uuid,
      delivery_state text, meta jsonb, subject text, recipient_email text,
      provider text, gmail_message_id text, gmail_thread_id text, rfc822_message_id text,
      provider_attempted_at timestamptz, provider_accepted_at timestamptz, follow_up_at timestamptz,
      delivery_detail text, delivery_updated_at timestamptz, created_at timestamptz not null default now()
    );`);
  }, 60_000);
  afterAll(async () => { await state.db?.close(); });
  beforeEach(async () => {
    await state.db!.exec("truncate communications");
    state.lookups.length = 0;
    state.answer = { status: "not_found" };
  });

  async function insert(over: Record<string, unknown> = {}): Promise<string> {
    const row = {
      request_key: randomUUID(), delivery_state: "attempting", meta: { kind: "outreach" },
      subject: "Quote request: roofing", recipient_email: "sub@example.test",
      provider_attempted_at: "now() - interval '40 minutes'", ...over,
    };
    const result = await state.db!.query<{ id: string }>(
      `insert into communications (org_id, request_key, delivery_state, meta, subject, recipient_email, provider_attempted_at, gmail_thread_id)
       values ($1, $2, $3, $4::jsonb, $5, $6, ${row.provider_attempted_at}, $7) returning id`,
      [org, row.request_key, row.delivery_state, JSON.stringify(row.meta), row.subject, row.recipient_email, (row.gmail_thread_id as string | undefined) ?? null]
    );
    return result.rows[0].id;
  }
  const read = async (id: string) =>
    (await state.db!.query<Record<string, unknown>>("select * from communications where id=$1", [id])).rows[0];

  it("records a send found in Sent with its ids, acceptance time and follow-up", async () => {
    const id = await insert();
    state.answer = { status: "found", messageId: "gm-1", threadId: "th-1", rfc822MessageId: "<m1@mail>" };
    const result = await reconcileUncertainScheduledMail();
    expect(result).toEqual({ confirmedSent: 1, releasedForRetry: 0, leftUnresolved: 0 });
    const row = await read(id);
    expect(row).toMatchObject({ delivery_state: "sent", provider: "gmail", gmail_message_id: "gm-1", gmail_thread_id: "th-1", rfc822_message_id: "<m1@mail>" });
    expect(row.provider_accepted_at).toEqual(row.provider_attempted_at);
    const accepted = new Date(String(row.provider_accepted_at)).getTime();
    expect(new Date(String(row.follow_up_at)).getTime() - accepted).toBe(48 * 3_600_000);
    expect((row.meta as Record<string, unknown>).reconciled).toBe("gmail_sent");
    expect(state.lookups).toHaveLength(1);
    expect(state.lookups[0]).toMatchObject({ orgId: org, to: "sub@example.test", subject: "Quote request: roofing" });
    // The search window opens a little before the stamped attempt.
    expect(state.lookups[0].afterEpochSec * 1000).toBeLessThan(accepted);
    expect(accepted - state.lookups[0].afterEpochSec * 1000).toBeLessThanOrEqual(6 * 60_000);
  });

  it("keeps a send uncertain when the Sent lookup is empty", async () => {
    const id = await insert({ delivery_state: "unknown" });
    const result = await reconcileUncertainScheduledMail();
    expect(result).toEqual({ confirmedSent: 0, releasedForRetry: 0, leftUnresolved: 1 });
    const row = await read(id);
    expect(row.delivery_state).toBe("unknown");
    expect(row.delivery_detail).toBeNull();
    expect(row.follow_up_at).toBeNull();
  });

  it("leaves a row alone when the mailbox cannot be read, and leaves a fresh attempt for its lease", async () => {
    const stale = await insert();
    const fresh = await insert({ provider_attempted_at: "now() - interval '2 minutes'" });
    state.answer = { status: "unavailable", reason: "quota" };
    const result = await reconcileUncertainScheduledMail();
    expect(result).toEqual({ confirmedSent: 0, releasedForRetry: 0, leftUnresolved: 1 });
    expect((await read(stale)).delivery_state).toBe("attempting");
    expect((await read(fresh)).delivery_state).toBe("attempting");
    expect(state.lookups).toHaveLength(1);
  });

  it("never resends a person's manual message, but does record it when Sent has it", async () => {
    const missing = await insert({ meta: { kind: "manual" }, delivery_state: "unknown" });
    let result = await reconcileUncertainScheduledMail();
    expect(result).toEqual({ confirmedSent: 0, releasedForRetry: 0, leftUnresolved: 1 });
    expect((await read(missing)).delivery_state).toBe("unknown");
    state.answer = { status: "found", messageId: "gm-2", threadId: null, rfc822MessageId: null };
    result = await reconcileUncertainScheduledMail();
    expect(result).toEqual({ confirmedSent: 1, releasedForRetry: 0, leftUnresolved: 0 });
    expect((await read(missing)).delivery_state).toBe("sent");
  });

  it("preserves an uncertain row with missing correlation, without asking the mailbox", async () => {
    const id = await insert({ recipient_email: null });
    await state.db!.query("update communications set recipient_email=null where id=$1", [id]);
    const result = await reconcileUncertainScheduledMail();
    expect(result.releasedForRetry).toBe(0);
    expect((await read(id)).delivery_state).toBe("attempting");
    expect(state.lookups).toHaveLength(0);
  });

  it("keeps an existing thread id when the Sent lookup has none", async () => {
    const id = await insert({ gmail_thread_id: "known-thread" });
    state.answer = { status: "found", messageId: "gm-3", threadId: null, rfc822MessageId: null };
    await reconcileUncertainScheduledMail();
    expect((await read(id)).gmail_thread_id).toBe("known-thread");
  });
});
