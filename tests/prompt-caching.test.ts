/**
 * What gets marked for caching, and in what order.
 *
 * These rules are worth pinning because breaking them costs money silently
 * rather than failing. A cache marker on a prefix that changes every call is
 * never read back, and a cache WRITE costs 25% more than ordinary input, so a
 * mis-ordered system prompt makes every call more expensive while producing
 * byte-identical output. Nothing errors, nothing looks wrong, and the only
 * symptom is a larger bill.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const PROFILE_LONG = "BROSTCO profile. ".repeat(700); // ~11,900 chars, ~3k tokens
const PROFILE_SHORT = "Tiny profile.";

let profileText = PROFILE_LONG;
const create = vi.fn(async () => ({
  content: [{ type: "text", text: "ok" }],
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2048 },
  stop_reason: "end_turn",
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));
vi.mock("../lib/ai/companyProfile", () => ({
  getProfileSystemText: async () => profileText,
}));
vi.mock("../lib/integration-keys", () => ({
  orgApiKey: async () => "sk-test",
  orgHasKey: async () => true,
  clearIntegrationKeyCache: () => {},
}));

async function callComplete(prompt: string, opts: Record<string, unknown> = {}) {
  const { complete } = await import("../lib/ai/claude");
  await complete(prompt, opts as never);
  return create.mock.calls.at(-1)?.[0] as unknown as {
    system: { type: string; text: string; cache_control?: { type: string } }[];
    messages: { content: unknown }[];
  };
}

describe("the system prompt", () => {
  beforeEach(() => {
    profileText = PROFILE_LONG;
    create.mockClear();
  });

  it("sends the profile as a cacheable block", async () => {
    const body = await callComplete("hello");
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system[0].text).toContain("BROSTCO profile");
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("puts the stable profile FIRST and the per-call text after it", async () => {
    /*
     * The whole trick. Caching matches a prefix, so the part that never
     * changes has to lead. Reversed, the prefix differs on every call and the
     * cache is written and never read.
     */
    const body = await callComplete("hello", { system: "Extract the trades." });
    expect(body.system).toHaveLength(2);
    expect(body.system[0].text).toContain("BROSTCO profile");
    expect(body.system[1].text).toContain("Extract the trades.");
    expect(body.system[1].cache_control).toBeUndefined();
  });

  it("does not mark a profile too small to be cached", async () => {
    /*
     * Below the model's minimum the marker is ignored, so writing one is a
     * pure loss: the 25% write premium with no read to recover it.
     */
    profileText = PROFILE_SHORT;
    const body = await callComplete("hello");
    expect(body.system[0].cache_control).toBeUndefined();
  });

  it("omits the profile entirely when the caller opts out", async () => {
    // Transcription does this: injecting our own marketing copy into an OCR
    // prompt is the surest way to have the model "recognize" it on the page.
    const body = await callComplete("transcribe", { injectProfile: false, system: "Read this." });
    expect(body.system).toHaveLength(1);
    expect(body.system[0].text).toBe("Read this.");
  });

  it("sends nothing at all when there is neither profile nor system text", async () => {
    const body = await callComplete("hello", { injectProfile: false });
    expect(body.system).toEqual([]);
  });
});

describe("document blocks", () => {
  beforeEach(() => {
    profileText = PROFILE_LONG;
    create.mockClear();
  });

  it("leaves a plain prompt as a plain string", async () => {
    // Every existing call site must stay byte-for-byte unchanged.
    const body = await callComplete("hello");
    expect(body.messages[0].content).toBe("hello");
  });

  it("marks only the last document, so the whole run is one prefix", async () => {
    const body = await callComplete("read these", {
      documents: [{ base64: "AAA" }, { base64: "BBB" }, { base64: "CCC" }],
    });
    const blocks = body.messages[0].content as {
      type: string;
      cache_control?: { type: string };
    }[];
    expect(blocks).toHaveLength(4); // three documents plus the prompt
    expect(blocks[0].cache_control).toBeUndefined();
    expect(blocks[1].cache_control).toBeUndefined();
    expect(blocks[2].cache_control).toEqual({ type: "ephemeral" });
    // The text block is last and is never the cache boundary.
    expect(blocks[3].type).toBe("text");
    expect(blocks[3].cache_control).toBeUndefined();
  });

  it("marks a single document", async () => {
    const body = await callComplete("read this", { documents: [{ base64: "AAA" }] });
    const blocks = body.messages[0].content as { cache_control?: { type: string } }[];
    expect(blocks[0].cache_control).toEqual({ type: "ephemeral" });
  });
});

describe("usage reporting", () => {
  beforeEach(() => {
    profileText = PROFILE_LONG;
    create.mockClear();
  });

  it("reports cache reads, so an operator can tell caching is working", async () => {
    /*
     * Writes without reads means the calls are too far apart for the cache
     * window and the write premium is being paid for nothing. That is worth
     * being able to see rather than assume.
     */
    const { complete } = await import("../lib/ai/claude");
    const res = await complete("hello");
    expect(res.usage.cache_read_input_tokens).toBe(2048);
  });
});
