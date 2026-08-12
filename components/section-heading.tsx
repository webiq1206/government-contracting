import type { ReactNode } from "react";
import { InfoTip } from "@/components/info-tip";

/**
 * Consistent section chrome for long admin pages: eyebrow + title + optional
 * tip and supporting sentence. Tip only for non-obvious terms.
 */
export function SectionHeading({
  id,
  eyebrow,
  title,
  tip,
  action,
  children,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  tip?: string;
  /** Contextual primary action for this section. */
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      id={id}
      className={`flex flex-wrap items-end justify-between gap-3 ${
        id ? "scroll-mt-editorial" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        {eyebrow ? <p className="eyebrow-gold">{eyebrow}</p> : null}
        <h2 className="mt-0.5 flex flex-wrap items-center gap-1.5 font-display text-2xl font-semibold leading-tight text-foreground sm:text-3xl">
          {title}
          {tip ? <InfoTip label={`About ${title}`}>{tip}</InfoTip> : null}
        </h2>
        <div className="mt-2 h-px w-10 bg-gold" />
        {children ? (
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500">{children}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}
