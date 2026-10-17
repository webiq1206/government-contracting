import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("recap delivery Message-ID persistence", () => {
  it("prefers the Internet Message-ID for every recap send path", () => {
    const sources = [
      "lib/agents/daily-recap.ts",
      "app/api/recap/test/route.ts",
      "app/api/recap/deliveries/[id]/retry/route.ts",
    ].map((path) => readFileSync(path, "utf8"));

    for (const source of sources) {
      expect(source).toContain("result.rfc822MessageId ?? result.messageId ?? null");
    }
    const writes = sources
      .flatMap((source) => source.match(/providerMessageId:[^\n]+/g) ?? []);
    expect(writes.length).toBeGreaterThanOrEqual(4);
    const daily = sources[0];
    expect(daily).toContain("const failure = messageId ? null");
  });
});
