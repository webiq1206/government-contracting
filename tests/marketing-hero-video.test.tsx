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
let play: ReturnType<typeof vi.fn>;
let pause: ReturnType<typeof vi.fn>;
let observe: (entries: { isIntersecting: boolean }[]) => void;
beforeEach(() => {
  const { window } = parseHTML("<html><body><main></main></body></html>");
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  reduced = false;
  window.matchMedia = vi.fn(() => ({
    matches: reduced,
    addEventListener: vi.fn(),
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
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
async function click(label: string) {
  await act(async () => {
    container
      .querySelector(`[aria-label="${label}"]`)!
      .dispatchEvent(new window.Event("click", { bubbles: true }));
  });
}
describe("hero background film", () => {
  it("plays the supplied muted loop and offers pause and resume", async () => {
    await act(async () => root.render(<HeroBackgroundVideo />));
    expect(container.querySelector("source")?.getAttribute("src")).toBe(
      "/marketing/hero-background.mp4",
    );
    expect(play).toHaveBeenCalledTimes(1);
    await click("Pause background video");
    expect(pause).toHaveBeenCalled();
    await click("Play background video");
    expect(play).toHaveBeenCalledTimes(2);
    await act(async () => observe([{ isIntersecting: false }]));
    const count = play.mock.calls.length;
    await act(async () => observe([{ isIntersecting: true }]));
    expect(play).toHaveBeenCalledTimes(count + 1);
  });
  it("does not request video for reduced motion", async () => {
    reduced = true;
    await act(async () => root.render(<HeroBackgroundVideo />));
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/marketing/hero-poster.jpg",
    );
    expect(play).not.toHaveBeenCalled();
  });
  it("keeps the poster if the browser blocks playback", async () => {
    play.mockRejectedValue(new Error("Playback unavailable"));
    await act(async () => root.render(<HeroBackgroundVideo />));
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")).not.toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });
});
