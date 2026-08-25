"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A side panel for the record you are looking at, without leaving the list.
 *
 * The pattern it replaces: click a row, navigate to a detail page, read two
 * fields, press Back, lose your filters and your scroll position, find the
 * next row again. On a page whose job is triage that loop is the whole task,
 * repeated forty times.
 *
 * So the drawer is deliberately NOT a route. The list stays mounted behind it
 * with its filters and scroll intact, and closing it costs nothing. Anything
 * that genuinely needs a page of its own still gets one: the drawer carries a
 * link to the full record rather than trying to be it.
 *
 * Accessibility is not decoration here. Operators work these lists with the
 * keyboard all day, so Escape closes, focus moves into the panel on open and
 * returns to whatever opened it on close, and the panel is labelled by its own
 * heading.
 */
export function ContextDrawer({
  open,
  onClose,
  title,
  /** One line under the title: which record this is, not what the panel does. */
  subtitle,
  /** The single action this record most likely needs. */
  primaryAction,
  /** "Open the full record", when there is more than a drawer can hold. */
  fullRecordHref,
  fullRecordLabel = "Open the full record",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  primaryAction?: ReactNode;
  fullRecordHref?: string;
  fullRecordLabel?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    // Remember what opened this, so closing returns the operator to their place
    // in the list rather than to the top of the document.
    returnFocusTo.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      returnFocusTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/*
        The scrim closes on click but is not the only way out: a pointer-only
        dismissal strands anyone working from the keyboard, which is why Escape
        is handled above and the panel carries its own Close button.
      */}
      <div
        className="absolute inset-0 bg-ink/30 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="context-drawer-title"
        tabIndex={-1}
        className="relative flex h-full w-full max-w-md flex-col border-l border-border bg-surface shadow-xl outline-none sm:max-w-lg"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2
              id="context-drawer-title"
              className="truncate font-display text-base font-semibold text-foreground"
            >
              {title}
            </h2>
            {subtitle != null && subtitle !== "" && (
              <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost shrink-0 text-xs"
            aria-label="Close panel"
          >
            Close
          </button>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>

        {(primaryAction || fullRecordHref) && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-background px-4 py-3 sm:px-5">
            {primaryAction}
            {fullRecordHref && (
              <a
                href={fullRecordHref}
                className="btn-ghost ml-auto text-xs"
                // The drawer holds what you need to decide; the page holds
                // everything. Naming the difference stops it growing into a
                // second, worse copy of the record page.
              >
                {fullRecordLabel}
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
