import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HomepageFeatureChapter } from "@/components/marketing/homepage-feature-videos";

let root: Root;
let container: HTMLElement;
const pauses = new Map<Element, number>();
beforeEach(() => {
  const { window } = parseHTML("<html><body><main></main></body></html>");
  vi.stubGlobal("window", window);
  vi.stubGlobal("self", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  Object.assign(window.HTMLElement.prototype, { pause() { pauses.set(this, (pauses.get(this) || 0) + 1); } });
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  pauses.clear();
  container = window.document.querySelector("main")! as unknown as HTMLElement;
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

describe("homepage feature chapters", () => {
  it("switches tours without replacing players and immediately pauses the outgoing video", async () => {
    await act(async () => root.render(<HomepageFeatureChapter chapter="discover" />));
    const original = container.querySelector('#tour-pipeline video')!;
    expect(container.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
    await act(async () => container.querySelector('#tour-tab-review')!.dispatchEvent(new window.Event('click', { bubbles: true })));
    expect(container.querySelector('#tour-pipeline')!.hasAttribute('hidden')).toBe(true);
    expect(container.querySelector('#tour-review')!.hasAttribute('hidden')).toBe(false);
    expect(pauses.get(original)).toBeGreaterThan(0);
    expect(container.querySelector('#tour-pipeline video')).toBe(original);
    expect(container.querySelector('#tour-tab-review')!.getAttribute('aria-selected')).toBe('true');
  });
  it("supports Home, End and arrow navigation with one tab stop and a labelled panel", async () => {
    await act(async () => root.render(<HomepageFeatureChapter chapter="coordinate" />));
    for (const [key, slug] of [['End', 'communications'], ['ArrowRight', 'subs'], ['ArrowLeft', 'communications'], ['Home', 'subs']]) {
      await act(async () => {
        const event = new window.Event('keydown', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'key', { value: key });
        container.querySelector('[role="tablist"]')!.dispatchEvent(event);
      });
      expect(container.querySelectorAll('[role="tab"][tabindex="0"]')).toHaveLength(1);
      expect(container.querySelector('[role="tab"][aria-selected="true"]')!.id).toBe(`tour-tab-${slug}`);
      expect(container.querySelector('[role="tabpanel"]:not([hidden])')!.getAttribute('aria-labelledby')).toBe(`tour-tab-${slug}`);
    }
  });
});
