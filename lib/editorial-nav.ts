/** Make a deep-linked control visible inside progressive disclosures. */
export function revealEditorialTarget(element: HTMLElement | null) {
  let node = element;
  while (node) {
    if (node.tagName === "DETAILS") node.setAttribute("open", "");
    node = node.parentElement;
  }
}

/**
 * Open an opportunity editorial tab then scroll to an in-page target.
 * Shared by Next Step, Coverage, and Attention deep links.
 */
export function openEditorialTarget(anchor: string) {
  const target = anchor.replace(/^#/, "");
  if (!target || typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("editorial-open-tab", { detail: { target } })
  );
  const url = new URL(window.location.href);
  url.hash = target;
  window.history.replaceState(null, "", url.toString());
  window.setTimeout(() => {
    const el =
      document.querySelector<HTMLElement>(`[data-guide-target="${target}"]`) ||
      document.getElementById(target);
    revealEditorialTarget(el);
    el?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }, 50);
}
