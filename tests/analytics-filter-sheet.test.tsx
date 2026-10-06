import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AnalyticsFilterSheet } from "@/components/analytics-mobile";
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
let root: Root, active: Element | null;
const showModal = vi.fn(function (this: HTMLElement) { this.setAttribute("open", ""); });
beforeEach(() => {
  const { window } = parseHTML("<html><body><main></main></body></html>");
  vi.stubGlobal("window", window); vi.stubGlobal("document", window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  active = null; showModal.mockClear();
  Object.defineProperty(document, "activeElement", { configurable: true, get: () => active });
  Object.assign(window.HTMLElement.prototype, { showModal,
    close() { this.removeAttribute("open"); }, focus() { active = this; },
    getClientRects() { return [{ width: 100, height: 44 }]; } });
  root = createRoot(document.querySelector("main")!);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
async function click(node: Element) { await act(async () => node.dispatchEvent(new window.Event("click", { bubbles: true }))); }
async function key(node: Element, key: string, shiftKey = false) {
  const event = new window.Event("keydown", { bubbles: true, cancelable: true });
  Object.defineProperties(event, { key: { value: key }, shiftKey: { value: shiftKey } });
  await act(async () => node.dispatchEvent(event));
}
it("opens a native modal, keeps its trigger, traps keyboard focus, and restores it on close", async () => {
  await act(async () => root.render(<AnalyticsFilterSheet range="30" by="trade" comparison={null} />));
  const trigger = document.querySelector("main button")! as HTMLButtonElement;
  trigger.focus(); await click(trigger);
  const dialog = document.querySelector("dialog")!;
  expect(dialog).not.toBeNull(); expect(showModal).toHaveBeenCalledOnce();
  expect(trigger.isConnected).toBe(true); expect(trigger.getAttribute("aria-expanded")).toBe("true");
  const close = dialog.querySelector("button")! as HTMLButtonElement;
  const apply = dialog.querySelector("a")! as HTMLAnchorElement;
  expect(active).toBe(close); expect(document.body.style.overflow).toBe("hidden");
  await key(close, "Tab", true); expect(active).toBe(apply);
  await key(apply, "Tab"); expect(active).toBe(close);
  await key(close, "Escape"); expect(document.querySelector("dialog")).toBeNull();
  expect(active).toBe(trigger); expect(document.body.style.overflow).not.toBe("hidden");
  await click(trigger); await click(document.querySelector("dialog button")!);
  expect(active).toBe(trigger);
});
