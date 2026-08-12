import type { ReactNode } from "react";

/**
 * Shared empty / calm-success state. No emoji by default; optional action slot
 * for the one next step the operator should take.
 */
export function EmptyState({
  title,
  description,
  action,
  tone = "neutral",
  variant: _variant = "light",
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "success";
  /** @deprecated Theme tokens cover both surfaces; kept for call-site compatibility. */
  variant?: "light" | "shell";
}) {
  return (
    <div
      className={`mx-auto max-w-lg rounded-md border p-5 text-center sm:p-6 ${
        tone === "success"
          ? "border-pursue/30 bg-pursue/5"
          : "border-border/55 bg-surface dark:border-white/10"
      }`}
    >
      <p className="font-display text-xl font-normal text-foreground sm:font-semibold">
        {title}
      </p>
      {description != null && description !== "" ? (
        <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</div>
      ) : null}
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
