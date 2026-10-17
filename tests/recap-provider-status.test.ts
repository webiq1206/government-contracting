import { describe, expect, it } from "vitest";
import { providerStatusLine, type ProviderStatusFact } from "@/lib/domain/provider-status-line";
import { renderRecapText } from "@/lib/domain/recap/email";
import { buildRecap } from "@/lib/domain/recap/sections";
import { DEFAULT_RECAP_SETTINGS } from "@/lib/domain/recap/types";
import { emptyFacts } from "./helpers/recap-facts";

const NOW = new Date("2026-08-30T13:00:00Z");

function row(over: Partial<ProviderStatusFact> = {}): ProviderStatusFact {
  return {
    provider: "OpenAI",
    refusalReason: null,
    heldSince: null,
    nextProbeAt: null,
    lastProbeAt: null,
    lastProbeOk: null,
    ...over,
  };
}

describe("the daily recap provider line", () => {
  it("says when a refusal is held and when the last probe succeeded", () => {
    expect(
      providerStatusLine([
        row({
          refusalReason: "allowance reached",
          heldSince: "2026-10-16T12:00:00.000Z",
          nextProbeAt: "2026-10-16T18:00:00.000Z",
        }),
      ])
    ).toBe(
      "AI providers: OpenAI: refusal held since 2026-10-16T12:00:00.000Z. Next probe at 2026-10-16T18:00:00.000Z."
    );
    expect(
      providerStatusLine([
        row({ lastProbeAt: "2026-10-16T18:10:00.000Z", lastProbeOk: true }),
        row({ provider: "Anthropic", lastProbeAt: "2026-10-16T18:10:00.000Z", lastProbeOk: false }),
      ])
    ).toContain("OpenAI: healthy. Last probe at 2026-10-16T18:10:00.000Z succeeded.");
    expect(providerStatusLine([])).toBe("AI providers: status was not recorded.");
  });

  it("keeps a healthy provider from turning a quiet day into a problem", () => {
    const recap = buildRecap(
      emptyFacts({
        providerStatuses: [row({ provider: "Anthropic" })],
      }),
      DEFAULT_RECAP_SETTINGS,
      {
        scope: "org",
        localDate: "2026-08-29",
        timezone: "America/Denver",
        dayLabel: "Saturday, August 29",
        now: NOW,
        ages: {},
        partial: false,
      }
    );
    expect(recap.quiet).toBe(true);
    expect(recap.urgentCount).toBe(0);
    expect(recap.providerStatus).toBe("AI providers: Anthropic: healthy.");
    const text = renderRecapText(recap, { appUrl: "https://app.example.com" });
    expect(text).toContain("Anthropic: healthy.");
  });
});
