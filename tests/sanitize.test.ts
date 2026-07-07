import { describe, it, expect } from "vitest";
import { noEmDash, deepNoEmDash } from "../lib/sanitize";

describe("noEmDash", () => {
  it("turns a spaced em dash in prose into a comma", () => {
    expect(noEmDash("The scope covers HVAC — including controls.")).toBe(
      "The scope covers HVAC, including controls."
    );
  });
  it("turns an unspaced em dash into a hyphen", () => {
    expect(noEmDash("phase 1—phase 2")).toBe("phase 1-phase 2");
  });
  it("handles en dashes and ranges too", () => {
    expect(noEmDash("10–20 units")).toBe("10-20 units");
  });
  it("leaves clean text untouched", () => {
    const clean = "No dashes here, just commas and periods.";
    expect(noEmDash(clean)).toBe(clean);
  });
  it("removes every em dash even with multiple", () => {
    const out = noEmDash("a — b — c—d");
    expect(out).not.toContain("—");
    expect(out).not.toContain("–");
  });
});

describe("deepNoEmDash", () => {
  it("strips em dashes from every string in a nested object", () => {
    const input = {
      title: "Signed SF-1449 — offer form",
      items: ["cover letter — draft", { note: "sign here — required" }],
      count: 3,
      ok: true,
    };
    const out = deepNoEmDash(input);
    expect(JSON.stringify(out)).not.toContain("—");
    expect(out.count).toBe(3);
    expect(out.ok).toBe(true);
    expect(out.title).toBe("Signed SF-1449, offer form");
  });
});
