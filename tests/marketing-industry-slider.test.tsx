import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IndustrySlider } from "@/components/marketing/industry-slider";
import { INDUSTRIES } from "@/components/marketing/industry-content";
let root: Root;
let container: HTMLElement;
let scrollTo: ReturnType<typeof vi.fn>;
let observe: (entries: { isIntersecting: boolean }[]) => void;
let motionChange: () => void;
let motion: {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};
beforeEach(async () => {
  const { window } = parseHTML(
    "<!doctype html><html><body><main></main></body></html>",
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  motion = {
    matches: false,
    addEventListener: vi.fn((_, callback) => {
      motionChange = callback;
    }),
    removeEventListener: vi.fn(),
  };
  window.matchMedia = vi.fn(
    () => motion,
  ) as unknown as typeof window.matchMedia;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: typeof observe) {
        observe = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  container = window.document.querySelector("main")! as unknown as HTMLElement;
  root = createRoot(container);
  await act(async () => root.render(<IndustrySlider />));
  const track = container.querySelector(".bco-industry-track")! as HTMLElement;
  Object.defineProperties(track, {
    clientWidth: { value: 320 },
    scrollWidth: { value: 320 * INDUSTRIES.length },
    scrollLeft: { value: 0, writable: true },
  });
  Array.from(track.children).forEach((card, index) =>
    Object.defineProperty(card, "offsetLeft", { value: index * 320 }),
  );
  scrollTo = vi.fn(({ left }: { left: number }) => {
    track.scrollLeft = left;
    track.dispatchEvent(new window.Event("scroll"));
  });
  track.scrollTo = scrollTo;
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function click(selector: string) {
  await act(async () => {
    container
      .querySelector(selector)!
      .dispatchEvent(new window.Event("click", { bubbles: true }));
  });
}
describe("industry slider", () => {
  it("allows every sector to be reached and wraps at the end without navigating away", async () => {
    expect(
      container
        .querySelector('[aria-label="Previous industries"]')
        ?.hasAttribute("disabled"),
    ).toBe(true);
    for (let index = 1; index < INDUSTRIES.length; index++) {
      await click('[aria-label="Next industries"]');
      expect(scrollTo).toHaveBeenLastCalledWith({
        left: index * 320,
        behavior: "smooth",
      });
    }
    await click('[aria-label="Next industries"]');
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: "smooth" });
  });
  it("pauses playback on focus and when reduced motion is requested", async () => {
    vi.useFakeTimers();
    await act(async () => observe([{ isIntersecting: true }]));
    await click('[aria-label="Play industry slider"]');
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    await act(async () => {
      container
        .querySelector(".bco-industry-track")!
        .dispatchEvent(new window.Event("focusin", { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(8000);
    });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    await click('[aria-label="Play industry slider"]');
    await act(async () => {
      motion.matches = true;
      motionChange();
    });
    expect(
      container.querySelector('[aria-label="Play industry slider"]'),
    ).not.toBeNull();
    await click('[aria-label="Next industries"]');
    expect(scrollTo).toHaveBeenLastCalledWith({
      left: 640,
      behavior: "instant",
    });
  });
});
