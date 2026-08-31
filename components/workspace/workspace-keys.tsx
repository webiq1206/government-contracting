"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { matchesCombo, shouldRunPlainKey } from "@/lib/domain/keyboard";

/**
 * Keyboard for the queues, in one place.
 *
 * Every surface in this product that a person works through in a rhythm --
 * decisions, calls, replies, compliance renewals -- was mouse-only. Forty
 * decisions is forty round trips between the row and the button, and the hand
 * never leaves the trackpad. The whole point of a queue you can hold in the
 * keyboard is that the next item arrives without being asked for.
 *
 * The bindings are deliberately few and deliberately boring:
 *
 *   J / down    the next item
 *   K / up      the previous item
 *   Esc         back to the list (and, on a phone, out of the record)
 *
 * Anything that CHANGES a record is not here. Those live on the control that
 * does the changing, registered through `useWorkspaceShortcut`, so a shortcut
 * cannot outlive the button it belongs to and no key ever acts on a record the
 * screen is not showing.
 */

export function QueueKeys({
  prevHref,
  nextHref,
  /** Where Esc goes. The list without a selection, normally. */
  closeHref,
}: {
  prevHref?: string | null;
  nextHref?: string | null;
  closeHref?: string | null;
}) {
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!shouldRunPlainKey(e, e.target as HTMLElement | null)) return;
      const k = e.key;
      if ((k === "j" || k === "J" || k === "ArrowDown") && nextHref) {
        e.preventDefault();
        router.push(nextHref);
      } else if ((k === "k" || k === "K" || k === "ArrowUp") && prevHref) {
        e.preventDefault();
        router.push(prevHref);
      } else if (k === "Escape" && closeHref) {
        e.preventDefault();
        router.push(closeHref);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, prevHref, nextHref, closeHref]);

  return null;
}

/**
 * One record-changing shortcut, owned by the control it fires.
 *
 * `combo` is written the way it is shown: "mod+Enter" for Command on a Mac and
 * Control everywhere else. Registering from inside the button means the
 * binding disappears with the button, which is the property that matters:
 * there is no way for "approve" to still be bound after the thing being
 * approved has left the screen.
 */
export function useWorkspaceShortcut(
  combo: string | null | undefined,
  run: () => void,
  enabled = true
) {
  useEffect(() => {
    if (!combo || !enabled) return;

    function onKey(e: KeyboardEvent) {
      if (!matchesCombo(combo!, e, e.target as HTMLElement | null)) return;
      e.preventDefault();
      run();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [combo, run, enabled]);
}

/**
 * The shortcut, written where the hand can see it.
 *
 * A keyboard nobody is told about is a keyboard nobody uses, and a hint that
 * lives in a help popover is a hint nobody reads. These sit in the header of
 * the queue they drive.
 */
export function KeyHint({ keys, label }: { keys: string; label: string }) {
  return (
    /*
      * Desktop only. A phone has no J, no K and no Escape, so on a narrow
      * screen these are three chips of pure noise sitting between the header
      * and the first row of the queue.
      */
    <span className="hidden items-center gap-1.5 rounded border border-border/60 px-1.5 py-0.5 text-[11px] text-muted-foreground lg:inline-flex dark:border-white/10">
      <kbd className="num font-sans font-medium text-foreground">{keys}</kbd>
      {label}
    </span>
  );
}
