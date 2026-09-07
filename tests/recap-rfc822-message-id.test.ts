import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("recap delivery Message-ID persistence", () => {
  it("prefers the Internet Message-ID for every recap send path", () => {
    const sources = [
      "lib/agents/daily-recap.ts",
      "app/api/recap/test/route.ts",
      "app/api/recap/deliveries/[id]/retry/route.ts",
    ].map((path) => readFileSync(path, "utf8"));

    const writes = sources
      .flatMap((source) => source.match(/providerMessageId:[^\n]+/g) ?? []);

    expect(writes).toHaveLength(4);
    for (const write of writes) {
      expect(write).toContain("result.rfc822MessageId ?? result.messageId ?? null");
    }
  });
});
