import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act, StrictMode } from "react";
import type { Root } from "react-dom/client";
import { BidScorecard, CapabilityBuilder, ComplianceMatrix } from "@/components/marketing/free-tools";
import { marketingEvent } from "@/lib/client/marketing-event";

vi.mock("@/lib/client/marketing-event", () => ({ marketingEvent: vi.fn() }));
let root: Root;
let container: HTMLElement;
beforeEach(async () => {
  const { window } = parseHTML("<!doctype html><html><body><main></main></body></html>");
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // React's text-input detection runs when react-dom is first imported.
  document.documentElement.setAttribute("oninput", "");
  Object.defineProperty(document, "oninput", { configurable: true, value: null });
  const { createRoot } = await import("react-dom/client");
  container = document.querySelector("main")!;
  root = createRoot(container);
  vi.mocked(marketingEvent).mockClear();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-export");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.useFakeTimers();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.runOnlyPendingTimers();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function click(control: Element) {
  await act(async () => { control.dispatchEvent(new window.Event("click", { bubbles: true })); });
}
function button(text: string) {
  return Array.from(container.querySelectorAll("button")).find(b => b.textContent?.includes(text))!;
}
function completions() {
  return vi.mocked(marketingEvent).mock.calls.filter(([event]) => event === "tool_completed");
}
async function choose(index: number, choice = 0) {
  const input = container.querySelectorAll("fieldset")[index].querySelectorAll("input")[choice];
  input.checked = true;
  await click(input);
}
async function fill(control: HTMLTextAreaElement, text: string) {
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(control, text);
  await act(async () => { control.dispatchEvent(new window.Event("input", { bubbles: true })); });
}

describe("completed free-tool use", () => {
  it("counts all seven answered checks once, including unknowns and blockers, then permits an explicit reset", async () => {
    await act(async () => root.render(<StrictMode><BidScorecard /></StrictMode>));
    expect(button("Download").disabled).toBe(true);
    for (let i = 0; i < 6; i++) await choose(i);
    expect(completions()).toHaveLength(0);
    await choose(6, 2);
    expect(button("Download").disabled).toBe(false);
    expect(completions()).toEqual([["tool_completed", { location: "content" }]]);
    await choose(0, 1);
    await click(button("Download"));
    await click(button("Download"));
    expect(completions()).toHaveLength(1);
    expect(container.textContent).toContain("Resolve a critical blocker");
    await click(button("Clear answers"));
    expect(button("Download").disabled).toBe(true);
    for (let i = 0; i < 7; i++) await choose(i, 2);
    expect(completions()).toHaveLength(2);
  });

  it("counts a capability preparation once across edits and repeated submits, without collecting fields", async () => {
    await act(async () => root.render(<StrictMode><CapabilityBuilder /></StrictMode>));
    for (const textarea of container.querySelectorAll<HTMLTextAreaElement>("textarea[required]")) {
      await fill(textarea, "Private company details");
    }
    const submit = async () => { await act(async () => { container.querySelector("form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); }); };
    await submit(); await submit();
    await fill(container.querySelector("textarea")!, "Revised private company details");
    await submit();
    expect(completions()).toEqual([["tool_completed", { location: "content" }]]);
    expect(container.querySelector("pre")?.textContent).toContain("Revised private company details");
    await click(button("Clear all fields"));
    for (const textarea of container.querySelectorAll<HTMLTextAreaElement>("textarea[required]")) await fill(textarea, "New worksheet");
    await submit();
    expect(completions()).toHaveLength(2);
  });

  it("counts the first nonempty matrix export, not row entry or repeat downloads", async () => {
    await act(async () => root.render(<StrictMode><ComplianceMatrix /></StrictMode>));
    expect(button("Download").disabled).toBe(true);
    await fill(container.querySelector("textarea")!, "Confidential requirement");
    expect(completions()).toHaveLength(0);
    expect(button("Download").disabled).toBe(false);
    await click(button("Download")); await click(button("Download"));
    expect(completions()).toEqual([["tool_completed", { location: "content" }]]);
    expect(vi.mocked(marketingEvent).mock.calls.filter(([event]) => event === "resource_download")).toHaveLength(2);
    await click(button("Clear row"));
    expect(button("Download").disabled).toBe(true);
    await fill(container.querySelector("textarea")!, "Second requirement");
    await click(button("Download"));
    expect(completions()).toHaveLength(2);
  });
});
