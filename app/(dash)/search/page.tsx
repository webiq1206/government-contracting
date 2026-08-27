import Link from "next/link";
import { PageFrame } from "@/components/page-frame";
import { Marked } from "@/components/command-palette";
import {
  groupResults,
  noResultAdvice,
  KIND_LABEL,
  KIND_ORDER,
  KIND_PLURAL,
  type ResultKind,
  type SearchResult,
} from "@/lib/domain/search-results";
import { searchEverything } from "@/lib/search";
import { currentOrg } from "@/lib/data";

export const dynamic = "force-dynamic";

function parseKind(v: unknown): ResultKind | null {
  const s = typeof v === "string" ? v : "";
  return (KIND_ORDER as string[]).includes(s) ? (s as ResultKind) : null;
}

/**
 * The whole result set, for when the overlay's top few are not enough.
 *
 * The overlay is for jumping to a record you already have in mind. This is for
 * the other case: not knowing quite what you are looking for, and wanting to
 * see everything that matched grouped by what kind of thing it is. It is also
 * where the audit's mobile requirement lands, since a full-screen search on a
 * phone is simply this page.
 *
 * The filter is in the URL rather than in component state, so a filtered
 * search is a link and the back button steps out of it.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const raw = searchParams?.q;
  const q = (typeof raw === "string" ? raw : "").trim();
  const kind = parseKind(searchParams?.kind);
  /*
   * Show every copy of a duplicated solicitation.
   *
   * Reached from the "see all N copies" link on a folded row. Collapsing is
   * right for somebody jumping to the record they are working; this is for
   * the operator who now has to decide which of three copies is real.
   */
  const showAll = searchParams?.all === "1";

  // Same resolver every other page uses, so this page can never search a
  // different organization from the one the operator is looking at.
  const all: SearchResult[] =
    q.length >= 2
      ? await searchEverything(q, await currentOrg(), 25, {
          collapseDuplicates: !showAll,
        })
      : [];
  const shown = kind ? all.filter((r) => r.kind === kind) : all;
  const groups = groupResults(shown);
  const counts = KIND_ORDER.map((k) => ({
    kind: k,
    n: all.filter((r) => r.kind === k).length,
  })).filter((c) => c.n > 0);

  /** The same search with the copies folded back together. */
  const foldedHref = (() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (kind) p.set("kind", kind);
    return `/search?${p.toString()}`;
  })();

  const hrefFor = (k: ResultKind | null) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (k) p.set("kind", k);
    if (showAll) p.set("all", "1");
    return `/search?${p.toString()}`;
  };

  return (
    <>
      <PageFrame
        title={q ? `Results for “${q}”` : "Search"}
        explanation="Opportunities, subcontractors, contracts, messages and documents in this account."
        status={
          q.length < 2
            ? "Type at least 2 characters"
            : `${all.length} result${all.length === 1 ? "" : "s"}`
        }
      />
      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto p-5">
        <form method="get" action="/search" className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search this account…"
            aria-label="Search everything in this account"
            className="input w-full max-w-md text-sm"
          />
          {kind && <input type="hidden" name="kind" value={kind} />}
          <button type="submit" className="btn-ghost text-sm">
            Search
          </button>
        </form>

        {showAll && (
          <div className="card max-w-2xl border-review/40 bg-review/5" role="status">
            <p className="text-sm font-medium text-review">
              Every copy is listed, including the ones normally folded together.
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-700">
              The same notice can arrive more than once, usually because the agency
              re-posted it. Open each one to see its stage: the one carrying your work
              is the one to keep, and the others can be archived from the opportunity
              itself. Nothing is merged automatically, because picking wrongly would
              lose the work rather than tidy it.
            </p>
            <Link href={foldedHref} className="btn-ghost mt-2 w-fit text-xs">
              Fold duplicates again
            </Link>
          </div>
        )}

        {counts.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by kind">
            <Link
              href={hrefFor(null)}
              aria-current={!kind ? "true" : undefined}
              className={`tap rounded-full border px-3 py-1 text-xs font-medium ${
                !kind
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border bg-surface text-slate-600 hover:border-accent/50"
              }`}
            >
              Everything <span className="num ml-1">{all.length}</span>
            </Link>
            {counts.map((c) => (
              <Link
                key={c.kind}
                href={hrefFor(c.kind)}
                aria-current={kind === c.kind ? "true" : undefined}
                className={`tap rounded-full border px-3 py-1 text-xs font-medium ${
                  kind === c.kind
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-surface text-slate-600 hover:border-accent/50"
                }`}
              >
                {KIND_PLURAL[c.kind]} <span className="num ml-1">{c.n}</span>
              </Link>
            ))}
          </div>
        )}

        {q.length < 2 ? (
          <p className="text-sm text-muted-foreground">
            Type at least two characters. This searches opportunity titles, solicitation
            numbers, agencies, subcontractor and owner names, contract numbers, message
            subjects and bodies, and document names.
          </p>
        ) : all.length === 0 ? (
          <div className="card max-w-2xl">
            <p className="text-sm font-medium text-foreground">
              Nothing in this account matches “{q}”.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-muted-foreground">
              {noResultAdvice(q).map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.kind} aria-labelledby={`group-${group.kind}`}>
              <h2 id={`group-${group.kind}`} className="label mb-2">
                {group.label}
                <span className="num ml-1.5">{group.results.length}</span>
              </h2>
              <ul className="space-y-1.5">
                {group.results.map((r, i) => (
                  <li key={`${r.kind}-${r.href}-${i}`}>
                    <Link
                      href={r.href}
                      className="block rounded-md border border-border/55 px-3 py-2.5 hover:border-accent/50"
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block text-sm text-foreground">
                            <Marked text={r.title} query={q} />
                          </span>
                          {r.subtitle && (
                            <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                              <Marked text={r.subtitle} query={q} />
                            </span>
                          )}
                        </span>
                        <span className="badge shrink-0 border border-border bg-surface text-slate-600">
                          {KIND_LABEL[r.kind]}
                        </span>
                      </span>
                    </Link>
                    {/* Outside the link, because it goes somewhere else: a
                        folded count nobody can open is a fact stated and then
                        withheld. */}
                    {r.cluster && (
                      <Link
                        href={r.cluster.href}
                        className="mt-1 inline-flex min-h-11 items-center pl-3 text-xs font-medium text-accent hover:underline lg:min-h-0"
                      >
                        See all {r.cluster.count} copies of this solicitation &rarr;
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </>
  );
}
