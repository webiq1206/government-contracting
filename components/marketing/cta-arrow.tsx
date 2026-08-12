/** Thin horizontal arrow for primary CTAs (replaces diagonal ↗). */
export function CtaArrow() {
  return (
    <span className="btn-arrow" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M2.5 8h11M9.5 4.5 13 8l-3.5 3.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
