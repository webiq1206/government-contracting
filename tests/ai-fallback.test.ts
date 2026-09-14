/**
 * The choke point with two providers behind it.
 *
 * What is pinned: routine work lands on the cheaper provider and complex
 * work on the stronger one; a provider refusing for an account or service
 * reason is retried once on the other, visibly; our own bad request and a
 * local budget hold are never "fixed" by switching providers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runWithOrg } from "../lib/tenant-context";

const TEST_ORG = "00000000-0000-4000-8000-000000000098";
const state = vi.hoisted(() => ({
  keys: { ANTHROPIC_API_KEY: "sk-ant", OPENAI_API_KEY: "sk-oa" } as Record<string, string>,
  blocked: false,
  metered: [] as { provider: string; model: string; complex: boolean | undefined }[],
  recordUse: vi.fn(),
}));

const anthropicCreate = vi.fn();
const openAi = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: anthropicCreate }; } }));
vi.mock("../lib/ai/openai", async (orig) => ({
  ...(await orig<typeof import("../lib/ai/openai")>()),
  openAiResponse: (...args: unknown[]) => openAi(...args),
}));
vi.mock("../lib/ai/companyProfile", () => ({ getProfileSystemText: async () => "Tiny profile." }));
vi.mock("../lib/tenant", () => ({ resolveTenantOrgId: async () => TEST_ORG }));
vi.mock("../lib/integration-settings", () => ({ recordIntegrationUse: state.recordUse }));
vi.mock("../lib/integration-keys", () => ({
  orgApiKey: async (key: string) => state.keys[key] ?? "",
  orgHasKey: async (key: string) => Boolean(state.keys[key]),
  clearIntegrationKeyCache: () => {},
}));
vi.mock("../lib/api-usage/ledger", () => ({
  requestIdentity: async (envKey: string) => ({ orgId: TEST_ORG, envKey }),
  metered: async (_i: unknown, provider: string, model: string, _f: string, execute: () => Promise<unknown>, _d: unknown, options: { complex?: boolean }) => {
    if (state.blocked) {
      const error = new Error("API_BUDGET: Work is paused.");
      error.name = "ApiUsageBlockedError";
      throw error;
    }
    state.metered.push({ provider, model, complex: options?.complex });
    return execute();
  },
}));

const anthropicOk = { content: [{ type: "text", text: "from claude" }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: "end_turn" };
const openAiOk = { id: "resp", text: "from openai", usage: { input_tokens: 8, cached_input_tokens: 2, output_tokens: 4, reasoning_tokens: 0 }, stopReason: "end_turn" };
const overloaded = { status: 529, message: "529 overloaded", error: { error: { type: "overloaded_error", message: "Overloaded" } } };

async function call(prompt: string, opts: Record<string, unknown> = {}) {
  const { complete } = await import("../lib/ai/claude");
  return runWithOrg(TEST_ORG, () => complete(prompt, opts as never));
}

beforeEach(() => {
  state.keys = { ANTHROPIC_API_KEY: "sk-ant", OPENAI_API_KEY: "sk-oa" };
  state.blocked = false;
  state.metered = [];
  state.recordUse.mockClear();
  anthropicCreate.mockReset().mockResolvedValue(anthropicOk);
  openAi.mockReset().mockResolvedValue(openAiOk);
});

describe("routing through complete()", () => {
  it("runs routine work on OpenAI's routine model and complex work on Claude's strong model", async () => {
    const { config } = await import("../lib/config");
    const routine = await call("Summarize a note");
    expect(routine.text).toBe("from openai");
    expect(routine.usage).toMatchObject({ provider: "OpenAI", model: config.openai.model, cache_read_input_tokens: 2 });
    expect(state.metered.at(-1)).toEqual({ provider: "OpenAI", model: config.openai.model, complex: false });

    const complex = await call("Analyze bid compliance", { complexity: "complex" });
    expect(complex.usage).toMatchObject({ provider: "Anthropic", model: config.claude.modelSmart });
    expect(state.metered.at(-1)).toEqual({ provider: "Anthropic", model: config.claude.modelSmart, complex: true });
  });

  it("passes the tier's reasoning effort and the JSON flag to OpenAI", async () => {
    const { config } = await import("../lib/config");
    const { completeJson } = await import("../lib/ai/claude");
    openAi.mockResolvedValueOnce({ ...openAiOk, text: '{"ok":true}' });
    await runWithOrg(TEST_ORG, () => completeJson("give json"));
    const req = openAi.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(req.json).toBe(true);
    expect(req.effort).toBe(config.openai.reasoningRoutine);
    expect(req.cacheKey).toBe(`brostco:${TEST_ORG}`);
    expect(req.instructions).toContain("Tiny profile.");
  });

  it("serves every tier from the one key an organization has", async () => {
    const { config } = await import("../lib/config");
    state.keys = { OPENAI_API_KEY: "sk-oa" };
    const complex = await call("Analyze", { complexity: "complex" });
    expect(complex.usage).toMatchObject({ provider: "OpenAI", model: config.openai.modelSmart });
    expect(anthropicCreate).not.toHaveBeenCalled();
    // A caller that pinned a Claude model gets the same tier here too.
    const pinned = await call("Analyze", { model: config.claude.modelSmart });
    expect(pinned.usage).toMatchObject({ provider: "OpenAI", model: config.openai.modelSmart });
  });

  it("skips cleanly when no provider has a key", async () => {
    state.keys = {};
    const { ClaudeNotConfiguredError } = await import("../lib/ai/claude");
    await expect(call("hello")).rejects.toBeInstanceOf(ClaudeNotConfiguredError);
  });
});

describe("fallback", () => {
  it("retries once on the other provider when the primary refuses, and says so in the usage", async () => {
    anthropicCreate.mockRejectedValueOnce(overloaded);
    const res = await call("Analyze", { complexity: "complex" });
    expect(res.text).toBe("from openai");
    expect(res.usage.fallback_from).toBe("Anthropic");
    expect(state.metered.map((m) => m.provider)).toEqual(["Anthropic", "OpenAI"]);
    // Both outcomes reach the Integrations cards: Anthropic broken, OpenAI
    // working. The record is fire-and-forget behind two lazy imports, so wait
    // for it rather than assuming one tick is enough.
    const uses = () => state.recordUse.mock.calls.map(([key, o]) => [key, o.ok]);
    await vi.waitFor(() => {
      expect(uses()).toContainEqual(["ANTHROPIC_API_KEY", false]);
      expect(uses()).toContainEqual(["OPENAI_API_KEY", true]);
    });
  });

  it("falls back the other way too", async () => {
    openAi.mockRejectedValueOnce({ status: 429, code: "insufficient_quota", message: "429 You exceeded your current quota" });
    const res = await call("Summarize");
    expect(res.text).toBe("from claude");
    expect(res.usage.fallback_from).toBe("OpenAI");
  });

  it("names both failures, classified as the primary's, when the fallback fails as well", async () => {
    const { ClaudeUnavailableError } = await import("../lib/ai/claude");
    anthropicCreate.mockRejectedValueOnce(overloaded);
    openAi.mockRejectedValueOnce({ status: 503, message: "503 down" });
    const err = await call("Analyze", { complexity: "complex" }).catch((e) => e);
    expect(err).toBeInstanceOf(ClaudeUnavailableError);
    expect(err.message).toMatch(/AI_UNAVAILABLE:/);
    expect(err.reason).toMatch(/Anthropic returned a server error/);
    expect(err.reason).toMatch(/OpenAI fallback also failed/);
  });

  it("does not switch providers for our own bad request", async () => {
    anthropicCreate.mockRejectedValueOnce({ status: 400, message: "400 bad", error: { error: { type: "invalid_request_error", message: "messages: at least one message is required" } } });
    await expect(call("Analyze", { complexity: "complex" })).rejects.toMatchObject({ status: 400 });
    expect(openAi).not.toHaveBeenCalled();
  });

  it("does not switch providers around a local spending hold", async () => {
    state.blocked = true;
    await expect(call("Analyze", { complexity: "complex" })).rejects.toThrow("API_BUDGET");
    expect(anthropicCreate).not.toHaveBeenCalled();
    expect(openAi).not.toHaveBeenCalled();
    expect(state.recordUse).not.toHaveBeenCalled();
  });

  it("can be refused per call, which is what a provider self-test needs", async () => {
    const { ClaudeUnavailableError } = await import("../lib/ai/claude");
    anthropicCreate.mockRejectedValueOnce(overloaded);
    await expect(call("Analyze", { complexity: "complex", fallback: false })).rejects.toBeInstanceOf(ClaudeUnavailableError);
    expect(openAi).not.toHaveBeenCalled();
  });
});
