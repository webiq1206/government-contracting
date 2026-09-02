import Link from "next/link";
import { DetailDrawer } from "@/components/detail-drawer";
import { RowActions } from "@/components/row-actions";
import type { Owner } from "@/lib/domain/ownership";
import type { RowAction } from "@/lib/domain/row-actions";
import type { QuickFact, QuickTone, QuickView } from "@/lib/domain/quick-view";
import { timeAgo } from "@/lib/format";

const TONE: Record<QuickTone, string> = {
  risk: "text-risk",
  review: "text-review",
  pursue: "text-pursue",
};

/**
 * The Quick View drawer: one record, read without leaving the list.
 *
 * Everything about WHAT is shown is decided in `lib/domain/quick-view`, and
 * everything about what can be DONE is decided in `lib/domain/row-actions` --
 * the same module the row itself uses, so the drawer and the row can never
 * offer different things to the same person about the same record. This file
 * is only how those two answers look.
 *
 * The actions are pinned at the foot rather than laid out with the facts. A
 * control that scrolls away below eleven fields is a control nobody uses, and
 * the whole point of the drawer is that acting on the record does not require
 * opening it.
 */
export function QuickViewDrawer({
  view,
  closeHref,
  nav,
  actions = [],
  members = [],
  viewerId,
}: {
  view: QuickView;
  closeHref: string;
  nav?: {
    prevHref: string | null;
    nextHref: string | null;
    index: number;
    total: number;
  };
  /** From the same builder the row uses. Empty means the reader may do nothing. */
  actions?: RowAction[];
  members?: Owner[];
  viewerId?: string;
}) {
  return (
    <DetailDrawer
      title={view.title}
      subtitle={view.subtitle}
      closeHref={closeHref}
      openHref={view.openHref}
      openLabel={view.openLabel}
      nav={nav}
      footer={
        actions.length > 0 ? (
          <RowActions
            actions={actions}
            members={members}
            viewerId={viewerId}
            recordLabel={view.title}
            className="w-full flex-wrap"
          />
        ) : undefined
      }
    >
      {/*
        * The recommendation sits above the facts rather than under them. It is
        * the answer to the question that made somebody open the drawer, and
        * the facts below it are the working.
        */}
      {view.nextAction && (
        <section className="rounded border border-border/60 bg-surface/60 px-3 py-2 dark:border-white/10">
          <h3 className="label mb-1">Do next</h3>
          <p className="text-sm text-foreground">{view.nextAction}</p>
        </section>
      )}

      {view.blockers.length > 0 && (
        <section>
          <h3 className="label mb-2">In the way</h3>
          <ul className="space-y-1">
            {view.blockers.map((b) => (
              <li key={b} className="flex gap-2 text-sm text-risk">
                <span aria-hidden>•</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.sections.map((s) => (
        <section key={s.key}>
          <h3 className="label mb-2">{s.title}</h3>
          <dl className="space-y-3">
            {s.facts.map((f) => (
              <Fact key={f.label} fact={f} />
            ))}
          </dl>
        </section>
      ))}

      {view.messages.length > 0 && (
        <section>
          <h3 className="label mb-2">Latest messages</h3>
          <ul className="space-y-2">
            {view.messages.map((m) => (
              <li
                key={m.id}
                className="rounded border border-border/60 px-3 py-2 dark:border-white/10"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-medium text-foreground">
                    {m.direction === "in" ? (m.who ?? "They wrote") : "We wrote"}
                  </span>
                  {m.at && (
                    <span className="shrink-0 text-xs text-slate-500">{timeAgo(m.at)}</span>
                  )}
                </div>
                {m.subject && (
                  <p className="truncate text-xs text-slate-500">{m.subject}</p>
                )}
                {m.preview && (
                  <p className="mt-1 line-clamp-3 text-sm text-foreground">{m.preview}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.attachments.length > 0 && (
        <section>
          <h3 className="label mb-2">Attachments</h3>
          <ul className="space-y-1">
            {view.attachments.map((a) => (
              <li key={`${a.name}-${a.href ?? ""}`} className="text-sm">
                {a.href ? (
                  /*
                   * A solicitation attachment is a government URL, not one of
                   * ours, so it opens in its own tab: replacing the drawer with
                   * a PDF loses the list the operator was working through.
                   */
                  <a
                    href={a.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-accent hover:underline"
                  >
                    {a.name}
                  </a>
                ) : (
                  <span className="text-foreground">{a.name}</span>
                )}
                {a.meta && <span className="ml-2 text-xs text-slate-500">{a.meta}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        * The way out. Complex editing, detailed review and anything that
        * cannot be taken back live in the full workspace, and the drawer says
        * so at the bottom as well as the top: somebody who has read to the end
        * has usually decided this is the record they wanted.
        */}
      <Link href={view.openHref} className="btn-ghost inline-flex text-xs">
        {view.openLabel}
      </Link>
    </DetailDrawer>
  );
}

function Fact({ fact }: { fact: QuickFact }) {
  const empty = fact.value == null || fact.value === "";
  const badges = fact.badges ?? [];
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{fact.label}</dt>
      <dd className={`text-sm ${empty && badges.length === 0 ? "text-slate-500" : "text-foreground"}`}>
        {badges.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {badges.map((b) => (
              <span key={b} className="badge bg-muted text-muted-foreground">
                {b}
              </span>
            ))}
          </span>
        ) : empty ? (
          fact.unknown
        ) : (
          <span className={fact.tone ? TONE[fact.tone] : undefined}>{fact.value}</span>
        )}
      </dd>
      {fact.hint && <p className="mt-0.5 text-xs text-slate-500">{fact.hint}</p>}
    </div>
  );
}
