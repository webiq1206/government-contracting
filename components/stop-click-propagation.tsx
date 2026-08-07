"use client";

/**
 * A tiny client wrapper that eats click events. Used to embed action buttons
 * inside a wrapping <Link>-target so the whole card is clickable while the
 * inner controls (Pursue / Dismiss / Snooze) still fire without navigating.
 *
 * BOTH calls matter:
 *  - stopPropagation() keeps the click from reaching the Link's JS handler;
 *  - preventDefault() blocks the <a>'s NATIVE navigation, which otherwise
 *    still fires (stopPropagation only silences listeners, not default
 *    actions) and does a full page load that cancels the button's in-flight
 *    request. The inner controls are buttons, so they lose no default
 *    behavior of their own.
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
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}
