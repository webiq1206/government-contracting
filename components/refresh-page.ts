const SCROLL_KEY = "brostco:refresh-scroll";

function scrollAreas() {
  return Array.from(document.querySelectorAll<HTMLElement>("main, main *"))
    .filter(node => node.clientHeight > 100 && /auto|scroll/.test(getComputedStyle(node).overflowY));
}

/** Refresh confirmed server writes without leaving stale streamed route content. */
export function refreshPage() {
  try {
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify({
      url: location.href, at: Date.now(),
      documentTop: window.scrollY,
      focusId: document.activeElement instanceof HTMLElement ? document.activeElement.id : "",
      positions: scrollAreas().map(node => node.scrollTop),
    }));
  } catch { /* Reload still works when browser storage is unavailable. */ }
  // Let cleared form state remove its unsaved-work guard before the unload.
  requestAnimationFrame(() => setTimeout(() => location.reload(), 0));
}

/** Called once by the shared app shell after a document refresh. */
export function restorePageScroll() {
  let snapshot: { url: string; at: number; positions: number[]; documentTop?: number; focusId?: string };
  try {
    const raw = sessionStorage.getItem(SCROLL_KEY);
    sessionStorage.removeItem(SCROLL_KEY);
    if (!raw) return;
    snapshot = JSON.parse(raw);
    if (snapshot.url !== location.href || Date.now() - snapshot.at > 30_000 || !Array.isArray(snapshot.positions)) return;
  } catch { return; }
  let focusRestored = false;
  const restore = () => {
    if (Number.isFinite(snapshot.documentTop) && snapshot.documentTop! >= 0) window.scrollTo({ top: snapshot.documentTop });
    scrollAreas().forEach((node, index) => {
      const top = snapshot.positions[index];
      if (Number.isFinite(top) && top >= 0) node.scrollTop = top;
    });
    if (!focusRestored && snapshot.focusId) {
      const target = document.getElementById(snapshot.focusId);
      if (target) { target.focus({ preventScroll: true }); focusRestored = true; }
    }
  };
  // Route content may still be streaming when the shell hydrates.
  const frame = requestAnimationFrame(restore);
  const observer = new MutationObserver(restore);
  observer.observe(document.querySelector("main") ?? document.body, { childList: true, subtree: true });
  const stop = () => { cancelAnimationFrame(frame); observer.disconnect(); };
  window.addEventListener("pointerdown", stop, { once: true });
  window.addEventListener("wheel", stop, { once: true });
  window.addEventListener("keydown", stop, { once: true });
  const timer = setTimeout(() => observer.disconnect(), 2000);
  return () => {
    cancelAnimationFrame(frame); observer.disconnect(); clearTimeout(timer);
    window.removeEventListener("pointerdown", stop);
    window.removeEventListener("wheel", stop);
    window.removeEventListener("keydown", stop);
  };
}
