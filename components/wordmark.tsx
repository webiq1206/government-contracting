/**
 * The BROSTCO wordmark. Montserrat carries the name; the "co" is set in the
 * Fraunces-italic accent, the one sparing use of the accent face called for by
 * the brand ("a single word or the Co."). Size/weight come from `className`.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`font-display ${className ?? ""}`}>
      BROST<span className="font-accent">co</span>
    </span>
  );
}
