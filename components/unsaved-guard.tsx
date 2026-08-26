"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Stops a click from throwing away work somebody has not saved.
 *
 * `beforeunload` alone is not this. It fires when the tab closes, the page is
 * refreshed, or an address is typed, and it does not fire at all for an in-app
 * navigation, which is how people actually leave a page: they click Today in
 * the sidebar. The company profile had that guard and lost a filled-in form to
 * one sidebar click with no prompt, which is the commonest way to lose work in
 * this product and the one nothing was watching.
 *
 * So this covers both: the browser's own prompt for a hard unload, and a
 * capture-phase click handler for every link inside the application.
 *
 * What it deliberately does not cover is the browser's Back button. Guarding
 * that means pushing a sentinel history entry and unwinding it, which goes
 * wrong in ways that trap somebody on a page they are trying to leave. A
 * missing guard costs an edit; a broken one costs the exit.
 */
export function UnsavedGuard({
  when,
  message = "You have unsaved changes on this page. Leave without saving?",
}: {
  /** True while there is work that would be lost. */
  when: boolean;
  message?: string;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!when) return;

    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Browsers ignore custom text here and show their own wording. Setting
      // it is still what makes the prompt appear at all.
      e.returnValue = "";
    };

    const onClick = (e: MouseEvent) => {
      // A modified click opens somewhere else and leaves this page alone.
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target as Element | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href") ?? "";
      // Anything that is not an ordinary in-app path: a mail link, an external
      // site, a jump to an anchor on this page.
      if (!href.startsWith("/")) return;

      const next = new URL(href, window.location.origin);
      if (next.origin !== window.location.origin) return;
      // Staying on the same page (a filter, a drawer, a tab) keeps the form
      // mounted and its state intact, so there is nothing to warn about.
      if (next.pathname === window.location.pathname) return;

      e.preventDefault();
      e.stopPropagation();
      if (window.confirm(message)) router.push(next.pathname + next.search);
    };

    window.addEventListener("beforeunload", warn);
    // Capture, so this runs before the router's own handler claims the click.
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", onClick, true);
    };
  }, [when, message, router]);

  return null;
}
