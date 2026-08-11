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
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "success";
}) {
  return (
    <div
      className={`card mx-auto max-w-lg text-center ${
        tone === "success" ? "border-pursue/30 bg-pursue/5" : ""
      }`}
    >
      <p className="font-display text-xl font-semibold text-foreground">{title}</p>
      {description != null && description !== "" ? (
        <div className="mt-2 text-sm leading-relaxed text-slate-500">{description}</div>
      ) : null}
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
