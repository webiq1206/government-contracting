import { InfoTip } from "@/components/info-tip";

/**
 * Consistent section chrome for long admin pages: eyebrow + title + optional
 * tip and supporting sentence. Keeps visual hierarchy identical across screens.
 */
export function SectionHeading({
  id,
  eyebrow,
  title,
  tip,
  children,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  tip?: string;
  children?: React.ReactNode;
}) {
  return (
    <div id={id} className={id ? "scroll-mt-12" : undefined}>
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h2 className="mt-0.5 flex flex-wrap items-center gap-1.5 font-display text-xl font-semibold text-foreground">
        {title}
        {tip ? <InfoTip label={`About ${title}`}>{tip}</InfoTip> : null}
      </h2>
      {children ? (
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">{children}</p>
      ) : null}
    </div>
  );
}
