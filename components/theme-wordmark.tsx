/* eslint-disable @next/next/no-img-element */

/**
 * Wordmark that follows `html.dark` via CSS, so it stays correct before/after
 * hydration and never flashes the charcoal mark on a dark surface.
 */
export function ThemeWordmark({
  className,
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  const cls = `max-w-full select-none object-contain object-left ${className ?? "h-6 w-auto"}`;
  const priorityProps = priority ? { fetchPriority: "high" as const } : {};

  return (
    <>
      <img
        src="/brand/wordmark-dark.png"
        alt="BROST.co"
        className={`${cls} dark:hidden`}
        draggable={false}
        decoding="async"
        {...priorityProps}
      />
      <img
        src="/brand/wordmark-light.png"
        alt=""
        aria-hidden
        className={`${cls} hidden dark:block`}
        draggable={false}
        decoding="async"
        {...priorityProps}
      />
    </>
  );
}
