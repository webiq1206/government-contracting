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
  variant = "light",
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "success";
  /** Dark shell surfaces (Today). */
  variant?: "light" | "shell";
}) {
  const shell = variant === "shell";
  return (
    <div
      className={`mx-auto max-w-lg rounded-md border p-5 text-center sm:p-6 ${
        shell
          ? tone === "success"
            ? "border-pursue/35 bg-pursue/10"
            : "border-white/10 bg-shell"
          : tone === "success"
            ? "card border-pursue/30 bg-pursue/5"
            : "card"
      }`}
    >
      <p
        className={`font-display text-xl ${
          shell ? "font-normal text-white" : "font-semibold text-foreground"
        }`}
      >
        {title}
      </p>
      {description != null && description !== "" ? (
        <div
          className={`mt-2 text-sm leading-relaxed ${
            shell ? "text-white/55" : "text-slate-500"
          }`}
        >
          {description}
        </div>
      ) : null}
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
