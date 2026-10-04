import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ queryOne: vi.fn(), send: vi.fn() }));
vi.mock("../lib/db", () => ({ queryOne: m.queryOne }));
vi.mock("../lib/integrations/email-transport", () => ({ sendOutreachEmail: m.send }));
import { sendManualEmail } from "../lib/manual-email";

const input = { requestKey: "11111111-1111-4111-8111-111111111111", actorId: "operator-a",
  params: { orgId: "tenant-a", subcontractorId: "sub-a", to: "sub@example.test",
    subject: "Project question", text: "Please confirm the scope.", html: "Please confirm the scope." } };
type Row = { id: string; request_fingerprint: string; delivery_state: string;
  gmail_thread_id: string | null; rfc822_message_id: string | null };
let rows: Map<string, Row>;
beforeEach(() => {
  vi.resetAllMocks(); rows = new Map();
  m.queryOne.mockImplementation(async (sql: string, p: unknown[]) => {
    if (sql.includes("insert into communications")) {
      const key = `${p[0]}:${p[7]}`;
      if (rows.has(key)) return null;
      const row = { id: key, request_fingerprint: String(p[8]), delivery_state: "queued",
        gmail_thread_id: null, rfc822_message_id: null };
      rows.set(key, row); return { ...row };
    }
    if (sql.includes("select id, request_fingerprint")) return rows.get(`${p[0]}:${p[1]}`) ?? null;
    const row = rows.get(String(p[0]));
    if (!row || !row.id.startsWith(`${p[1]}:`)) return null;
    if (sql.includes("provider_attempted_at=now()")) row.delivery_state = "attempting";
    else { row.delivery_state = String(p[2]); row.gmail_thread_id = p[5] as string | null; }
    return { ...row };
  });
  m.send.mockImplementation(async (params) => {
    await params.beforeProviderSend("Verified sender <sender@example.test>");
    return { provider: "gmail", messageId: "provider-receipt", threadId: "thread-a" };
  });
});

describe("durable manual send claims", () => {
  it("allows only one provider call for concurrent requests and returns the accepted receipt on replay", async () => {
    const results = await Promise.all([sendManualEmail(input), sendManualEmail(input)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(m.send).toHaveBeenCalledTimes(1);
    expect(await sendManualEmail(input)).toEqual({ ok: true, threadId: "thread-a", rfc822MessageId: null });
    expect(m.send).toHaveBeenCalledTimes(1);
  });
  it("preserves unknown delivery after a timeout and never replays it", async () => {
    m.send.mockImplementation(async (params) => {
      await params.beforeProviderSend("sender@example.test");
      return { provider: null, error: "socket timed out" };
    });
    expect((await sendManualEmail(input)).ok).toBe(false);
    expect([...rows.values()][0].delivery_state).toBe("unknown");
    expect((await sendManualEmail(input)).ok).toBe(false);
    expect(m.send).toHaveBeenCalledTimes(1);
  });
  it("keeps the attempt when acceptance persistence fails", async () => {
    const database = m.queryOne.getMockImplementation()!;
    m.queryOne.mockImplementation(async (sql, p) => {
      if (sql.includes("provider_accepted_at")) throw new Error("write lost");
      return database(sql, p);
    });
    expect((await sendManualEmail(input)).ok).toBe(false);
    expect([...rows.values()][0].delivery_state).toBe("attempting");
    await sendManualEmail(input);
    expect(m.send).toHaveBeenCalledTimes(1);
  });
  it("will not hand off when durable attempt stamping fails", async () => {
    const database = m.queryOne.getMockImplementation()!;
    const provider = vi.fn();
    m.queryOne.mockImplementation(async (sql, p) => {
      if (sql.includes("provider_attempted_at=now()")) throw new Error("write unavailable");
      return database(sql, p);
    });
    m.send.mockImplementation(async (params) => { await params.beforeProviderSend("sender@example.test"); provider(); });
    expect((await sendManualEmail(input)).ok).toBe(false);
    expect(provider).not.toHaveBeenCalled();
    await sendManualEmail(input);
    expect(m.send).toHaveBeenCalledTimes(1);
  });
  it("separates tenants and rejects changed content or actors under an existing key", async () => {
    await sendManualEmail(input);
    expect((await sendManualEmail({ ...input, actorId: "operator-b" })).ok).toBe(false);
    expect((await sendManualEmail({ ...input, params: { ...input.params, text: "Changed" } })).ok).toBe(false);
    expect((await sendManualEmail({ ...input, params: { ...input.params, orgId: "tenant-b" } })).ok).toBe(true);
    expect(m.send).toHaveBeenCalledTimes(2);
  });
  it("records a pre-send suppression as held, not sent or failed", async () => {
    m.send.mockResolvedValue({ provider: null, blocked: true, error: "Opted out" });
    expect((await sendManualEmail(input)).ok).toBe(false);
    expect([...rows.values()][0].delivery_state).toBe("held");
  });
  it("allows a new deliberate request after a confirmed refusal but never automatically replays it", async () => {
    m.send.mockImplementation(async (params) => {
      await params.beforeProviderSend("sender@example.test");
      return { provider: "gmail", error: "Explicit refusal", outcome: "refused" };
    });
    expect(await sendManualEmail(input)).toMatchObject({ ok: false, safeToCompose: true });
    expect([...rows.values()][0].delivery_state).toBe("failed");
    await sendManualEmail(input);
    expect(m.send).toHaveBeenCalledTimes(1);
  });

});
