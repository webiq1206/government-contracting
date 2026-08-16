/**
 * The record-header action row: every channel you can reach this record by,
 * one tap away, directly under the name.
 *
 * The pattern is the anatomy shared by every mature CRM record page: header,
 * then a horizontal row of circular actions (call, email, ...), greyed out
 * rather than hidden when a channel is missing. Greyed matters: a missing
 * button says nothing, a dimmed one says "no phone on file", which for a
 * subcontractor record is exactly the data-quality signal the operator needs
 * before promising anyone a call.
 *
 * Server-renderable on purpose: every action is a plain link (tel:, mailto:,
 * an external site, or an in-page anchor), so the row costs no client JS.
 */

export interface RecordAction {
  key: string;
  label: string;
  /** Text glyph, matching the app's icon convention (☏ in the tab bar). */
  glyph: string;
  /** Absent → the action renders dimmed with the reason as its tooltip. */
  href?: string | null;
  /** Shown as the tooltip when the action is unavailable. */
  missing?: string;
  external?: boolean;
}

export function RecordActions({ actions }: { actions: RecordAction[] }) {
  return (
    <div className="flex flex-wrap items-start gap-4 sm:gap-5">
      {actions.map((a) =>
        a.href ? (
          <a
            key={a.key}
            href={a.href}
            {...(a.external ? { target: "_blank", rel: "noreferrer" } : {})}
            className="group flex w-14 flex-col items-center gap-1"
          >
            <span
              aria-hidden
              className="flex h-11 w-11 items-center justify-center rounded-full border border-border-strong/50 bg-surface text-lg text-foreground transition-colors group-hover:border-gold group-hover:bg-gold/10"
            >
              {a.glyph}
            </span>
            <span className="text-[0.65rem] font-medium text-muted-foreground transition-colors group-hover:text-foreground">
              {a.label}
            </span>
          </a>
        ) : (
          <span
            key={a.key}
            title={a.missing}
            aria-disabled
            className="flex w-14 cursor-not-allowed flex-col items-center gap-1 opacity-40"
          >
            <span
              aria-hidden
              className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-lg text-muted-foreground"
            >
              {a.glyph}
            </span>
            <span className="text-[0.65rem] font-medium text-muted-foreground">{a.label}</span>
          </span>
        )
      )}
    </div>
  );
}
