import { PendingLink as Link } from "@/components/pending-link";
import {
  OWNER_FILTERS,
  OWNER_FILTER_LABEL,
  type OwnerFilter,
} from "@/lib/domain/ownership";
import {
  KIND_FILTER_LABEL,
  type WorkKind,
  type QueueFilter,
} from "@/lib/domain/work-queue";

/** Advanced queue controls stay available without pushing the work below the fold. */
export function QueueFilters({
  q,
  bucket,
  kind,
  kindCounts,
  owner = "anyone",
  ownerHrefFor,
  hrefFor,
  clearHref,
}: {
  q: string;
  bucket: QueueFilter;
  kind: WorkKind | null;
  kindCounts: Record<WorkKind, number>;
  owner?: OwnerFilter;
  ownerHrefFor?: (o: OwnerFilter) => string;
  hrefFor: (opts: { kind?: WorkKind | null }) => string;
  clearHref: string;
}) {
  const kinds = (Object.keys(KIND_FILTER_LABEL) as WorkKind[]).filter(
    (key) => kindCounts[key] > 0 || kind === key
  );
  const active = Boolean(q || bucket !== "all" || kind || owner !== "anyone");

  if (bucket === "completed_today") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-foreground">Finished today</p>
        <Link href={clearHref} className="tap text-sm text-muted-foreground hover:text-accent">
          Back to work
        </Link>
      </div>
    );
  }

  return (
    <details className="rounded-lg bg-surface/50 px-3" open={active || undefined}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-sm font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        Search & filters{active ? " · Active" : ""}
      </summary>
      <div className="space-y-3 pb-3">
        <form method="get" action="/today" className="search-row min-w-0">
          {bucket !== "all" && <input type="hidden" name="due" value={bucket} />}
          {kind && <input type="hidden" name="kind" value={kind} />}
          {owner !== "anyone" && <input type="hidden" name="owner" value={owner} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search work…"
            aria-label="Search the work queue"
            className="input min-w-0 flex-1 text-sm"
          />
          <button type="submit" className="btn-secondary shrink-0 text-sm">
            Search
          </button>
          {active && (
            <Link href={clearHref} className="tap text-sm text-muted-foreground hover:text-accent">
              Clear
            </Link>
          )}
        </form>

        {ownerHrefFor && (
          <nav aria-label="Filter by owner" className="chip-row">
            {OWNER_FILTERS.map((item) => (
              <Link
                key={item}
                href={ownerHrefFor(item)}
                aria-current={owner === item ? "page" : undefined}
                className={chip(owner === item)}
              >
                {OWNER_FILTER_LABEL[item]}
              </Link>
            ))}
          </nav>
        )}

        {kinds.length > 1 && (
          <nav aria-label="Filter by kind of work" className="chip-row">
            <Link
              href={hrefFor({ kind: null })}
              aria-current={kind == null ? "page" : undefined}
              className={chip(kind == null)}
            >
              All kinds
            </Link>
            {kinds.map((key) => (
              <Link
                key={key}
                href={hrefFor({ kind: kind === key ? null : key })}
                aria-current={kind === key ? "page" : undefined}
                className={chip(kind === key)}
              >
                {KIND_FILTER_LABEL[key]}
                <span className="num text-muted-foreground">{kindCounts[key]}</span>
              </Link>
            ))}
          </nav>
        )}
      </div>
    </details>
  );
}

function chip(active: boolean): string {
  const base =
    "inline-flex coarse:min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors py-1.5";
  return active
    ? `${base} border-accent bg-accent-soft text-foreground`
    : `${base} border-border text-foreground hover:border-foreground/30`;
}
