import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StickyColumn } from "@/components/marketing/sticky-column";
let root: Root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
describe("desktop sticky copy", () => {
  it("releases content when it becomes taller than the usable viewport", async () => {
    const { window } = parseHTML("<html><body><main></main></body></html>");
    vi.stubGlobal("window", window);
    vi.stubGlobal("document", window.document);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.innerHeight = 900;
    let resize = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const container = window.document.querySelector("main")!;
    root = createRoot(container as unknown as HTMLElement);
    await act(async () =>
      root.render(<StickyColumn>Section heading and description</StickyColumn>),
    );
    const column = container.firstElementChild!;
    let height = 360;
    column.getBoundingClientRect = () => ({ height }) as DOMRect;
    await act(async () => resize());
    expect(column.getAttribute("data-sticky-fit")).toBe("true");
    height = 850;
    await act(async () => resize());
    expect(column.getAttribute("data-sticky-fit")).toBe("false");
    height = 360;
    window.innerHeight = 420;
    await act(async () => window.dispatchEvent(new window.Event("resize")));
    expect(column.getAttribute("data-sticky-fit")).toBe("false");
  });
});
