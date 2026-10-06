import { expect, it } from "vitest";
import { guideAnswerSources } from "@/lib/domain/guide-answer-sources";
const record = "11111111-1111-4111-8111-111111111111";
it("only accepts exact supported sections for the requested record", () => {
  const paths = ["overview", "obligations", "documents", "financials"].map(section => `/contracts/${record}#${section}`);
  const sources = paths.map(href => ({ label: "Saved contract evidence", href }));
  expect(guideAnswerSources(sources, `/contracts/${record}`)).toHaveLength(4);
  expect(guideAnswerSources(sources, "/today")).toEqual([]);
  for (const href of ["//evil.test", "javascript:alert(1)", "/admin/accounts", "/today?secret=x", `${paths[0]}/../admin`, "/%2fadmin/accounts"]) {
    expect(guideAnswerSources([{ label: "Bad", href }], `/contracts/${record}`)).toEqual([]);
  }
});
it("rejects malformed values and bounds plain-text labels without inventing links", () => {
  expect(guideAnswerSources(null, "/today")).toEqual([]);
  expect(guideAnswerSources([null, {}, { label: 1, href: "/today" }, { label: " ", href: "/today" }], "/today")).toEqual([]);
  const result = guideAnswerSources([{ label: "x".repeat(500), href: "/today" }, { label: "duplicate", href: "/today" }], "/today");
  expect(result).toHaveLength(1); expect(result[0].label).toHaveLength(300);
});
