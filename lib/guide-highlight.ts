/**
 * Briefly highlight a region on the current page so Guide Me can teach by
 * pointing, not only by describing. Prefer data-guide-target, then #id.
 */

const RING =
  "outline outline-2 outline-offset-2 outline-accent transition-[outline-color] duration-300";

export function highlightGuideTarget(target: string | undefined | null): boolean {
  if (typeof document === "undefined" || !target) return false;
  const cleaned = target.replace(/^#/, "").trim();
  if (!cleaned) return false;

  // Reveal editorial tab panels that contain this target before scrolling.
  window.dispatchEvent(
    new CustomEvent("editorial-open-tab", { detail: { target: cleaned } })
  );

  const run = () => {
    const el =
      document.querySelector<HTMLElement>(`[data-guide-target="${cleaned}"]`) ||
      document.getElementById(cleaned);
    if (!el) return false;

    // Skip if still inside a hidden panel (tab switch pending a frame).
    const panel = el.closest<HTMLElement>("[data-editorial-panel]");
    if (panel?.hidden || panel?.classList.contains("hidden")) return false;

    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add(...RING.split(" "));
    window.setTimeout(() => {
      el.classList.remove(...RING.split(" "));
    }, 2600);
    return true;
  };

  if (run()) return true;
  window.setTimeout(() => {
    run();
  }, 50);
  return true;
}
