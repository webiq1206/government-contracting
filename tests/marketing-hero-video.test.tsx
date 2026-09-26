import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    <img src={src} alt={alt} />
  ),
}));
import { HeroBackgroundVideo } from "@/components/marketing/hero-background-video";
let root: Root;
let container: HTMLElement;
let reduced = false;
let mobile = false;
let motionChange: () => void;
let play: ReturnType<typeof vi.fn>;
let pause: ReturnType<typeof vi.fn>;
let observe: (entries: { isIntersecting: boolean }[]) => void;
beforeEach(() => {
  vi.useFakeTimers();
  const { window } = parseHTML("<html><body><main></main></body></html>");
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  reduced = false;
  mobile = false;
  window.matchMedia = vi.fn((query: string) => ({
    get matches() { return query.includes("max-width") ? mobile : reduced; },
    addEventListener: (_name: string, listener: () => void) => { motionChange = listener; },
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
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
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
  Object.assign(window.HTMLElement.prototype, { play, pause });
  container = window.document.querySelector("main")! as unknown as HTMLElement;
  root = createRoot(container);
});
async function renderLoadedHero() {
  await act(async () => root.render(<HeroBackgroundVideo />));
  await act(async () => window.dispatchEvent(new window.Event("load")));
  await act(async () => vi.advanceTimersByTime(2000));
}
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("hero background film", () => {
  it("does not mount decorative video before the page loads and settles", async () => {
    await act(async () => root.render(<HeroBackgroundVideo />));
    expect(container.querySelector("video")).toBeNull();
    await act(async () => window.dispatchEvent(new window.Event("load")));
    await act(async () => vi.advanceTimersByTime(1999));
    expect(container.querySelector("video")).toBeNull();
    await act(async () => vi.advanceTimersByTime(1));
    expect(container.querySelector("video")).not.toBeNull();
  });
  it("does not interrupt playback with a time limit", async () => {
    vi.useFakeTimers();
    await renderLoadedHero();
    await act(async () => container.querySelector('video')!.dispatchEvent(new window.Event('playing')));
    pause.mockClear();
    await act(async () => vi.advanceTimersByTime(4500));
    expect(pause).not.toHaveBeenCalled();
    const count = play.mock.calls.length;
    await act(async () => observe([{ isIntersecting: false }]));
    await act(async () => observe([{ isIntersecting: true }]));
    expect(play).toHaveBeenCalledTimes(count + 1);
  });
  it("loops after page load and resumes on re-entry without losing its position", async () => {
    await renderLoadedHero();
    expect(container.querySelector("source")?.getAttribute("src")).toBe(
      "/marketing/hero-background.mp4?v=20260916-full",
    );
    expect(play).toHaveBeenCalledTimes(1);
    expect(container.querySelector("video")?.hasAttribute("loop")).toBe(true);
    expect(container.querySelector("video")?.getAttribute("preload")).toBe("none");
    expect(container.querySelector("button")?.textContent).toContain("Pause background animation");
    await act(async () => observe([{ isIntersecting: false }]));
    const count = play.mock.calls.length;
    await act(async () => observe([{ isIntersecting: true }]));
    expect(play).toHaveBeenCalledTimes(count + 1);
    const video = container.querySelector("video")!;
    Object.defineProperty(video, "currentTime", { value: 8 });
    pause.mockClear();
    await act(async () => video.dispatchEvent(new window.Event("timeupdate")));
    expect(pause).not.toHaveBeenCalled();
    await act(async () => observe([{ isIntersecting: false }]));
    expect(pause).toHaveBeenCalled();
    const stoppedCount = play.mock.calls.length;
    await act(async () => observe([{ isIntersecting: true }]));
    expect(play).toHaveBeenCalledTimes(stoppedCount + 1);
    expect(video.currentTime).toBe(8);
  });
  it("does not request video for reduced motion", async () => {
    reduced = true;
    await renderLoadedHero();
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/marketing/hero-poster-full.jpg",
    );
    expect(play).not.toHaveBeenCalled();
  });
  it("keeps phones on the poster without downloading a background video", async () => {
    mobile = true;
    await renderLoadedHero();
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")).not.toBeNull();
    expect(play).not.toHaveBeenCalled();
  });
  it("keeps video unloaded for data saving and responds to motion changes", async () => {
    vi.stubGlobal("navigator", { connection: { saveData: true } });
    await renderLoadedHero();
    expect(container.querySelector("video")).toBeNull();
    expect(play).not.toHaveBeenCalled();
    vi.stubGlobal("navigator", {});
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderLoadedHero();
    expect(container.querySelector("video")).not.toBeNull();
    reduced = true;
    await act(async () => motionChange());
    expect(container.querySelector("video")).toBeNull();
    reduced = false;
    await act(async () => motionChange());
    expect(container.querySelector("video")).not.toBeNull();
  });
  it("pauses in a hidden tab and resumes when the tab returns", async () => {
    await renderLoadedHero();
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    await act(async () => document.dispatchEvent(new window.Event("visibilitychange")));
    expect(pause).toHaveBeenCalled();
    const count = play.mock.calls.length;
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    await act(async () => document.dispatchEvent(new window.Event("visibilitychange")));
    expect(play).toHaveBeenCalledTimes(count + 1);
  });
  it("keeps the poster when the video source cannot load", async () => {
    await renderLoadedHero();
    await act(async () => container.querySelector("source")!.dispatchEvent(new window.Event("error")));
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")).not.toBeNull();
  });
  it("keeps the poster if the browser blocks playback", async () => {
    play.mockRejectedValue(new Error("Playback unavailable"));
    await renderLoadedHero();
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")).not.toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });
});
