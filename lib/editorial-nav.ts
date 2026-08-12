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
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 50);
}
