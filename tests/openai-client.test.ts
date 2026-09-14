/**
 * The OpenAI request shape and the reading of its failures.
 *
 * Worth pinning for the same reason as the Anthropic ones: a wrong parameter
 * is a 400 on every call, a mis-read usage object is a wrong bill, and an
 * exhausted quota mistaken for a rate limit sends the owner to wait for
 * something that will never clear.
 */
import { describe, it, expect, vi } from "vitest";
import {
  buildOpenAiBody,
  parseOpenAiResponse,
  describeOpenAiFailure,
  normalizeReasoningEffort,
  openAiResponse,
  OpenAiApiError,
} from "@/lib/ai/openai";

const base = { apiKey: "sk-test", model: "gpt-5.6-luna", instructions: "Profile text", prompt: "Score this", maxTokens: 1000 };

describe("buildOpenAiBody", () => {
  it("sends instructions, the prompt as input_text, and never stores the exchange", () => {
    const body = buildOpenAiBody(base) as any;
    expect(body.model).toBe("gpt-5.6-luna");
    expect(body.instructions).toBe("Profile text");
    expect(body.input).toEqual([{ role: "user", content: [{ type: "input_text", text: "Score this" }] }]);
    expect(body.store).toBe(false);
    expect(body.max_output_tokens).toBe(1000);
  });

  it("carries PDFs inline as data URLs ahead of the prompt", () => {
    const body = buildOpenAiBody({ ...base, documents: [{ base64: "AAA" }, { base64: "BBB" }] }) as any;
    const content = body.input[0].content;
    expect(content).toHaveLength(3);
    expect(content[0]).toEqual({ type: "input_file", filename: "document-1.pdf", file_data: "data:application/pdf;base64,AAA" });
    expect(content[2].type).toBe("input_text");
  });

  it("uses reasoning effort, not temperature, on reasoning models and grants headroom when reasoning is on", () => {
    const off = buildOpenAiBody({ ...base, effort: "none", temperature: 0.2 }) as any;
    expect(off.reasoning).toEqual({ effort: "none" });
    expect(off.temperature).toBeUndefined();
    expect(off.max_output_tokens).toBe(1000);

    const on = buildOpenAiBody({ ...base, model: "gpt-5.6-terra", effort: "medium", reasoningHeadroom: 500 }) as any;
    expect(on.reasoning).toEqual({ effort: "medium" });
    expect(on.max_output_tokens).toBe(1500);
  });

  it("sends temperature and no reasoning block to a non-reasoning model", () => {
    const body = buildOpenAiBody({ ...base, model: "gpt-4.1-mini", effort: "none", temperature: 0.3 }) as any;
    expect(body.reasoning).toBeUndefined();
    expect(body.temperature).toBe(0.3);
  });

  it("switches on JSON mode and the cache key only when asked", () => {
    const plain = buildOpenAiBody(base) as any;
    expect(plain.text).toBeUndefined();
    expect(plain.prompt_cache_key).toBeUndefined();
    const json = buildOpenAiBody({ ...base, json: true, cacheKey: "brostco:org" }) as any;
    expect(json.text).toEqual({ format: { type: "json_object" } });
    expect(json.prompt_cache_key).toBe("brostco:org");
  });
});

describe("normalizeReasoningEffort", () => {
  it("spells no-reasoning the way each model generation expects", () => {
    expect(normalizeReasoningEffort("gpt-5", "none")).toBe("minimal");
    expect(normalizeReasoningEffort("gpt-5-mini", "none")).toBe("minimal");
    expect(normalizeReasoningEffort("gpt-5.6-luna", "minimal")).toBe("none");
    expect(normalizeReasoningEffort("gpt-5.6-terra", "medium")).toBe("medium");
    expect(normalizeReasoningEffort("gpt-4.1-mini", "medium")).toBeNull();
  });
});

describe("parseOpenAiResponse", () => {
  it("reads the assistant text and splits cached input out of the token count", () => {
    const r = parseOpenAiResponse({
      id: "resp_1",
      status: "completed",
      output: [
        { type: "reasoning" },
        { type: "message", content: [{ type: "output_text", text: '{"ok":' }, { type: "output_text", text: "true}" }] },
      ],
      usage: { input_tokens: 3000, output_tokens: 120, input_tokens_details: { cached_tokens: 2048 }, output_tokens_details: { reasoning_tokens: 40 } },
    });
    expect(r.text).toBe('{"ok":true}');
    expect(r.usage).toEqual({ input_tokens: 952, cached_input_tokens: 2048, output_tokens: 120, reasoning_tokens: 40 });
    expect(r.stopReason).toBe("end_turn");
  });

  it("reports a cut-off answer as max_tokens so the JSON retry can raise the budget", () => {
    const r = parseOpenAiResponse({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] });
    expect(r.stopReason).toBe("max_tokens");
  });
});

describe("describeOpenAiFailure", () => {
  const err = (status: number | null, code: string | null, message: string) => new OpenAiApiError(message, status, code, null, null);

  it("names a rejected key", () => {
    const d = describeOpenAiFailure(err(401, "invalid_api_key", "Incorrect API key provided"))!;
    expect(d.reason).toMatch(/rejected the API key/);
    expect(d.retryable).toBe(false);
  });

  it("tells an exhausted quota apart from a rate limit, though both arrive as 429", () => {
    const quota = describeOpenAiFailure(err(429, "insufficient_quota", "You exceeded your current quota, please check your plan and billing details."))!;
    expect(quota.reason).toMatch(/insufficient credit/);
    expect(quota.retryable).toBe(false);
    const limit = describeOpenAiFailure(err(429, "rate_limit_exceeded", "Rate limit reached"))!;
    expect(limit.reason).toMatch(/rate limiting/);
    expect(limit.retryable).toBe(true);
  });

  it("treats outages and network failures as worth retrying", () => {
    expect(describeOpenAiFailure(err(503, null, "overloaded"))!.retryable).toBe(true);
    expect(describeOpenAiFailure(new TypeError("fetch failed"))!.reason).toMatch(/Could not reach OpenAI/);
  });

  it("returns null for our own bad request", () => {
    expect(describeOpenAiFailure(err(400, "invalid_value", "Unsupported parameter: temperature"))).toBeNull();
    expect(describeOpenAiFailure(new Error("no JSON found in response"))).toBeNull();
  });
});

describe("openAiResponse", () => {
  it("turns a non-2xx reply into a typed error carrying status and code", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: "quota", code: "insufficient_quota", type: "insufficient_quota" } }), { status: 429, headers: { "x-request-id": "req_1" } }));
    await expect(openAiResponse(base, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({ status: 429, code: "insufficient_quota", requestId: "req_1" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
  });

  it("returns the parsed completion on success", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "resp_2", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "ready" }] }], usage: { input_tokens: 5, output_tokens: 1 } }), { status: 200 }));
    const r = await openAiResponse(base, fetchImpl as unknown as typeof fetch);
    expect(r).toMatchObject({ id: "resp_2", text: "ready", stopReason: "end_turn" });
  });
});
