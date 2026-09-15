import { describe, expect, it } from "vitest";
import { recordPage } from "@/lib/domain/record-pagination";

describe("work queue pagination", () => {
  it("keeps every record reachable without rendering the entire queue", () => {
    const seen: number[] = [];
    for (let page = 1; page <= recordPage(477, "1", 20).pages; page++) {
      const range = recordPage(477, String(page), 20);
      expect(range.end - range.start).toBeLessThanOrEqual(20);
      for (let index = range.start; index < range.end; index++) seen.push(index);
    }
    expect(seen).toEqual(Array.from({length: 477}, (_, i) => i));
  });
  it("recovers from stale page numbers after records disappear", () => {
    expect(recordPage(13, "40")).toMatchObject({page: 2, start: 12, end: 13});
    expect(recordPage(0, "40")).toMatchObject({page: 1, start: 0, end: 0});
  });
  it.each([undefined, null, ["2"], "-1", "NaN", "Infinity", "1.5", "99999999999999999999"])("handles invalid URL state %j", value => {
    expect(recordPage(40, value).page).toBe(1);
  });
});
