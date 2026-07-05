"use client";

/**
 * A tiny client wrapper that eats click events. Used to embed action buttons
 * inside a wrapping <Link>-target so the whole card is clickable while the
 * inner controls (Pursue / Dismiss) still fire without navigating away.
 */
export function StopClickPropagation({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={className}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}
