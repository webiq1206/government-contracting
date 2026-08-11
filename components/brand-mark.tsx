/* eslint-disable @next/next/no-img-element */
/**
 * Compact B mark derived from the approved wordmark. Prefer Wordmark in nav;
 * use this only where a square mark fits better than the full lockup.
 */
export function BrandMark({
  className = "",
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md";
}) {
  const box = size === "sm" ? "h-7 w-7" : "h-8 w-8";
  return (
    <img
      src="/brand/b-mark.png"
      alt=""
      aria-hidden
      className={`block ${box} select-none object-contain ${className}`}
      draggable={false}
      decoding="async"
    />
  );
}
