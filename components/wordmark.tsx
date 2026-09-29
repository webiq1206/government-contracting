import Image from "next/image";

/**
 * The BrostCo wordmark — approved artwork, never re-typed.
 * `variant="dark"`: charcoal BROST + gold co for light / cream surfaces.
 * `variant="light"`: white BROST.co for dark shell and marketing chrome.
 * Size with height utilities (`h-6`, `h-8`, …); width follows the art ratio.
 *
 * Served through next/image so the browser receives a copy sized for the
 * 24 to 28 px it is displayed at, in a modern format, instead of the full
 * 696-pixel PNG on every page. The intrinsic width and height are declared
 * so the space is reserved before the file arrives and nothing shifts.
 *
 * NOTE: no default h-auto/w-auto here — callers must pass an explicit height
 * so Tailwind utility classes win correctly without cascade conflicts.
 */
const ART = {
  dark: { src: "/brand/wordmark-dark.png", width: 696, height: 159 },
  light: { src: "/brand/wordmark-light.png", width: 699, height: 160 },
} as const;

export function Wordmark({
  className,
  variant = "dark",
  priority = false,
}: {
  className?: string;
  variant?: "dark" | "light";
  /** Hint for LCP hero usage (preload + native fetchpriority). */
  priority?: boolean;
}) {
  const art = ART[variant];
  return (
    <Image
      src={art.src}
      alt="BrostCo"
      width={art.width}
      height={art.height}
      sizes="(max-width: 640px) 110px, 130px"
      priority={priority}
      className={`block max-w-full select-none object-contain object-left ${className ?? "h-6 w-auto"}`}
      draggable={false}
    />
  );
}
