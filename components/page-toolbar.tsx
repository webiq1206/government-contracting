import type { CSSProperties, ReactNode } from "react";

/**
 * Compact secondary chrome under PageHeader (search, filters, chips).
 * Pinned via page-shell shrink-0; keep padding tight so it does not
 * dominate the mobile viewport.
 */
export function PageToolbar({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`shrink-0 border-b border-border/55 bg-background px-4 py-2 dark:border-white/10 sm:px-6 ${className}`}
    >
      {children}
    </div>
  );
}

/** Horizontally scrollable chip/filter row for narrow screens. */
export function PageToolbarChips({
  children,
  className = "",
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 ${className}`}
      style={{ WebkitOverflowScrolling: "touch" } as CSSProperties}
    >
      {children}
    </div>
  );
}
