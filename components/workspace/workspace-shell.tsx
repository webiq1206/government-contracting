import type { ReactNode } from "react";

/**
 * Shared queue/detail workspace. Phones use normal document flow and one pane
 * at a time. Larger screens retain the efficient multi-pane workspace.
 */
export function WorkspaceShell({
  queue,
  queueLabel = "Queue",
  primary,
  primaryLabel = "Workspace",
  context,
  contextLabel = "Supporting detail",
  selected,
  queueWidth = "lg:w-[320px] 2xl:w-[360px]",
}: {
  queue: ReactNode;
  queueLabel?: string;
  primary: ReactNode;
  primaryLabel?: string;
  context?: ReactNode;
  contextLabel?: string;
  selected: boolean;
  queueWidth?: string;
}) {
  return (
    <div data-workspace-selected={selected} className="flex min-h-0 flex-1 flex-col lg:flex-row lg:overflow-hidden">
      <section
        aria-label={queueLabel}
        className={`workspace-queue w-full shrink-0 lg:scroll-thin lg:overflow-y-auto lg:border-r lg:border-border/55 dark:lg:border-white/10 ${queueWidth} ${
          selected ? "hidden lg:block" : "block"
        }`}
      >
        {queue}
      </section>

      <div
        className={`min-w-0 flex-1 flex-col lg:scroll-thin lg:overflow-y-auto 2xl:flex-row 2xl:overflow-hidden ${
          selected ? "flex" : "hidden lg:flex"
        }`}
      >
        <section
          aria-label={primaryLabel}
          className="workspace-detail flex min-w-0 flex-col 2xl:min-h-0 2xl:flex-1"
        >
          {primary}
        </section>

        {context && (
          <aside
            aria-label={contextLabel}
            className="workspace-context shrink-0 border-t border-border/55 px-4 py-4 dark:border-white/10 2xl:scroll-thin 2xl:w-[320px] 2xl:overflow-y-auto 2xl:border-l 2xl:border-t-0"
          >
            {context}
          </aside>
        )}
      </div>
    </div>
  );
}

/** Primary record pane. Mobile actions remain in normal flow. */
export function WorkspacePane({
  header,
  children,
  footer,
}: {
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-col 2xl:min-h-0 2xl:flex-1">
      {header && (
        <header className="shrink-0 border-b border-border/45 bg-background px-4 py-3 dark:border-white/10">
          {header}
        </header>
      )}
      <div className="px-4 py-4 2xl:scroll-thin 2xl:min-h-0 2xl:flex-1 2xl:overflow-y-auto">
        {children}
      </div>
      {footer && (
        <div className="workspace-footer shrink-0 border-t border-border/45 bg-background px-4 py-3 dark:border-white/10">
          {footer}
        </div>
      )}
    </div>
  );
}

export function WorkspacePlaceholder({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <p className="max-w-sm text-center text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

export function ContextSection({
  title,
  children,
  note,
}: {
  title: string;
  children: ReactNode;
  note?: string;
}) {
  return (
    <section className="border-b border-border/40 pb-4 last:border-b-0 last:pb-0 dark:border-white/5">
      <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
      {note && <p className="mb-2 text-xs text-muted-foreground">{note}</p>}
      {children}
    </section>
  );
}
