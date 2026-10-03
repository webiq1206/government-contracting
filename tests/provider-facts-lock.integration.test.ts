/** Real PostgreSQL connections exercise the cross-worker lock. CI supplies an
 * isolated database and blocks external traffic; callbacks below are synthetic.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withProviderFacts, readProviderFacts, providerScope } from "../lib/ai/provider-facts";
import { query, closePool } from "../lib/db";
import type { RequestIdentity } from "../lib/api-usage/ledger";
const d = process.env.DATABASE_URL ? describe : describe.skip;
d("provider refusal across PostgreSQL worker connections", () => {
  const identity: RequestIdentity = { orgId: randomUUID(), envKey: "OPENAI_API_KEY", value: "synthetic-only", source: "tenant", accepted: false };
  const previousPoolMax = process.env.PG_POOL_MAX;
  beforeAll(async () => { await closePool(); process.env.PG_POOL_MAX = "1"; });
  afterAll(async () => {
    await query("delete from ai_provider_facts where account_scope=$1", [`tenant:${identity.orgId}`]);
    await closePool();
    if (previousPoolMax === undefined) delete process.env.PG_POOL_MAX;
    else process.env.PG_POOL_MAX = previousPoolMax;
  });
  it("uses a one-connection pool without starving other work while a durable claim blocks overlap", async () => {
    let calls = 0;
    let started!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const refusal = Object.assign(new Error("AI_UNAVAILABLE: synthetic insufficient credit"), {
      provider: "OpenAI", retryable: false, reason: "OpenAI has insufficient credit", status: 429,
    });
    const first = withProviderFacts(identity, "OpenAI", async () => {
      calls++;
      expect((await query<{ available: number }>("select 1 as available"))[0].available).toBe(1);
      started(); await wait; throw refusal;
    }).catch(error => error);
    await Promise.race([entered, first.then(() => { throw new Error("Provider guard failed before entering callback"); })]);
    try {
      await expect(withProviderFacts(identity, "OpenAI", async () => { calls++; })).rejects.toMatchObject({ retryable: true });
      // Another provider/account is not held by this lock.
      await withProviderFacts(identity, "Anthropic", async () => "independent");
    } finally { release(); }
    expect(await first).toBe(refusal);
    await expect(withProviderFacts(identity, "OpenAI", async () => { calls++; })).rejects.toMatchObject({ retryable: false });
    expect(calls).toBe(1);
    expect((await readProviderFacts(identity, "OpenAI"))?.refusal_reason).toContain("insufficient credit");
  });
  it("keeps a committed abandoned claim across connection-pool recreation and refuses recovery takeover", async () => {
    const other = { ...identity, value: "synthetic-crashed-worker" };
    const attempt = randomUUID();
    await query(`insert into ai_provider_facts(account_scope,provider,credential_hash,pending_attempt,pending_started_at)
      values($1,$2,$3,$4,now()-interval '40 days')`, [...providerScope(other, "OpenAI"), attempt]);
    await closePool();
    let calls = 0;
    for (const recovery of [false, true]) {
      await expect(withProviderFacts(other, "OpenAI", async () => { calls++; }, recovery)).rejects.toThrow("unresolved outcome");
    }
    expect(calls).toBe(0);
    expect((await readProviderFacts(other, "OpenAI"))?.pending_attempt).toBe(attempt);
  });
});
