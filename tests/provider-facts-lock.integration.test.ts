/** Real PostgreSQL connections exercise the cross-worker lock. CI supplies an
 * isolated database and blocks external traffic; callbacks below are synthetic.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withProviderFacts, readProviderFacts } from "../lib/ai/provider-facts";
import { query, closePool } from "../lib/db";
import type { RequestIdentity } from "../lib/api-usage/ledger";
const d = process.env.DATABASE_URL ? describe : describe.skip;
d("provider refusal across PostgreSQL worker connections", () => {
  const identity: RequestIdentity = { orgId: randomUUID(), envKey: "OPENAI_API_KEY", value: "synthetic-only", source: "tenant", accepted: false };
  afterAll(async () => {
    await query("delete from ai_provider_facts where account_scope=$1", [`tenant:${identity.orgId}`]);
    await closePool();
  });
  it("admits one synthetic call, makes concurrent workers back off and commits refusal before unlocking", async () => {
    let calls = 0;
    let started!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const refusal = Object.assign(new Error("AI_UNAVAILABLE: synthetic insufficient credit"), {
      provider: "OpenAI", retryable: false, reason: "OpenAI has insufficient credit", status: 429,
    });
    const first = withProviderFacts(identity, "OpenAI", async () => {
      calls++; started(); await wait; throw refusal;
    }).catch(error => error);
    await entered;
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
});
