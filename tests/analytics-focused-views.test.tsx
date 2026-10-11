import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AnalyticsFilterLink, AnalyticsMobileNav, AnalyticsSection } from "@/components/analytics-mobile";
let root: Root;
beforeEach(() => {
  const { window } = parseHTML("<html><body><main></main></body></html>");
  vi.stubGlobal("window", window); vi.stubGlobal("document", window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); root = createRoot(document.querySelector("main")!);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it("focuses the same existing report values across sizes without duplicating them", async () => {
  await act(async () => root.render(<AnalyticsMobileNav sections={[
    { id: "overview", label: "Overview" }, { id: "pipeline", label: "Pipeline" },
    { id: "win-performance", label: "Win performance" }, { id: "revenue", label: "Revenue" },
  ]} filters={<AnalyticsFilterLink href="/analytics?range=30&by=trade&view=overview">Last 30 days</AnalyticsFilterLink>}>
    <AnalyticsSection id="overview"><p id="count">Open opportunities: 12</p></AnalyticsSection>
    <AnalyticsSection id={["overview", "pipeline"]}><p id="pipeline">Recorded pipeline value: unknown</p></AnalyticsSection>
    <AnalyticsSection id={["overview", "win-performance"]}><p id="wins">Win rate: no decided bids</p></AnalyticsSection>
    <AnalyticsSection id="revenue"><p id="revenue">Active contract revenue: $10</p><p id="forecast">Projection, not a balance</p></AnalyticsSection>
  </AnalyticsMobileNav>));
  const visible = (id: string) => !document.getElementById(id)?.closest("[hidden]");
  expect(visible("count")).toBe(true); expect(visible("forecast")).toBe(false);
  const controls = document.querySelector('[aria-label="Report view"]')!;
  expect(controls.className).not.toContain("lg:hidden");
  for (const [label, shown] of [["Revenue", "revenue"], ["Pipeline", "pipeline"], ["Win performance", "wins"]]) {
    const button = [...controls.querySelectorAll("button")].find(node => node.textContent === label)!;
    await act(async () => button.dispatchEvent(new window.Event("click", { bubbles: true })));
    expect(button.getAttribute("aria-pressed")).toBe("true"); expect(visible(shown)).toBe(true);
    expect(visible("count")).toBe(false);
    expect(document.querySelectorAll(`#${shown}`)).toHaveLength(1);
    expect(document.getElementById(shown)?.parentElement?.className).not.toContain("lg:block");
    const href = new URL(document.querySelector("a")!.getAttribute("href")!, "https://workspace.invalid");
    expect(href.searchParams.get("view")).toBe(button.textContent === "Win performance" ? "win-performance" : shown);
    expect(href.searchParams.get("range")).toBe("30");
    expect(href.searchParams.get("by")).toBe("trade");
  }
});
it.each([["pipeline", "pipeline"], ["unknown", "overview"], [undefined, "overview"]])(
  "initializes a valid report view and rejects unknown values (%s)", async (initialSection, expected) => {
    await act(async () => root.render(<AnalyticsMobileNav initialSection={initialSection} sections={[
      { id: "overview", label: "Overview" }, { id: "pipeline", label: "Pipeline" },
    ]}><AnalyticsSection id="overview"><p id="overview">Overview data</p></AnalyticsSection>
      <AnalyticsSection id="pipeline"><p id="pipeline">Pipeline data</p></AnalyticsSection>
    </AnalyticsMobileNav>));
    expect(document.getElementById(expected!)?.closest("[hidden]")).toBeNull();
    expect(document.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
  }
);
