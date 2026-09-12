import type { CSSProperties, ReactNode } from "react";

/** Search and filters belong to the page, not to a second sticky header. */
export function PageToolbar({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-page-toolbar
      className={`page-toolbar-simple bg-background px-4 py-2 sm:px-6 ${className}`}
    >
      {children}
    </div>
  );
}

/** Horizontally scrollable chips where the choices genuinely need to remain inline. */
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
