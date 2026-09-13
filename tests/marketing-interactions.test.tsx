import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WorkflowDemo } from "@/components/marketing/workflow-demo";
let root: Root;
let container: HTMLElement;
beforeEach(() => {
  const { window } = parseHTML(
    "<!doctype html><html><body><main></main></body></html>",
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = window.document.querySelector("main")! as unknown as HTMLElement;
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
async function click(control: Element) {
  await act(async () => {
    control.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
}
describe("interactive sample workflow", () => {
  it("opens the source and changes stages without showing live data or performing a send", async () => {
    await act(async () => root.render(<WorkflowDemo />));
    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    await click(tabs[2]);
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("2 of 3 quotes received");
    const source = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Open sample source"),
    )!;
    await click(source);
    expect(source.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain(
      "It is not an actual solicitation or a live AI result",
    );
    await click(tabs[4]);
    const review = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Try marking"),
    )!;
    await click(review);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "No live record was changed",
    );
    await click(review);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
  it("moves between tabs with arrow keys and keeps one tab in the Tab order", async () => {
    await act(async () => root.render(<WorkflowDemo />));
    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    await act(async () => {
      const event = new window.Event("keydown", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "key", { value: "End" });
      tabs[0].dispatchEvent(event);
    });
    expect(tabs[4].getAttribute("aria-selected")).toBe("true");
    expect(
      tabs.filter((tab) => tab.getAttribute("tabindex") === "0"),
    ).toHaveLength(1);
    expect(
      container
        .querySelector('[role="tabpanel"]')
        ?.getAttribute("aria-labelledby"),
    ).toBe(tabs[4].id);
  });
});
