/* eslint-disable @next/next/no-img-element */
/**
 * The BROST.co wordmark — approved artwork, never re-typed.
 * `variant="dark"`: charcoal BROST + gold co for light / cream surfaces.
 * `variant="light"`: white BROST.co for dark shell and marketing chrome.
 * Size with height utilities (`h-6`, `h-8`, …); width follows the art ratio.
 *
 * NOTE: no default h-auto/w-auto here — callers must pass an explicit height
 * so Tailwind utility classes win correctly without cascade conflicts.
 */
export function Wordmark({
  className,
  variant = "dark",
  priority = false,
}: {
  className?: string;
  variant?: "dark" | "light";
  /** Hint for LCP hero usage (native fetchpriority). */
  priority?: boolean;
}) {
  return (
    <img
      src={variant === "light" ? "/brand/wordmark-light.png" : "/brand/wordmark-dark.png"}
      alt="BROST.co"
      className={`block max-w-full select-none object-contain object-left ${className ?? "h-6 w-auto"}`}
      draggable={false}
      decoding="async"
      {...(priority ? { fetchPriority: "high" as const } : {})}
    />
  );
}
