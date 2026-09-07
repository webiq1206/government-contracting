import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BidBrief } from "@/components/bid-brief";
import { buildNoticeBrief } from "@/lib/domain/notice-brief";

describe("database dates in the opportunity brief", () => {
  it("renders a native PostgreSQL timestamp without crashing the detail page", () => {
    const brief = buildNoticeBrief({ deadline: new Date("2026-09-11T17:00:00Z") });
    expect(() => renderToStaticMarkup(<BidBrief analysis={brief} documents={[]} />)).not.toThrow();
    expect(brief.due_date).toBe("2026-09-11T17:00:00.000Z");
    expect(brief.key_dates[0]?.date).toBe(brief.due_date);
  });

  it("keeps an invalid database date unknown instead of inventing a deadline", () => {
    const brief = buildNoticeBrief({ deadline: new Date("invalid") });
    expect(brief.key_dates).toEqual([]);
    expect(brief.due_date).toContain("Not specified");
    expect(() => renderToStaticMarkup(<BidBrief analysis={brief} documents={[]} />)).not.toThrow();
  });

  it("tolerates an older stored brief containing a Date value", () => {
    const brief = buildNoticeBrief({});
    brief.key_dates = [{ label: "Deadline", date: new Date("2026-09-11T17:00:00Z") as never }];
    expect(renderToStaticMarkup(<BidBrief analysis={brief} documents={[]} />)).toContain("Sep 11, 2026");
  });
});
