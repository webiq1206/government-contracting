import Link from "next/link";
import {
  KIND_FILTER_LABEL,
  type WorkKind,
  type QueueFilter,
} from "@/lib/domain/work-queue";

/**
 * Search and filters over the queue.
 *
 * The audit asks for them, and the reason is scale: at a dozen items the queue
 * is a list you read, and at eighty it is a haystack. Filtering by kind is how
 * somebody who has half an hour and a phone works only the calls.
 *
 * Server-driven through the URL rather than client state, so a filtered queue
 * is a link, the back button works, and there is one implementation of what
 * "overdue calls" means rather than one on the server and one in the browser.
 */
export function QueueFilters({
  q,
  bucket,
  kind,
  kindCounts,
  hrefFor,
  clearHref,
}: {
  q: string;
  bucket: QueueFilter;
  kind: WorkKind | null;
  kindCounts: Record<WorkKind, number>;
  hrefFor: (opts: { kind?: WorkKind | null }) => string;
  clearHref: string;
}) {
  const kinds = (Object.keys(KIND_FILTER_LABEL) as WorkKind[]).filter(
    (k) => kindCounts[k] > 0 || kind === k
  );

  return (
    <div className="space-y-2">
      <form method="get" action="/today" className="flex flex-wrap items-center gap-2">
        {bucket !== "all" && <input type="hidden" name="due" value={bucket} />}
        {kind && <input type="hidden" name="kind" value={kind} />}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search the queue…"
          aria-label="Search the work queue"
          className="input w-full max-w-xs text-sm"
        />
        <button type="submit" className="btn-ghost text-sm">
          Search
        </button>
        {(q || bucket !== "all" || kind) && (
          <Link href={clearHref} className="tap text-xs text-slate-500 hover:text-accent">
            Clear
          </Link>
        )}
      </form>

      {kinds.length > 1 && (
        <nav aria-label="Filter by kind of work" className="flex flex-wrap gap-2">
          <Link
            href={hrefFor({ kind: null })}
            aria-current={kind == null ? "page" : undefined}
            className={chip(kind == null)}
          >
            All kinds
          </Link>
          {kinds.map((k) => (
            <Link
              key={k}
              href={hrefFor({ kind: kind === k ? null : k })}
              aria-current={kind === k ? "page" : undefined}
              className={chip(kind === k)}
            >
              {KIND_FILTER_LABEL[k]}
              <span className="num text-muted-foreground">{kindCounts[k]}</span>
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

function chip(active: boolean): string {
  const base =
    "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors md:min-h-0 md:py-1.5";
  return active
    ? `${base} border-gold bg-gold/15 text-foreground`
    : `${base} border-border text-foreground hover:border-foreground/30`;
}
