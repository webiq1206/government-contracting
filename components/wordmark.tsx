/* eslint-disable @next/next/no-img-element */
/**
 * The BROST CO wordmark — the approved artwork, never re-typed (brand guide
 * rule 01). `variant="dark"` is the charcoal+gold mark for light backgrounds;
 * `variant="light"` is the white+gold inverse for dark backgrounds. Size via
 * `className` (height utilities); width scales with the artwork's ratio.
 */
export function Wordmark({
  className,
  variant = "dark",
}: {
  className?: string;
  variant?: "dark" | "light";
}) {
  return (
    <img
      src={variant === "light" ? "/brand/wordmark-light.png" : "/brand/wordmark-dark.png"}
      alt="BROST CO"
      className={`w-auto select-none ${className ?? ""}`}
      draggable={false}
    />
  );
}
