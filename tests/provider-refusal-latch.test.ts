import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { describeClaudeFailure } from "@/lib/ai/claude";
import { describeOpenAiFailure } from "@/lib/ai/openai";
import { classifyFailure } from "@/lib/domain/automation-health";
import { PROVIDER_LATCH_CAUSES } from "@/lib/domain/incident";

const advance = vi.hoisted(() => vi.fn());
const query = vi.hoisted(() => vi.fn());
const IllegalTransition = vi.hoisted(() => {
  return class IllegalTransition extends Error {
    constructor() {
      super("illegal");
      this.name = "IllegalTransition";
    }
  };
});

vi.mock("@/lib/db", () => ({ query }));
vi.mock("@/lib/incidents", () => ({ advance, IllegalTransition }));

import { resolveProviderIncidents } from "@/lib/provider-incident-resolve";

function claude(status: number | null, message: string, type?: string) {
  return { status, message, error: { error: { type, message } } };
}

describe("every provider refusal latches for the probe", () => {
  it.each([
    ["Anthropic credit", claude(400, "credit balance is too low"), false, "provider_credit"],
    ["Anthropic usage limit", claude(400, "specified API usage limits"), false, "provider_credit"],
    ["Anthropic billing", claude(400, "billing allowance exhausted"), false, "provider_credit"],
    ["Anthropic auth", claude(401, "invalid"), false, "provider_auth"],
    ["Anthropic forbidden", claude(403, "forbidden"), false, "provider_auth"],
    ["Anthropic rate limit", claude(429, "rate limited", "rate_limit_error"), false, "provider_rate_limit"],
    ["Anthropic overload", claude(529, "overloaded", "overloaded_error"), true, "provider_unavailable"],
    ["Anthropic outage", claude(503, "server error"), true, "provider_unavailable"],
    ["Anthropic network", { message: "fetch failed" }, true, "network"],
  ] as const)("%s", (_name, err, retryable, cause) => {
    const described = describeClaudeFailure(err);
    expect(described?.retryable).toBe(retryable);
    if (!retryable) expect(PROVIDER_LATCH_CAUSES).toContain(classifyFailure(described?.reason));
    expect(classifyFailure(described?.reason ?? "")).toBe(cause);
  });

  it.each([
    ["OpenAI key", { status: 401, code: "invalid_api_key", message: "bad" }, false, "provider_auth"],
    ["OpenAI credit", { status: 402, code: "credit_balance_exhausted", message: "none" }, false, "provider_credit"],
    ["OpenAI quota", { status: 429, code: "insufficient_quota", message: "quota" }, false, "provider_credit"],
    ["OpenAI rate code", { status: 429, code: "rate_limit_exceeded", message: "slow" }, false, "provider_rate_limit"],
    ["OpenAI slow down", { status: 429, code: "slow_down", message: "slow" }, false, "provider_rate_limit"],
    ["OpenAI rate type", { status: 429, type: "rate_limit_error", message: "limited" }, false, "provider_rate_limit"],
    ["OpenAI generic 429", { status: 429, message: "no" }, false, "provider_rate_limit"],
    ["OpenAI generic 403", { status: 403, message: "no" }, false, "provider_refusal"],
    ["OpenAI outage", { status: 503, message: "down" }, true, "provider_unavailable"],
    ["OpenAI network", { message: "ECONNREFUSED", name: "Error" }, true, "network"],
  ] as const)("%s", (_name, err, retryable, cause) => {
    const described = describeOpenAiFailure(err);
    expect(described?.retryable).toBe(retryable);
    if (!retryable) expect(PROVIDER_LATCH_CAUSES).toContain(classifyFailure(described?.reason));
    expect(classifyFailure(described?.reason ?? "")).toBe(cause);
  });
});

describe("a successful call closes the incident record", () => {
  it("walks a backlog row to recovered and leaves a scoring stall alone", async () => {
    query.mockResolvedValueOnce([
      { id: "credit", state: "backlog_requeued" },
      { id: "probe", state: "detected" },
    ]);
    advance.mockResolvedValue({});
    const closed = await resolveProviderIncidents("org-1", "OpenAI");
    expect(closed).toBe(2);
    const sql = String(query.mock.calls[0][0]);
    const params = query.mock.calls[0][1] as unknown[];
    expect(sql).toContain("state <> 'recovered'");
    expect(params[1]).toEqual([...PROVIDER_LATCH_CAUSES]);
    expect(params[2]).toBe("provider_refusal:openai");
    expect(params).not.toContain("scoring_stall");
    const steps = advance.mock.calls.map((call) => (call[0] as { incidentId: string; to: string }).to);
    expect(steps).toEqual([
      "backlog_draining",
      "recovered",
      "provider_restored",
      "test_passed",
      "recovered",
    ]);
    const recovered = advance.mock.calls.filter((call) => (call[0] as { to: string }).to === "recovered");
    expect(recovered).toHaveLength(2);
    expect((recovered[0][0] as { set: { recoveryNote: string } }).set.recoveryNote).toContain("incident is closed");
  });

  it("does not count a row it could not finish", async () => {
    query.mockResolvedValueOnce([{ id: "stuck", state: "test_passed" }]);
    advance.mockRejectedValueOnce(new IllegalTransition());
    await expect(resolveProviderIncidents("org-1", "Anthropic")).resolves.toBe(0);
  });
});

describe("the latch has one writer and the probe is allowed through", () => {
  const read = (path: string) => readFileSync(path, "utf8");

  it("clears and sets the refusal only inside provider facts, and closes the incident after a success", () => {
    const facts = read("lib/ai/provider-facts.ts");
    expect(facts).toContain("resolveProviderIncidents");
    expect(facts).toMatch(/if \(success\)/);
    expect(facts).toContain("recoveryTest");
    const writers = ["lib/ai/provider-facts.ts"];
    for (const file of [
      "lib/agents/provider-recovery-probe.ts",
      "lib/agents/sources-sought-responder.ts",
      "lib/ai/claude.ts",
      "lib/ai/openai.ts",
    ]) {
      expect(read(file)).not.toMatch(/refusal_reason\s*=/);
      writers.push(file);
    }
    expect(writers[0]).toBe("lib/ai/provider-facts.ts");
    const probe = read("lib/ai/claude.ts");
    expect(probe).toContain("return runRoute(route, [], \"Reply with the single word: ready. Nothing else.\", opts, true)");
  });

  it("checks the provider hold before the spending memo, and still schedules the probe when agents are disabled", () => {
    const admission = read("lib/queue/ai-admission.ts");
    const holdAt = admission.indexOf("providerEnqueueHold");
    const memoAt = admission.indexOf("memo.get");
    expect(holdAt).toBeGreaterThan(0);
    expect(holdAt).toBeLessThan(memoAt);
    expect(admission.slice(holdAt, memoAt)).toContain("if (providerHold) return providerHold");
    expect(read("lib/agents/runner.ts")).toContain(
      'def.name !== "ai-provider-recovery-probe" && config.worker.disabledAgents.includes(def.name)'
    );
    expect(read("worker/scheduler.ts")).toContain('s.agent.name === "ai-provider-recovery-probe"');
  });

  it("sends Sources Sought through the same completion latch", () => {
    const agent = read("lib/agents/sources-sought-responder.ts");
    expect(agent).toContain("worksWithoutClaude: false");
    expect(agent).toContain("completeJson");
    expect(agent).not.toMatch(/refusal_reason\s*=/);
    const runner = read("lib/agents/runner.ts");
    expect(runner).toContain("if (orgId && !def.worksWithoutClaude)");
    expect(runner).toContain("providerRouteRefusal");
  });

  it("re-queues incomplete scores from manual recovery and from the probe with the same key", () => {
    const manual = read("lib/recovery.ts");
    const probe = read("lib/agents/provider-recovery-probe.ts");
    const run = read("lib/domain/provider-recovery-run.ts");
    const key = read("lib/domain/provider-recovery.ts");
    expect(key).toContain("return `rescore:${opportunityId}:${incidentId}`");
    expect(manual).toContain("incomplete_scoring");
    expect(manual).toContain("rescoreKey");
    expect(manual).toContain('trigger: "provider-recovery"');
    expect(probe).toContain("incomplete_scoring");
    expect(probe).toContain('trigger: "provider-recovery"');
    expect(probe).toContain("singletonKey");
    expect(run).toContain("rescoreKey(row.id, incident.id)");
    expect(run).toContain("eligibleForRescore");
  });
});
