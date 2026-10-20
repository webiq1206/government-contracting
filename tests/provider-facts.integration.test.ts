import { beforeAll, afterAll, afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { RequestIdentity } from "../lib/api-usage/ledger";
const state = vi.hoisted(() => ({ db: null as any, org: "tenant-a", source: "tenant" as RequestIdentity["source"],
  keys: { OPENAI_API_KEY: "synthetic-openai", ANTHROPIC_API_KEY: "synthetic-anthropic" } as Record<string,string>,
  profile: "Original profile", openai: vi.fn(), anthropic: vi.fn(), attempts: 0, budgetHeld: false, busy: false, meteringError: null as Error | null, failSettlement: false, failClaimAck: false, failSettlementAck: false, failSettlementProvider: null as string | null, transactions: 0 }));
vi.mock("../lib/db", () => ({
  query: async (sql: string, params: unknown[] = []) => {
    try {
      return (await state.db.query(sql, params)).rows;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/does not exist/.test(message)) return [];
      throw error;
    }
  },
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
        sql.includes("pg_try_advisory_xact_lock") ? { rows: [{ acquired: !state.busy }] } :
          sql.includes("pg_advisory_xact_lock") ? { rows: [] } : tx.query(sql, params) }));
      if (state.failClaimAck) throw new Error("synthetic lost claim commit acknowledgement");
      return value;
    } finally { state.transactions--; }
  },
}));
vi.mock("../lib/ai/companyProfile", () => ({getProfileSystemText:async()=>state.profile}));
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
import { agentWorkIdentity } from "../lib/ai/work-identity";
import { complete, probeProviderRecovery } from "../lib/ai/claude";
import { currentOrgId, runWithOrg } from "../lib/tenant-context";
import { withApiUsageContext } from "../lib/api-usage/context";
import { config } from "../lib/config";
import { currentProviderFacts, providerProblem, providerEnqueueHold, providerScope, providerBusyWait } from "../lib/ai/provider-facts";
import { recentAiTrouble, lastProviderSuccess, troubleSummary } from "../lib/integration-health";
import { integrationState } from "../lib/domain/integration-state";
import { VALIDATORS } from "../lib/integration-validators";
const advanceCooldown = () => vi.spyOn(Date, "now").mockReturnValue(Date.now() + 601000);
afterEach(() => vi.restoreAllMocks());
const call = () => complete("synthetic prompt", { injectProfile: false });
const quota = () => ({ status: 429, code: "insufficient_quota", message: "Insufficient quota" });
const ok = { id: "fake", text: "synthetic", usage: { input_tokens: 1, output_tokens: 1 }, stopReason: "end_turn" };
beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec('create table prospective_fence(preview_id uuid,released_at timestamptz)');
  await state.db.exec(`create table ai_work_receipts(org_id text,work_key text,scope_key text,input_hash text,owner uuid,state text,result jsonb,started_at timestamptz,completed_at timestamptz,primary key(org_id,work_key))`);
  await state.db.exec(readFileSync("db/migrations/125_ai_provider_facts.sql", "utf8"));
  await state.db.exec(readFileSync("db/migrations/126_ai_provider_attempts.sql", "utf8"));
}, 60_000);
afterAll(async () => { await state.db.close(); vi.unstubAllGlobals(); });
beforeEach(async () => {
  // A busy credential fails at once here; the wait has its own test.
  providerBusyWait.maxMs = 0;
  await state.db.exec("truncate ai_provider_facts,ai_work_receipts,prospective_fence");
  state.org = "tenant-a"; state.source = "tenant"; state.attempts = 0; state.budgetHeld = false; state.busy = false; state.meteringError = null; state.failSettlement = false; state.failClaimAck = false; state.failSettlementAck = false; state.failSettlementProvider = null; state.transactions = 0;
  state.keys = { OPENAI_API_KEY: "synthetic-openai", ANTHROPIC_API_KEY: "synthetic-anthropic" };
  state.openai.mockReset().mockResolvedValue(ok);
  state.anthropic.mockReset().mockResolvedValue({ content: [{ type: "text", text: "synthetic" }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "end_turn" });
  config.ai.routineProvider = "OpenAI"; config.ai.complexProvider = "OpenAI"; config.ai.fallback = false; config.ai.brostcoFailover = false;
});

describe("durable provider/account/current-credential evidence", () => {
  it("makes one refused call across repeated 200-item sweeps and already queued executions", async () => {
    state.openai.mockRejectedValue(quota());
    await expect(call()).rejects.toMatchObject({ retryable: false, provider: "OpenAI" });
    for (let sweep = 0; sweep < 3; sweep++) {
      for (let i = 0; i < 200; i++) expect(await providerEnqueueHold(state.org, "complex")).toContain("billing quota or account allowance");
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
  it("honors a bounded Retry-After on a 429 instead of latching the account", async () => {
    state.openai.mockRejectedValueOnce({
      status: 429,
      type: "rate_limit_error",
      message: "rate limited",
      headers: { "retry-after": "120" },
    });
    await expect(call()).rejects.toThrow(/rate limiting/);
    expect(await providerEnqueueHold(state.org, "routine")).toContain("Next automatic attempt after");
    await expect(call()).rejects.toThrow(/rate limiting/);
    expect(state.attempts).toBe(1);
    expect((await currentProviderFacts("OpenAI"))?.refusal_reason ?? null).toBeNull();
    advanceCooldown();
    await expect(call()).resolves.toMatchObject({ text: "synthetic" });
    expect(state.attempts).toBe(2);
    expect(await providerEnqueueHold(state.org, "routine")).toBeNull();
  });
  it.each([{ status: 429, type: "rate_limit_error", message: "rate limited" }])("holds a rate limit until the probe succeeds for %j", async err => {
    state.openai.mockRejectedValueOnce(err);
    await expect(call()).rejects.toMatchObject({ retryable: false });
    expect(await providerEnqueueHold(state.org, "routine")).toContain("rate limiting");
    await expect(call()).rejects.toMatchObject({ retryable: false });
    expect(state.attempts).toBe(1);
    advanceCooldown();
    await expect(call()).rejects.toThrow();
    expect(state.attempts).toBe(1);
    await expect(probeProviderRecovery("OpenAI", state.org)).resolves.toMatchObject({ text: "synthetic" });
    expect(await providerEnqueueHold(state.org, "routine")).toBeNull();
    await expect(call()).resolves.toMatchObject({ text: "synthetic" });
  });
  it("backs off without metering when another worker owns the credential lock", async () => {
    state.busy = true;
    await expect(call()).rejects.toMatchObject({ retryable: true });
    expect(state.attempts).toBe(0);
  });
  it("keeps tenant, provider and rotated credential histories separate", async () => {
    state.openai.mockRejectedValueOnce(quota()); await expect(call()).rejects.toThrow();
    state.org = "tenant-b"; expect(await currentProviderFacts("OpenAI")).toBeNull(); await call();
    state.org = "tenant-a"; expect(await providerEnqueueHold(state.org, "routine")).toContain("billing quota or account allowance");
    expect(await currentProviderFacts("Anthropic")).toBeNull();
    state.keys.OPENAI_API_KEY = "rotated-synthetic";
    expect(await currentProviderFacts("OpenAI")).toBeNull(); await call();
    state.keys.OPENAI_API_KEY = "synthetic-openai";
    expect(await providerEnqueueHold(state.org, "routine")).toContain("billing quota or account allowance");
  });
  it("persists environment/platform failures without settings rows and shares only the actual platform credential", async () => {
    state.source = "platform"; state.openai.mockRejectedValueOnce(quota());
    await expect(call()).rejects.toThrow(); state.org = "tenant-b";
    expect(await providerEnqueueHold(state.org, "routine")).toContain("billing quota or account allowance");
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
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { type: "rate_limit_error", message: "rate limited" } }), { status: 429 }));
    vi.stubGlobal("fetch", fetch);
    await VALIDATORS.openai(state.keys);
    expect(await providerEnqueueHold(state.org, "routine")).not.toBeNull();
    await VALIDATORS.openai(state.keys);
    state.budgetHeld = true;
    await expect(VALIDATORS.openai(state.keys)).rejects.toThrow("API_BUDGET");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(providerProblem(await currentProviderFacts("OpenAI"))).toContain("billing quota or account allowance");
    state.budgetHeld = false;
    fetch.mockImplementation(async () => new Response(JSON.stringify({ id: "fake", usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }));
    expect((await VALIDATORS.openai(state.keys)).ok).toBe(true);
    expect(await providerEnqueueHold(state.org, "routine")).toBeNull();
    expect((await recentAiTrouble(state.org, "OpenAI")).count).toBe(0);
    await call(); expect(state.attempts).toBe(5);
  });
  it("allows only configured fallback and records each provider independently", async () => {
    config.ai.fallback = true; state.openai.mockRejectedValueOnce(quota());
    const out = await call(); expect(out.usage.provider).toBe("Anthropic");
    expect(providerProblem(await currentProviderFacts("OpenAI"))).toContain("billing quota or account allowance");
    expect(providerProblem(await currentProviderFacts("Anthropic"))).toBeNull();
    expect(await providerEnqueueHold(state.org, "routine")).toBeNull();
    await call(); expect(state.openai).toHaveBeenCalledTimes(1); expect(state.anthropic).toHaveBeenCalledTimes(2);
    config.ai.fallback = false;
    expect(await providerEnqueueHold(state.org, "routine")).not.toBeNull();
  });
});

describe("explicit operator recovery probe", () => {
  async function holdOpenAi() {
    state.openai.mockRejectedValueOnce(quota());
    await expect(call()).rejects.toThrow();
  }
  it("retests the refused provider once, then permits ordinary work after a valid answer", async () => {
    await holdOpenAi();
    await expect(call()).rejects.toThrow();
    state.openai.mockImplementationOnce(async () => {
      expect(currentOrgId()).toBe("tenant-a");
      return ok;
    });
    await expect(probeProviderRecovery("OpenAI", "tenant-a")).resolves.toMatchObject({ text: "synthetic" });
    expect(state.openai).toHaveBeenCalledTimes(2);
    expect(state.openai.mock.calls[1][0]).toMatchObject({ model: config.openai.modelSmart, maxTokens: 16, timeoutMs: 15_000 });
    expect(state.openai.mock.calls[1][0].instructions ?? "").not.toContain(state.profile);
    expect(await providerEnqueueHold(state.org, "complex")).toBeNull();
    await call();
    expect(state.openai).toHaveBeenCalledTimes(3);
    expect(state.anthropic).not.toHaveBeenCalled();
  });
  it("does not clear a refusal or reach the provider when spending is held", async () => {
    await holdOpenAi(); state.budgetHeld = true;
    await expect(probeProviderRecovery("OpenAI", "tenant-a")).rejects.toThrow("API_BUDGET");
    expect(state.openai).toHaveBeenCalledTimes(1);
    expect(await providerEnqueueHold(state.org, "complex")).not.toBeNull();
  });
  it("keeps the refusal after a transient failure and never tries a configured fallback", async () => {
    await holdOpenAi(); config.ai.fallback = true;
    state.openai.mockRejectedValueOnce({ status: 503, message: "unavailable" });
    await expect(probeProviderRecovery("OpenAI", "tenant-a")).rejects.toThrow();
    expect(state.openai).toHaveBeenCalledTimes(2);
    expect(state.anthropic).not.toHaveBeenCalled();
    expect((await currentProviderFacts("OpenAI"))?.refusal_reason).toContain("billing quota or account allowance");
  });
  it.each([
    { text: "", stopReason: "end_turn" },
    { text: "partial", stopReason: "max_tokens" },
    { text: "ready", stopReason: null },
  ])("keeps the refusal when recovery output is not usable: %j", async output => {
    await holdOpenAi(); state.openai.mockResolvedValueOnce({ ...ok, ...output });
    await expect(probeProviderRecovery("OpenAI", "tenant-a")).rejects.toThrow();
    expect((await currentProviderFacts("OpenAI"))?.refusal_reason).toContain("billing quota or account allowance");
    await expect(call()).rejects.toThrow();
    expect(state.openai).toHaveBeenCalledTimes(2);
  });
  it("does not replace an unresolved attempt, even if its timestamp is old", async () => {
    await holdOpenAi();
    await state.db.exec("update ai_provider_facts set pending_attempt='00000000-0000-4000-8000-000000000001',pending_started_at=now()-interval '30 days'");
    await expect(probeProviderRecovery("OpenAI", "tenant-a")).rejects.toThrow("unresolved outcome");
    expect(state.openai).toHaveBeenCalledTimes(1);
  });
  it("rejects tenant mismatch before metering or transport", async () => {
    await expect(runWithOrg("tenant-b", () => probeProviderRecovery("OpenAI", "tenant-a"))).rejects.toThrow("organization");
    expect(state.attempts).toBe(0);
  });
  it("requires the named provider's key even when another provider is connected", async () => {
    delete state.keys.OPENAI_API_KEY;
    await expect(probeProviderRecovery("OpenAI", "tenant-a")).rejects.toThrow("not connected");
    expect(state.attempts).toBe(0);
    expect(state.anthropic).not.toHaveBeenCalled();
  });
  it("retests Anthropic independently and preserves an OpenAI refusal", async () => {
    await holdOpenAi(); config.ai.routineProvider = "Anthropic";
    state.anthropic.mockRejectedValueOnce({ status: 400, message: "specified API usage limits" });
    await expect(call()).rejects.toThrow();
    await expect(probeProviderRecovery("Anthropic", "tenant-a")).resolves.toMatchObject({ text: "synthetic" });
    expect((await currentProviderFacts("Anthropic"))?.refusal_reason).toBeNull();
    expect((await currentProviderFacts("OpenAI"))?.refusal_reason).not.toBeNull();
    expect(state.anthropic.mock.calls[1][0]).toMatchObject({ model: config.claude.modelSmart, max_tokens: 16, system: [] });
    expect(state.anthropic.mock.calls[1][1]).toMatchObject({ timeout: 15_000, maxRetries: 0 });
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
  it("releases its transaction before provider I/O, keeps pending health non-green, and still admits queued work", async () => {
    state.openai.mockRejectedValueOnce({ status: 429, type: "rate_limit_error", message: "rate limited" });
    await expect(call()).rejects.toThrow();
    advanceCooldown();
    await expect(probeProviderRecovery("OpenAI", state.org)).resolves.toMatchObject({ text: "synthetic" });
    let started!: () => void; let release!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    state.openai.mockImplementationOnce(async () => { started(); await wait; return ok; });
    const first = call();
    await entered;
    try {
      expect(state.transactions).toBe(0);
      expect((await state.db.query("select 1 as available")).rows[0].available).toBe(1);
      // A live call is a turn being taken, not an unresolved outcome: new work
      // may be queued behind it. The call itself still cannot overlap.
      expect(await providerEnqueueHold(state.org, "routine")).toBeNull();
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
  state.openai.mockRejectedValueOnce({ status: 429, type: "rate_limit_error", message: "rate limited" });
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
  // Older than the provider abort: nothing can still settle it.
  await state.db.query(`insert into ai_provider_facts(account_scope,provider,credential_hash,pending_attempt,pending_started_at)
    values($1,$2,$3,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now()-interval '11 minutes')`,providerScope(identity,"OpenAI"));
  expect(await providerEnqueueHold(state.org,"routine")).toContain("unresolved");
  expect(state.anthropic).not.toHaveBeenCalled();expect(state.openai).not.toHaveBeenCalled();
 });
 it("queues work behind another job's live call instead of dropping it",async()=>{
  const identity={orgId:state.org,envKey:"OPENAI_API_KEY",value:state.keys.OPENAI_API_KEY,source:state.source,accepted:false};
  await state.db.query(`insert into ai_provider_facts(account_scope,provider,credential_hash,pending_attempt,pending_started_at)
    values($1,$2,$3,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now()-interval '2 minutes')`,providerScope(identity,"OpenAI"));
  expect(await providerEnqueueHold(state.org,"routine")).toBeNull();
 });
 it("waits for another job's live call to settle, then makes its own",async()=>{
  providerBusyWait.maxMs=10_000; providerBusyWait.pollMs=20;
  try {
   let started!: () => void; let release!: () => void;
   const entered = new Promise<void>(resolve => { started = resolve; });
   const gate = new Promise<void>(resolve => { release = resolve; });
   state.openai.mockImplementationOnce(async () => { started(); await gate; return ok; });
   const first = call();
   await entered;
   const second = call();
   await new Promise(resolve => setTimeout(resolve, 100));
   expect(state.openai).toHaveBeenCalledTimes(1);
   release();
   await expect(first).resolves.toMatchObject({ text: "synthetic" });
   await expect(second).resolves.toMatchObject({ text: "synthetic" });
   expect(state.openai).toHaveBeenCalledTimes(2);
  } finally { providerBusyWait.maxMs=0; providerBusyWait.pollMs=5_000; }
 });
 it("does not wait on an attempt whose outcome is unresolved",async()=>{
  providerBusyWait.maxMs=60_000; providerBusyWait.pollMs=20;
  try {
   const identity={orgId:state.org,envKey:"OPENAI_API_KEY",value:state.keys.OPENAI_API_KEY,source:state.source,accepted:false};
   await state.db.query(`insert into ai_provider_facts(account_scope,provider,credential_hash,pending_attempt,pending_started_at)
     values($1,$2,$3,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now()-interval '11 minutes')`,providerScope(identity,"OpenAI"));
   const startedAt = Date.now();
   await expect(call()).rejects.toMatchObject({ retryable: true });
   expect(Date.now() - startedAt).toBeLessThan(5_000);
   expect(state.openai).not.toHaveBeenCalled();
  } finally { providerBusyWait.maxMs=0; providerBusyWait.pollMs=5_000; }
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

 it("holds an HTTP 429 until the probe succeeds, and holds a timeout from the fallback",async()=>{
  const work=()=>withApiUsageContext({workKey:"classify:record",relatedId:"record"},call);
  state.openai.mockRejectedValueOnce({status:429,type:"rate_limit_error",message:"rate limit"});
  await expect(work()).rejects.toMatchObject({retryable:false});
  await expect(work()).rejects.toMatchObject({retryable:false});
  expect(state.attempts).toBe(1);
  advanceCooldown();
  await expect(work()).rejects.toMatchObject({retryable:false});
  expect(state.attempts).toBe(1);
  await expect(probeProviderRecovery("OpenAI", state.org)).resolves.toMatchObject({text:"synthetic"});
  await expect(work()).resolves.toMatchObject({text:"synthetic"});
  config.ai.fallback=true;state.openai.mockRejectedValue({status:429,type:"rate_limit_error",message:"rate limit"});state.anthropic.mockRejectedValue(new Error("socket timed out"));
  const other=()=>withApiUsageContext({workKey:"classify:other",relatedId:"other"},call);
  await expect(other()).rejects.toMatchObject({retryable:false});
  const count=state.attempts;await expect(other()).rejects.toMatchObject({retryable:false});expect(state.attempts).toBe(count);
 });

 it("holds initial scoring across a differently shaped recovery payload after lost settlement ACK",async()=>{
  const run=(payload:Record<string,unknown>)=>withApiUsageContext(agentWorkIdentity("scoring-engine",payload,1),()=>complete("same work",{injectProfile:false}));
  state.failSettlementAck=true;
  await expect(run({opportunityId:"record",briefOnly:true})).rejects.toMatchObject({retryable:false});
  state.failSettlementAck=false;
  await expect(run({opportunityId:"record",trigger:"recovery"})).rejects.toMatchObject({retryable:false});
  expect(state.openai).toHaveBeenCalledTimes(1);
 });
 it("invalidates completed output for changed effective profile and route while keeping pending work held",async()=>{
  const run=()=>withApiUsageContext(agentWorkIdentity("scoring-engine",{opportunityId:"record"},1),()=>complete("same prompt"));
  state.profile="Profile A";await run();await run();expect(state.openai).toHaveBeenCalledTimes(1);
  state.profile="Profile B with changed work mode";await run();expect(state.openai).toHaveBeenCalledTimes(2);
  config.ai.routineProvider="Anthropic";await run();expect(state.anthropic).toHaveBeenCalledTimes(1);
  state.profile="Profile C";state.failSettlementAck=true;await expect(run()).rejects.toThrow();state.failSettlementAck=false;
  state.profile="Profile D";config.ai.routineProvider="OpenAI";await expect(run()).rejects.toMatchObject({retryable:false});
  expect(state.openai).toHaveBeenCalledTimes(2);
 });

it.each([{ status: 503, message: "unavailable" }, { message: "network timeout" }])("retains an ambiguous provider attempt across time and recovery: %j", async err => {
  config.ai.fallback = true;
  state.openai.mockRejectedValueOnce(err);
  await expect(call()).rejects.toThrow();
  advanceCooldown();
  await expect(call()).rejects.toThrow("unresolved outcome");
  await expect(probeProviderRecovery("OpenAI", state.org)).rejects.toThrow("unresolved outcome");
  expect(await providerEnqueueHold(state.org, "routine")).toContain("unresolved outcome");
  expect(state.openai).toHaveBeenCalledOnce();
  expect(state.anthropic).not.toHaveBeenCalled();
});
it.each(["604801", "99999999999999", "unparseable"])('does not turn an unrepresentable Retry-After %s into an automatic retry', async delay => {
  state.openai.mockRejectedValueOnce({ status: 429, type: "rate_limit_error", headers: { "retry-after": delay } });
  await expect(call()).rejects.toThrow(/rate limiting/);
  advanceCooldown();
  await expect(call()).rejects.toThrow(/rate limiting/);
  expect(state.openai).toHaveBeenCalledOnce();
  await expect(probeProviderRecovery("OpenAI", state.org)).resolves.toMatchObject({ text: "synthetic" });
  expect(await providerEnqueueHold(state.org, "routine")).toBeNull();
});
it.each([{ maxTokens: 32769 }, { maxTokens: 0 }, { responseSchema: {}, schema: {} }])("rejects local invalid failover options before creating any receipt: %j", async opts => {
  config.ai.fallback = true;
  await expect(withApiUsageContext({ workKey: "invalid-input" }, () => complete("synthetic", { ...opts, injectProfile: false } as never))).rejects.toThrow("AI failover requires");
  expect((await state.db.query("select * from ai_work_receipts")).rows).toHaveLength(0);
  expect(state.attempts).toBe(0);
});

it.each([{ status:200, message:"malformed provider response" }, new Error("ECONNRESET")])("holds unclassified provider output/transport failures without a work key: %j",async error=>{
 state.openai.mockRejectedValueOnce(error);
 await expect(call()).rejects.toThrow();
 advanceCooldown();
 await expect(call()).rejects.toThrow("unresolved outcome");
 expect(state.openai).toHaveBeenCalledOnce();
});
it.each([{content:null,usage:{input_tokens:1,output_tokens:1}}, {content:[{type:"text",text:4}],usage:{input_tokens:1,output_tokens:1}}, {content:[],usage:null}])("holds malformed Anthropic success data without a work key: %j",async response=>{
 config.ai.routineProvider="Anthropic";
 state.anthropic.mockResolvedValueOnce(response);
 await expect(call()).rejects.toThrow();
 await expect(call()).rejects.toThrow("unresolved outcome");
 expect(state.anthropic).toHaveBeenCalledOnce();
});


it("reuses completeJson receipt after real Zod parsing populates its runtime cache",async()=>{
 const {z}=await import("zod");const {completeJson}=await import("../lib/ai/claude");
 const {LEGACY_ORG_ID}=await import("../lib/tenant-context");
 const {strictJsonSchema}=await import("../lib/ai/strict-schema");
 state.org=LEGACY_ORG_ID;config.ai.brostcoFailover=true;
 const schema=z.object({ok:z.boolean()});const responseSchema=strictJsonSchema(schema);
 state.openai.mockResolvedValue({...ok,text:'{"ok":true}'});
 const work=(model?:string)=>withApiUsageContext({workKey:"json:logical"},()=>completeJson("synthetic JSON",{schema,responseSchema,injectProfile:false,model}));
 const before=JSON.stringify(schema);
 expect((await work()).data).toEqual({ok:true});
 expect(JSON.stringify(schema)).not.toBe(before);
 expect((await work("claude-haiku-4-5")).data).toEqual({ok:true});
 expect(state.openai).toHaveBeenCalledOnce();expect(state.anthropic).not.toHaveBeenCalled();
});

it.each(["refusal","content_filter","max_tokens"])("does not poison the account after known terminal %s output",async stopReason=>{
 state.openai.mockResolvedValueOnce({...ok,text:"",stopReason});
 await expect(call()).rejects.toThrow("not complete");
 expect((await currentProviderFacts("OpenAI"))?.pending_attempt).toBeNull();
 await expect(complete("unrelated synthetic work",{injectProfile:false})).resolves.toMatchObject({text:"synthetic"});
 expect(state.openai).toHaveBeenCalledTimes(2);
});

it.each(["refusal","content_filter","max_tokens"])("caches known %s completion without replay or a tenant-wide pending hold",async stopReason=>{
 const {LEGACY_ORG_ID}=await import("../lib/tenant-context");state.org=LEGACY_ORG_ID;config.ai.brostcoFailover=true;
 state.openai.mockResolvedValueOnce({...ok,text:"",stopReason});
 const work=()=>withApiUsageContext({workKey:"terminal:logical"},call);
 await expect(work()).rejects.toThrow("not complete");
 await expect(work()).rejects.toThrow("not complete");
 expect(state.openai).toHaveBeenCalledOnce();
 expect((await state.db.query("select state from ai_work_receipts")).rows).toEqual([{state:"complete"}]);
 await expect(withApiUsageContext({workKey:"unrelated"},call)).resolves.toMatchObject({text:"synthetic"});
 expect(state.openai).toHaveBeenCalledTimes(2);
});

it('a preview hold refuses real completion admission without poisoning the unrelated work receipt',async()=>{
 await state.db.query("insert into prospective_fence values('11111111-1111-4111-8111-111111111111',null)");
 const work=()=>withApiUsageContext({workKey:'unrelated-held-job',relatedId:'unrelated-record'},call);
 await expect(work()).rejects.toMatchObject({name:'ProspectiveBlockedError'});
 await expect(work()).rejects.toMatchObject({name:'ProspectiveBlockedError'});
 expect(state.openai).not.toHaveBeenCalled();
 expect(state.anthropic).not.toHaveBeenCalled();
 expect((await state.db.query('select state from ai_work_receipts')).rows).toEqual([{state:'retryable'}]);
 expect((await state.db.query('select * from ai_provider_facts')).rows).toEqual([]);
 // Synthetic fixture release; production release uses its explicit admin gate.
 await state.db.exec('delete from prospective_fence');
 await expect(work()).resolves.toMatchObject({text:'synthetic'});
 expect(state.openai).toHaveBeenCalledOnce();
});
