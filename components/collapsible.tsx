import type { ReactNode } from "react";

/**
 * A section that collapses into a tap-to-expand accordion on mobile but renders
 * as a normal, always-open card on desktop (handled entirely in CSS via the
 * `.acc` class, so there is no JavaScript and no hydration cost). The title
 * doubles as the accordion header; `meta` shows a small count/summary on the
 * right. `defaultOpen` starts it expanded on mobile too.
 */
export function Collapsible({
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  title: string;
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="acc" {...(defaultOpen ? { open: true } : {})}>
      <summary>
        <span className="eyebrow">{title}</span>
        {meta != null && <span className="text-xs font-normal text-slate-500">{meta}</span>}
      </summary>
      <div className="acc-body">{children}</div>
    </details>
  );
}
