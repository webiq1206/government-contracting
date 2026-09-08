/* eslint-disable @next/next/no-img-element */

/**
 * Wordmark that follows `html.dark` via CSS, so it stays correct before/after
 * hydration and never flashes the charcoal mark on a dark surface.
 *
 * Both images carry the same alt text, and neither is aria-hidden.
 *
 * That looks like it would announce the name twice, and it does not: exactly
 * one of the two is ever displayed, and `display: none` removes the other from
 * the accessibility tree along with its alt. Naming only the light-theme image
 * -- which is what this did -- meant the name lived on the element that dark
 * mode hides, so in dark mode the wordmark had no accessible name at all.
 *
 * That was not cosmetic. This component is the brand link in the nav and the
 * only <h1> on every signed-out page: login, signup, the password flows, the
 * setup and invite screens, and the vendor portal. A screen-reader user in
 * dark mode met an unnamed heading on the first page of the product.
 *
 * The sweep missed it because its dark pass reports contrast only, on the
 * reasoning that accessible names do not change with the theme. They do when
 * the artwork is theme-swapped, which is exactly this.
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
        alt="BROST.co"
        className={`${cls} hidden dark:block`}
        draggable={false}
        decoding="async"
        {...priorityProps}
      />
    </>
  );
}
