"use client";

import { useEffect, type ReactNode } from "react";
import { useKeyboardViewport } from "./use-keyboard-viewport";
import { restorePageScroll } from "./refresh-page";
import { usePathname } from "next/navigation";
import { recordParent } from "@/lib/navigation";

/** Shared application shell. The document owns vertical scrolling. */
export function AppViewport({ children }: { children: ReactNode }) {
  const keyboard = useKeyboardViewport();
  const focusMode = Boolean(recordParent(usePathname()));
  useEffect(restorePageScroll, []);
  useEffect(() => {
    if (!keyboard) return;
    const frame = requestAnimationFrame(() => {
      (document.activeElement as HTMLElement | null)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [keyboard]);

  return (
    <div
      data-app-shell
      data-focus-mode={focusMode}
      data-keyboard-open={keyboard ? "true" : undefined}
      className="flex min-h-dvh min-w-0 flex-col bg-background lg:flex-row"
    >
      {children}
    </div>
  );
}
