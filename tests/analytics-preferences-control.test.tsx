import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ClarityAnalytics, AnalyticsPreferencesButton } from "@/components/marketing/clarity-analytics";
const mock = vi.hoisted(() => ({ allowed: vi.fn(() => true), consent: vi.fn(), page: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/today" }));
vi.mock("@/lib/client/ga4", () => ({ ANALYTICS_CHOICE_KEY: "test-choice", analyticsAllowed: mock.allowed,
  setGa4Consent: mock.consent, syncGa4Page: mock.page }));
let root: Root;
beforeEach(() => {
  const { window } = parseHTML("<html><head></head><body><main></main></body></html>");
  vi.stubGlobal("window", window); vi.stubGlobal("document", window.document);
  vi.stubGlobal("Event", window.Event); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", { getItem: () => "denied", setItem: vi.fn() });
  mock.allowed.mockReturnValue(true); mock.consent.mockClear(); mock.page.mockClear();
  root = createRoot(document.querySelector("main")!);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it("leaves no fixed overlay after a consent choice", async () => {
  await act(async () => root.render(<ClarityAnalytics />));
  expect(document.querySelector("button")).toBeNull();
  expect(document.querySelector("script")).toBeNull();
});
it("keeps consent reachable from an in-flow control without granting it", async () => {
  await act(async () => root.render(<><AnalyticsPreferencesButton /><ClarityAnalytics /></>));
  const button = document.querySelector("button")!;
  expect(button.textContent).toBe("Analytics preferences");
  expect(button.className).not.toContain("fixed");
  await act(async () => button.dispatchEvent(new window.Event("click", { bubbles: true })));
  expect(document.querySelector('[aria-label="Optional analytics"]')).not.toBeNull();
  expect(document.querySelector("script")).toBeNull();
  const decline = [...document.querySelectorAll("button")].find(node => node.textContent === "Decline")!;
  await act(async () => decline.dispatchEvent(new window.Event("click", { bubbles: true })));
  expect(document.querySelector('[aria-label="Optional analytics"]')).toBeNull();
  expect(localStorage.setItem).toHaveBeenCalledWith("test-choice", "denied");
});
it("does not bypass browser privacy signals", async () => {
  mock.allowed.mockReturnValue(false);
  await act(async () => root.render(<><AnalyticsPreferencesButton /><ClarityAnalytics /></>));
  expect(document.querySelector("button")?.disabled).toBe(true);
  expect(document.querySelector('[aria-label="Optional analytics"]')).toBeNull();
  expect(document.querySelector("script")).toBeNull();
});
