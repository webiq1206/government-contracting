/**
 * Today could not be tied to an account, or a required read failed closed.
 * Rendering this is the alternative to throwing and taking the request down.
 */
export function TodayAccountUnknown({ variant = "account" }: { variant?: "account" | "load" }) {
  const copy =
    variant === "load"
      ? "Today could not be loaded. Your records were not changed. Refresh this page. If it keeps happening, open Automation Health."
      : "We could not tell which account this page belongs to, so no records were loaded. Refresh this page. If it keeps happening, sign in again.";
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-16">
      <h1 className="font-display text-xl font-semibold text-foreground">Today is not available</h1>
      <p className="mt-3 text-sm leading-relaxed text-foreground/80">{copy}</p>
    </div>
  );
}
