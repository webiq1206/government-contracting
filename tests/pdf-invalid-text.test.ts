import { describe, expect, it, vi } from "vitest";
vi.mock("unpdf", () => ({ extractText: vi.fn(async (_bytes, options) => ({
  text: options.mergePages ? "Amount: 1\u0000000\nCafé" : ["Amount: 1\u0000000", "", "Café"], totalPages: 3,
})) }));
import { extractPdfPages, extractPdfText } from "../lib/integrations/pdf";
import { deepInboundText, decodeInboundText } from "../lib/domain/inbound-text";

describe("document text accepted by PostgreSQL", () => {
  it("normalizes structured model output before jsonb and text-array storage", () => {
    const input = { risk_flags: ["1\u0000000"], scope: { text: "Café\u0000" }, count: 3, missing: null };
    expect(deepInboundText(input)).toEqual({ risk_flags: ["1�000"], scope: { text: "Café�" }, count: 3, missing: null });
    expect(input.risk_flags[0]).toContain("\u0000");
  });
  it("decodes UTF-16 attachment bytes rather than injecting NUL between letters", () => {
    const bytes = Buffer.from("Amount: 1000", "utf16le");
    expect(decodeInboundText(bytes, "utf-16le")).toBe("Amount: 1000");
    expect(decodeInboundText(Buffer.concat([Buffer.from([255,254]), bytes]))).toBe("Amount: 1000");
  });
  it("replaces invalid NUL visibly without joining numeric fields or renumbering pages", async () => {
    expect((await extractPdfText(new Uint8Array([1]))).text).toBe("Amount: 1�000\nCafé");
    expect(await extractPdfPages(new Uint8Array([1]))).toEqual({
      pages: ["Amount: 1�000", "", "Café"], total: 3, truncated: false,
    });
  });
});
