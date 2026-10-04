import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { RequestIdentity } from "../lib/api-usage/ledger";
const state = vi.hoisted(() => ({ db: null as any, org: "tenant-a", source: "tenant" as RequestIdentity["source"],
  keys: { OPENAI_API_KEY: "synthetic-openai", ANTHROPIC_API_KEY: "synthetic-anthropic" } as Record<string,string>,
  openai: vi.fn(), anthropic: vi.fn(), attempts: 0, budgetHeld: false, busy: false, meteringError: null as Error | null, failSettlement: false, failClaimAck: false, failSettlementAck: false, failSettlementProvider: null as string | null, transactions: 0 }));
vi.mock("../lib/db", () => ({
  queryOne: async (sql: string, params: unknown[]) => {
    if (state.failSettlement && sql.startsWith("update ai_provider_facts")) throw new Error("synthetic completion database outage");
    const row = (await state.db.query(sql, params)).rows[0] ?? null;
    if (state.failSettlementAck && sql.startsWith("update ai_provider_facts") && (!state.failSettlementProvider || params[1] === state.failSettlementProvider)) throw new Error("synthetic lost completion acknowledgement");
    return row;
  },
  transaction: async (fn: any) => {
    state.transactions++;
    try {
      const value = await state.db.transaction((tx: any) => fn({ query: async (sql: string, params: unknown[]) =>
        sql.includes("pg_try_advisory_xact_lock") ? { rows: [{ acquired: !state.busy }] } : tx.query(sql, params) }));
      if (state.failClaimAck) throw new Error("synthetic lost claim commit acknowledgement");
      return value;
    } finally { state.transactions--; }
  },
}));
vi.mock("../lib/tenant", () => ({ resolveTenantOrgId: async () => state.org }));
vi.mock("../lib/integration-keys", () => ({
  orgApiKey: async (key: string) => state.keys[key] ?? "",
  orgHasKey: async (key: string) => Boolean(state.keys[key]),
}));
vi.mock("../lib/api-usage/ledger", () => ({
  requestIdentity: async (envKey: string, value: string, orgId?: string) => ({ orgId: orgId ?? state.org, envKey, value, source: state.source, accepted: false }),
  metered: async (_i: unknown, _p: unknown, _s: unknown, _f: unknown, execute: () => Promise<unknown>) => {
    if (state.meteringError) throw state.meteringError;
    if (state.budgetHeld) throw Object.assign(new Error("API_BUDGET: daily limit"), { name: "ApiUsageBlockedError" });
    state.attempts++;
    return execute();
  },
}));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: (...args: unknown[]) => state.anthropic(...args) }; } }));
vi.mock("../lib/ai/openai", async original => ({ ...(await original<typeof import("../lib/ai/openai")>()),
  openAiResponse: (...args: unknown[]) => state.openai(...args) }));
import { complete } from "../lib/ai/claude";
import { withApiUsageContext } from "../lib/api-usage/context";
import { config } from "../lib/config";
import { currentProviderFacts, providerProblem, providerEnqueueHold, providerScope } from "../lib/ai/provider-facts";
import { recentAiTrouble, lastProviderSuccess, troubleSummary } from "../lib/integration-health";
import { integrationState } from "../lib/domain/integration-state";
import { VALIDATORS } from "../lib/integration-validators";
const call = () => complete("synthetic prompt", { injectProfile: false });
const quota = () => ({ status: 429, code: "insufficient_quota", message: "Insufficient quota" });
const ok = { id: "fake", text: "synthetic", usage: { input_tokens: 1, output_tokens: 1 }, stopReason: "end_turn" };
beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec(`create table ai_work_receipts(org_id text,work_key text,scope_key text,input_hash text,owner uuid,state text,result jsonb,started_at timestamptz,completed_at timestamptz,primary key(org_id,work_key))`);
  await state.db.exec(readFileSync("db/migrations/125_ai_provider_facts.sql", "utf8"));
  await state.db.exec(readFileSync("db/migrations/126_ai_provider_attempts.sql", "utf8"));
}, 60_000);
afterAll(async () => { await state.db.close(); vi.unstubAllGlobals(); });
beforeEach(async () => {
  await state.db.exec("truncate ai_provider_facts,ai_work_receipts");
  state.org = "tenant-a"; state.source = "tenant"; state.attempts = 0; state.budgetHeld = false; state.busy = false; state.meteringError = null; state.failSettlement = false; state.failClaimAck = false; state.failSettlementAck = false; state.failSettlementProvider = null; state.transactions = 0;
  state.keys = { OPENAI_API_KEY: "synthetic-openai", ANTHROPIC_API_KEY: "synthetic-anthropic" };
  state.openai.mockReset().mockResolvedValue(ok);
  state.anthropic.mockReset().mockResolvedValue({ content: [{ type: "text", text: "synthetic" }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "end_turn" });
  config.ai.routineProvider = "OpenAI"; config.ai.complexProvider = "OpenAI"; config.ai.fallback = false;
});

describe("durable provider/account/current-credential evidence", () => {
  it("makes one refused call across repeated 200-item sweeps and already queued executions", async () => {
    state.openai.mockRejectedValue(quota());
    await expect(call()).rejects.toMatchObject({ retryable: false, provider: "OpenAI" });
    for (let sweep = 0; sweep < 3; sweep++) {
      for (let i = 0; i < 200; i++) expect(await providerEnqueueHold(state.org, "complex")).toContain("insufficient credit");
      await expect(call()).rejects.toMatchObject({ retryable: false, provider: "OpenAI" });
    }
    expect(state.openai).toHaveBeenCalledTimes(1); expect(state.attempts).toBe(1);
  });
  it("serializes concurrent synthetic jobs and persists refusal before the next executes", async () => {
    state.openai.mockRejectedValue(quota());
    const results = await Promise.allSettled(Array.from({ length: 8 }, call));
    expect(results.every(r => r.status === "rejected")).toBe(true);
    expect(state.attempts).toBe(1);
  });
  it.each([{ status: 429, message: "rate limited" }, { status: 503, message: "unavailable" }, { message: "network timeout" }])("preserves transient backoff for %j", async err => {
    state.openai.mockRejectedValueOnce(err);
    await expect(call()).rejects.toMatchObject({ retryable: true });
    expect(await providerEnqueueHold(state.org, "routine")).toBeNull();
    expect((await recentAiTrouble(state.org, "OpenAI")).count).toBe(1);
    await expect(call()).resolves.toMatchObject({ text: "synthetic" });
    expect((await recentAiTrouble(state.org, "OpenAI")).count).toBe(0);
    expect(state.attempts).toBe(2);
  });
  it("backs off without metering when another worker owns the credential lock", async () => {
    state.busy = true;
    await expect(call()).rejects.toMatchObject({ retryable: true });
    expect(state.attempts).toBe(0);
  });
  it("keeps tenant, provider and rotated credential histories separate", async () => {
    state.openai.mockRejectedValueOnce(quota()); await expect(call()).rejects.toThrow();
    state.org = "tenant-b"; expect(await currentProviderFacts("OpenAI")).toBeNull(); await call();
    state.org = "tenant-a"; expect(await providerEnqueueHold(state.org, "routine")).toContain("insufficient credit");
    expect(await currentProviderFacts("Anthropic")).toBeNull();
    state.keys.OPENAI_API_KEY = "rotated-synthetic";
    expect(await currentProviderFacts("OpenAI")).toBeNull(); await call();
    state.keys.OPENAI_API_KEY = "synthetic-openai";
    expect(await providerEnqueueHold(state.org, "routine")).toContain("insufficient credit");
  });
  it("persists environment/platform failures without settings rows and shares only the actual platform credential", async () => {
    state.source = "platform"; state.openai.mockRejectedValueOnce(quota());
    await expect(call()).rejects.toThrow(); state.org = "tenant-b";
    expect(await providerEnqueueHold(state.org, "routine")).toContain("insufficient credit");
    state.source = "tenant";
    expect(await currentProviderFacts("OpenAI")).toBeNull();
    state.source = "platform"; state.keys.OPENAI_API_KEY = "different-platform-account";
    expect(await currentProviderFacts("OpenAI")).toBeNull();
  });
  it("does not expose raw credentials in persistent scope", () => {
    const scope = providerScope({ orgId: "a", envKey: "OPENAI_API_KEY", value: "synthetic-secret", source: "unknown", accepted: false }, "OpenAI");
    expect(scope[0]).toBe("unknown:a"); expect(scope.join()).not.toContain("synthetic-secret");
  });
  it("keeps an old refusal above older success after six hours and after 30 days of silence", async () => {
    await call(); state.openai.mockRejectedValueOnce(quota()); await expect(call()).rejects.toThrow();
    await state.db.exec("update ai_provider_facts set last_success_at=now()-interval '40 days',last_failure_at=now()-interval '31 days'");
    const trouble = await recentAiTrouble(state.org, "OpenAI");
    expect(troubleSummary(trouble)).toContain("No newer successful");
    const verdict = integrationState({ configured: true, lastError: trouble.reason, lastSuccessAt: await lastProviderSuccess("OpenAI"), lastValidatedAt: null });
    expect(verdict.state).toBe("blocked"); expect(await providerEnqueueHold(state.org, "routine")).not.toBeNull();
  });
  it("never borrows Claude health from a successful OpenAI or generic agent log", async () => {
    await call(); expect(await lastProviderSuccess("Anthropic")).toBeNull();
    expect(await lastProviderSuccess("OpenAI")).not.toBeNull();
  });
  it("requires a successful explicit recovery test, and a budget hold or transient test cannot clear a refusal", async () => {
    state.openai.mockRejectedValueOnce(quota()); await expect(call()).rejects.toThrow();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    await VALIDATORS.openai(state.keys);
    expect(await providerEnqueueHold(state.org, "routine")).not.toBeNull();
    state.budgetHeld = true;
    await expect(VALIDATORS.openai(state.keys)).rejects.toThrow("API_BUDGET");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(providerProblem(await currentProviderFacts("OpenAI"))).toContain("insufficient credit");
    state.budgetHeld = false;
    fetch.mockImplementation(async () => new Response(JSON.stringify({ id: "fake", usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }));
    expect((await VALIDATORS.openai(state.keys)).ok).toBe(true);
    expect(await providerEnqueueHold(state.org, "routine")).toBeNull();
    expect((await recentAiTrouble(state.org, "OpenAI")).count).toBe(0);
    await call(); expect(state.attempts).toBe(4);
  });
  it("allows only configured fallback and records each provider independently", async () => {
    config.ai.fallback = true; state.openai.mockRejectedValueOnce(quota());
    const out = await call(); expect(out.usage.provider).toBe("Anthropic");
    expect(providerProblem(await currentProviderFacts("OpenAI"))).toContain("insufficient credit");
    expect(providerProblem(await currentProviderFacts("Anthropic"))).toBeNull();
    expect(await providerEnqueueHold(state.org, "routine")).toBeNull();
    await call(); expect(state.openai).toHaveBeenCalledTimes(1); expect(state.anthropic).toHaveBeenCalledTimes(2);
    config.ai.fallback = false;
    expect(await providerEnqueueHold(state.org, "routine")).not.toBeNull();
  });
});

it("does not turn ledger preparation failures into durable provider refusals", async () => {
  state.meteringError = new Error("billing ledger connection timeout");
  await expect(call()).rejects.toBe(state.meteringError);
  expect(providerProblem(await currentProviderFacts("OpenAI"))).toBeNull();
  await expect(VALIDATORS.openai(state.keys)).rejects.toBe(state.meteringError);
  expect(providerProblem(await currentProviderFacts("OpenAI"))).toBeNull();
  expect(state.attempts).toBe(0);
});
it.each([401,403])("persists HTTP %i credential refusals without another model call", async status => {
  state.openai.mockRejectedValueOnce({ status, message: "invalid API key" });
  await expect(call()).rejects.toMatchObject({ status, retryable: false, provider: "OpenAI" });
  await expect(call()).rejects.toMatchObject({ status, retryable: false, provider: "OpenAI" });
  expect(state.attempts).toBe(1);
});
it("persists Anthropic account allowance refusals independently", async () => {
  config.ai.routineProvider = "Anthropic";
  state.anthropic.mockRejectedValueOnce({ status: 400, message: "specified API usage limits" });
  await expect(call()).rejects.toMatchObject({ provider: "Anthropic", retryable: false });
  await expect(call()).rejects.toMatchObject({ provider: "Anthropic", retryable: false });
  expect(state.attempts).toBe(1);
  expect(await currentProviderFacts("OpenAI")).toBeNull();
});


describe("short durable provider claims", () => {
  it("releases its transaction before provider I/O and makes pending health and admission non-green", async () => {
    state.openai.mockRejectedValueOnce({ status: 503, message: "unavailable" });
    await expect(call()).rejects.toThrow();
    await call();
    let started!: () => void; let release!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    state.openai.mockImplementationOnce(async () => { started(); await wait; return ok; });
    const first = call();
    await entered;
    try {
      expect(state.transactions).toBe(0);
      expect((await state.db.query("select 1 as available")).rows[0].available).toBe(1);
      expect(await providerEnqueueHold(state.org, "routine")).toContain("unresolved outcome");
      expect(providerProblem(await currentProviderFacts("OpenAI"))).toContain("unresolved outcome");
      await expect(call()).rejects.toMatchObject({ retryable: true });
      expect(troubleSummary(await recentAiTrouble(state.org, "OpenAI"))).toContain("unresolved outcome");
      expect(state.attempts).toBe(3);
    } finally { release(); }
    await first;
    expect(await providerEnqueueHold(state.org, "routine")).toBeNull();
  });
  it.each(["success", "refusal"])("keeps a durable unknown hold when %s evidence cannot be written", async result => {
    if (result === "refusal") state.openai.mockRejectedValueOnce(quota());
    state.failSettlement = true;
    await expect(call()).rejects.toMatchObject({ retryable: false, provider: "OpenAI" });
    state.failSettlement = false;
    // Simulate restart and an arbitrarily old claim: age does not authorize takeover.
    await state.db.exec("update ai_provider_facts set pending_started_at=now()-interval '40 days'");
    for (let sweep = 0; sweep < 3; sweep++) {
      expect(await providerEnqueueHold(state.org, "routine")).toContain("unresolved outcome");
      await expect(call()).rejects.toMatchObject({ retryable: true });
    }
    await expect(VALIDATORS.openai(state.keys)).rejects.toThrow("unresolved outcome");
    expect(state.attempts).toBe(1);
    expect((await currentProviderFacts("OpenAI"))?.pending_attempt).toBeTruthy();
  });
  it("never starts I/O after an uncertain claim commit, and preserves the committed claim", async () => {
    state.failClaimAck = true;
    await expect(call()).rejects.toThrow("lost claim commit acknowledgement");
    state.failClaimAck = false;
    await expect(call()).rejects.toThrow("unresolved outcome");
    expect(state.attempts).toBe(0);
    expect((await currentProviderFacts("OpenAI"))?.pending_attempt).toBeTruthy();
  });
  it("fences a late completion from clearing a different attempt or newer refusal", async () => {
    state.openai.mockImplementationOnce(async () => {
      await state.db.exec("update ai_provider_facts set pending_attempt='00000000-0000-4000-8000-000000000001',refusal_reason='newer refusal'");
      return ok;
    });
    await expect(call()).rejects.toMatchObject({ retryable: false, provider: "OpenAI" });
    const facts = await currentProviderFacts("OpenAI");
    expect(facts?.pending_attempt).toBe("00000000-0000-4000-8000-000000000001");
    expect(facts?.refusal_reason).toBe("newer refusal");
    expect(facts?.last_success_at).toBeNull();
  });
});

it("does not request replay when completion committed but its acknowledgement was lost", async () => {
  state.failSettlementAck = true;
  await expect(call()).rejects.toMatchObject({ retryable: false, provider: "OpenAI" });
  const facts = await currentProviderFacts("OpenAI");
  expect(facts?.pending_attempt).toBeNull();
  expect(facts?.last_success_at).not.toBeNull();
  expect(state.attempts).toBe(1);
});

it("preserves non-retryable uncertain fallback completion after a transient primary failure", async () => {
  config.ai.fallback = true;
  state.openai.mockRejectedValueOnce({ status: 503, message: "unavailable" });
  state.failSettlementAck = true; state.failSettlementProvider = "Anthropic";
  await expect(call()).rejects.toMatchObject({ retryable: false, provider: "Anthropic" });
  expect(state.attempts).toBe(2);
  expect(state.openai).toHaveBeenCalledTimes(1); expect(state.anthropic).toHaveBeenCalledTimes(1);
  expect((await currentProviderFacts("Anthropic"))?.last_success_at).not.toBeNull();
});


describe("pending primary admission",()=>{
 it("keeps an unresolved primary held even with a healthy fallback",async()=>{
  config.ai.fallback=true;
  const identity={orgId:state.org,envKey:"OPENAI_API_KEY",value:state.keys.OPENAI_API_KEY,source:state.source,accepted:false};
  await state.db.query(`insert into ai_provider_facts(account_scope,provider,credential_hash,pending_attempt,pending_started_at)
    values($1,$2,$3,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now())`,providerScope(identity,"OpenAI"));
  expect(await providerEnqueueHold(state.org,"routine")).toContain("unresolved");
  expect(state.anthropic).not.toHaveBeenCalled();expect(state.openai).not.toHaveBeenCalled();
 });
});

 it("does not pay again after provider settlement ACK loss even after the account pending token cleared",async()=>{
  state.failSettlementAck=true;
  const work=()=>withApiUsageContext({workKey:"scoring:opportunity",relatedId:"opportunity"},call);
  await expect(work()).rejects.toMatchObject({retryable:false});
  expect((await currentProviderFacts("OpenAI",state.org))?.pending_attempt).toBeNull();
  state.failSettlementAck=false;
  for(let n=0;n<3;n++)await expect(work()).rejects.toMatchObject({retryable:false});
  expect(state.openai).toHaveBeenCalledTimes(1);expect(state.attempts).toBe(1);
 });

 it("preserves real subclass HTTP429 backoff while holding a timeout from the fallback",async()=>{
  const work=()=>withApiUsageContext({workKey:"classify:record",relatedId:"record"},call);
  state.openai.mockRejectedValueOnce({status:429,message:"rate limit"});
  await expect(work()).rejects.toMatchObject({retryable:true});
  await expect(work()).resolves.toMatchObject({text:"synthetic"});
  config.ai.fallback=true;state.openai.mockRejectedValue({status:429,message:"rate limit"});state.anthropic.mockRejectedValue(new Error("socket timed out"));
  const other=()=>withApiUsageContext({workKey:"classify:other",relatedId:"other"},call);
  await expect(other()).rejects.toMatchObject({retryable:false});
  const count=state.attempts;await expect(other()).rejects.toMatchObject({retryable:false});expect(state.attempts).toBe(count);
 });
