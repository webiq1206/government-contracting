/**
 * Which provider serves a call, and where it goes when that provider refuses.
 *
 * Pinned because the rules decide money and accuracy at once: routine work
 * on the cheaper provider, the bid-critical path on the stronger one, and an
 * organization with a single key never skipping a step it could have run.
 */
import { describe, it, expect } from "vitest";
import { chooseRoute, providerForModel, parseProvider, type RoutingConfig } from "@/lib/ai/routing";

const cfg: RoutingConfig = {
  anthropic: { model: "claude-haiku-4-5", modelSmart: "claude-sonnet-5" },
  openai: { model: "gpt-5.6-luna", modelSmart: "gpt-5.6-terra" },
  routineProvider: "OpenAI",
  complexProvider: "Anthropic",
  fallback: true,
};
const both = { Anthropic: true, OpenAI: true };

describe("chooseRoute", () => {
  it("sends routine work to the cheaper provider and complex work to the stronger one", () => {
    const routine = chooseRoute({ available: both, cfg })!;
    expect(routine.primary).toMatchObject({ provider: "OpenAI", model: "gpt-5.6-luna", complex: false });
    expect(routine.fallback).toMatchObject({ provider: "Anthropic", model: "claude-haiku-4-5", complex: false });

    const complex = chooseRoute({ complexity: "complex", available: both, cfg })!;
    expect(complex.primary).toMatchObject({ provider: "Anthropic", model: "claude-sonnet-5", complex: true });
    expect(complex.fallback).toMatchObject({ provider: "OpenAI", model: "gpt-5.6-terra", complex: true });
  });

  it("uses the one configured provider for everything, with no fallback", () => {
    const only = { Anthropic: false, OpenAI: true };
    const routine = chooseRoute({ available: only, cfg })!;
    const complex = chooseRoute({ complexity: "complex", available: only, cfg })!;
    expect(routine.primary.provider).toBe("OpenAI");
    expect(complex.primary).toMatchObject({ provider: "OpenAI", model: "gpt-5.6-terra" });
    expect(routine.fallback).toBeNull();
    expect(complex.fallback).toBeNull();
  });

  it("returns null when no provider has a key, so the step is skipped rather than attempted", () => {
    expect(chooseRoute({ available: { Anthropic: false, OpenAI: false }, cfg })).toBeNull();
  });

  it("honours an explicit model on its own provider and infers the tier from it", () => {
    const pinned = chooseRoute({ model: "claude-sonnet-5", available: both, cfg })!;
    expect(pinned.primary).toMatchObject({ provider: "Anthropic", model: "claude-sonnet-5", complex: true });
    // The fallback serves the same tier on the other provider.
    expect(pinned.fallback).toMatchObject({ provider: "OpenAI", model: "gpt-5.6-terra" });
  });

  it("treats an explicit model as a tier hint when its provider has no key", () => {
    // A caller pinning Sonnet on an OpenAI-only account still gets the
    // strong tier, rather than a skipped brief.
    const r = chooseRoute({ model: "claude-sonnet-5", available: { Anthropic: false, OpenAI: true }, cfg })!;
    expect(r.primary).toMatchObject({ provider: "OpenAI", model: "gpt-5.6-terra", complex: true });
    expect(r.fallback).toBeNull();
  });

  it("marks any non-default model as complex for the cost controls", () => {
    const r = chooseRoute({ model: "gpt-5.6-sol", available: both, cfg })!;
    expect(r.primary.complex).toBe(true);
    const plain = chooseRoute({ model: "gpt-5.6-luna", available: both, cfg })!;
    expect(plain.primary.complex).toBe(false);
  });

  it("respects the operator's tier preferences and the fallback switch", () => {
    const flipped: RoutingConfig = { ...cfg, routineProvider: "Anthropic", complexProvider: "OpenAI", fallback: false };
    expect(chooseRoute({ available: both, cfg: flipped })!.primary.provider).toBe("Anthropic");
    expect(chooseRoute({ complexity: "complex", available: both, cfg: flipped })!.primary.provider).toBe("OpenAI");
    expect(chooseRoute({ available: both, cfg: flipped })!.fallback).toBeNull();
    // A caller can refuse a fallback on its own.
    expect(chooseRoute({ available: both, cfg, fallback: false })!.fallback).toBeNull();
  });
});

describe("providerForModel / parseProvider", () => {
  it("reads the provider off the model id and keeps unknown ids with Anthropic", () => {
    expect(providerForModel("gpt-5.6-luna")).toBe("OpenAI");
    expect(providerForModel("o4-mini")).toBe("OpenAI");
    expect(providerForModel("claude-haiku-4-5")).toBe("Anthropic");
    expect(providerForModel("complex-test-model")).toBe("Anthropic");
  });
  it("accepts either spelling of a provider preference and falls back otherwise", () => {
    expect(parseProvider("openai", "Anthropic")).toBe("OpenAI");
    expect(parseProvider("Claude", "OpenAI")).toBe("Anthropic");
    expect(parseProvider("", "OpenAI")).toBe("OpenAI");
    expect(parseProvider("gemini", "Anthropic")).toBe("Anthropic");
  });
});
