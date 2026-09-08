"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";

/** Keyboard containment for a modal that intentionally has no dismiss action. */
export function BlockingDialog({
  labelledBy,
  className,
  children,
}: {
  labelledBy: string;
  className: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const first = panel.current?.querySelector<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
    );
    first?.focus();
  }, []);

  const trap = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      panel.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
      ) ?? []
    ).filter((item) => item.getClientRects().length > 0);
    if (focusable.length === 0) {
      event.preventDefault();
      panel.current?.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      tabIndex={-1}
      onKeyDown={trap}
      className={className}
    >
      {children}
    </div>
  );
}
