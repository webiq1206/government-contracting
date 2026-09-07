import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const WORKBENCH = readFileSync("app/(dash)/workbench/page.tsx", "utf8");
const CALLS = readFileSync("app/(dash)/call-queue/page.tsx", "utf8");
const CONVERSATIONS = readFileSync("app/(dash)/communications/page.tsx", "utf8");

describe("large operational queues", () => {
  it("renders the workbench in bounded pages without hiding a deep-linked item", () => {
    expect(WORKBENCH).toContain("const QUEUE_PAGE_SIZE = 50");
    expect(WORKBENCH).toContain("filteredItems.findIndex");
    expect(WORKBENCH).toContain("Math.floor(selectedIndex / QUEUE_PAGE_SIZE) + 1");
    expect(WORKBENCH).toContain("filteredItems.slice(");
    expect(WORKBENCH).toContain('aria-label="Work queue pages"');
    expect(WORKBENCH).toContain('status={queueUnavailable ? "Queue status unavailable"');
    expect(WORKBENCH).toContain("The work queue could not be loaded");
  });

  it("renders calls in bounded pages and carries the page into the open-card link", () => {
    expect(CALLS).toContain("const CALL_PAGE_SIZE = 50");
    expect(CALLS).toContain("filteredCalls.findIndex");
    expect(CALLS).toContain('p.set("page", String(page))');
    expect(CALLS).toContain('aria-label="Call queue pages"');
  });

  it("keeps conversation counts global while search and paging only narrow the list", () => {
    expect(CONVERSATIONS).toContain("conversationList(),");
    expect(CONVERSATIONS).toContain("const counts = conversationCounts(all)");
    expect(CONVERSATIONS).toContain("const CONVERSATION_PAGE_SIZE = 50");
    expect(CONVERSATIONS).toContain("filtered.slice(");
    expect(CONVERSATIONS).toContain('aria-label="Conversation pages"');
    expect(CONVERSATIONS).toContain("Unmatched inbound messages could not be checked");
  });
});
