import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ProductVideo } from "@/components/marketing/product-video";

let root: Root;
let container: HTMLElement;
let phone = false;
const pauses = new Map<Element, number>();
const observers = new Map<Element, (entries: { isIntersecting: boolean }[]) => void>();
beforeEach(() => {
  const { window } = parseHTML("<!doctype html><html><body><main></main></body></html>");
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("CustomEvent", window.CustomEvent);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  phone = false;
  pauses.clear(); observers.clear();
  window.matchMedia = vi.fn(() => ({ matches: phone })) as unknown as typeof window.matchMedia;
  Object.assign(window.HTMLElement.prototype, { pause() { pauses.set(this, (pauses.get(this) || 0) + 1); } });
  vi.stubGlobal("IntersectionObserver", class {
    element?: Element;
    constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
    observe(element: Element) { this.element = element; observers.set(element, this.callback); }
    disconnect() { if (this.element) observers.delete(this.element); }
  });
  container = window.document.querySelector("main")! as unknown as HTMLElement;
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
const tour = (slug = "pipeline") => <ProductVideo slug={slug} poster="/fallback.jpg" title={slug} />;

describe("recorded product video", () => {
  it("uses versioned desktop footage, captions and native controls without autoplay", async () => {
    await act(async () => root.render(tour()));
    const video = container.querySelector("video")!;
    expect(video.getAttribute("preload")).toBe("none");
    expect(video.hasAttribute("controls")).toBe(true);
    expect(video.hasAttribute("autoplay")).toBe(false);
    expect(video.querySelector("source")?.getAttribute("src")).toContain("/pipeline.mp4?v=");
    expect(video.getAttribute("poster")).toContain("pipeline-desktop.jpg?v=");
    expect(video.querySelector("track")?.getAttribute("src")).toContain("pipeline.vtt?v=");
  });
  it("chooses native phone footage and keeps the selection after viewport changes", async () => {
    phone = true;
    await act(async () => root.render(tour()));
    const video = container.querySelector("video")!;
    expect(video.getAttribute("data-format")).toBe("mobile");
    expect(video.querySelector("source")?.getAttribute("src")).toContain("pipeline-mobile.mp4");
    phone = false;
    await act(async () => root.render(tour()));
    expect(container.querySelector("video")).toBe(video);
  });
  it("pauses other tours when playback starts", async () => {
    await act(async () => root.render(<>{tour()}{tour("review")}</>));
    const [first, second] = container.querySelectorAll("video");
    await act(async () => first.dispatchEvent(new window.Event("play", { bubbles: true })));
    expect(pauses.get(first) || 0).toBe(0);
    expect(pauses.get(second)).toBe(1);
  });
  it("pauses offscreen and hidden-page playback and cleans up observers", async () => {
    await act(async () => root.render(tour()));
    const video = container.querySelector("video")!;
    observers.get(video)!([{ isIntersecting: false }]);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new window.Event("visibilitychange"));
    expect(pauses.get(video)).toBe(2);
    await act(async () => root.render(null));
    expect(observers.size).toBe(0);
  });
  it("leaves an untouched offscreen player idle until the visitor starts it", async () => {
    await act(async () => root.render(tour()));
    const video = container.querySelector("video")!;
    Object.defineProperty(video, "paused", { configurable: true, value: true });
    observers.get(video)!([{ isIntersecting: false }]);
    document.dispatchEvent(new window.CustomEvent("brostco:product-play", { detail: null }));
    expect(pauses.get(video) || 0).toBe(0);
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    observers.get(video)!([{ isIntersecting: false }]);
    expect(pauses.get(video)).toBe(1);
  });
  it("provides a transcript and replaces a failed player on retry", async () => {
    await act(async () => root.render(tour()));
    const video = container.querySelector("video")!;
    await act(async () => video.querySelector("source")!.dispatchEvent(new window.Event("error")));
    expect(container.querySelector('[role="alert"] a')?.getAttribute("href")).toBe("/demos/pipeline.txt");
    await act(async () => container.querySelector("button")!.dispatchEvent(new window.Event("click", { bubbles: true })));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector("video")).not.toBe(video);
    expect(observers.has(video)).toBe(false);
  });
});
