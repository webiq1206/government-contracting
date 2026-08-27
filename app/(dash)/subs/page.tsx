import Link from "next/link";
import { subDatabase, subDatabaseCount, subPeek, SUB_SORTS } from "@/lib/data";
import { SubPeek } from "@/components/sub-peek";
import { PageFrame } from "@/components/page-frame";
import { EmptyState } from "@/components/empty-state";
import { PAGE_HELP } from "@/lib/help-content";
import { FilterToolbar } from "@/components/filter-toolbar";
import { SubsTable } from "@/components/subs-table";
import {
  parseFilters,
  parseSort,
  parsePaging,
  serializeSort,
  type FilterSpec,
} from "@/lib/domain/table-view";
import type { Subcontractor } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The filters this page offers, declared once.
 *
 * The old bar had four: search, trade, state, minimum reliability. Everything
 * else an operator actually asks the roster -- who can I email, whose licence
 * is current, who have we not spoken to since spring -- required scrolling a
 * five-hundred-row table and reading badges.
 *
 * Each one here answers a question someone asks while assembling a bid.
 */
const SPECS: FilterSpec[] = [
  { key: "q", label: "Search", kind: "text", placeholder: "Company, owner, or email" },
  { key: "trade", label: "Trade", kind: "text", placeholder: "e.g. Electrical" },
  { key: "state", label: "State", kind: "text", placeholder: "TX", upper: true },
  {
    key: "health",
    label: "Email",
    kind: "select",
    placeholder: "Any",
    hint: "Whether outreach can actually reach them.",
    options: [
      { value: "verified", label: "Verified" },
      { value: "unverified", label: "Unverified" },
      { value: "none", label: "None found" },
      { value: "unchecked", label: "Not checked" },
    ],
  },
  {
    key: "license",
    label: "Licence",
    kind: "select",
    placeholder: "Any",
    options: [
      { value: "active", label: "Active" },
      { value: "other", label: "Not active" },
      { value: "unknown", label: "Unknown" },
    ],
  },
  {
    key: "minRel",
    label: "Reliability",
    kind: "min",
    min: 0,
    max: 100,
    hint: "0-100, from how consistently this firm answers, quotes on time, and delivers.",
  },
  { key: "minRating", label: "Rating", kind: "min", min: 0, max: 5, hint: "Minimum Google rating." },
  {
    key: "quiet",
    label: "Quiet for (days)",
    kind: "min",
    min: 1,
    max: 3650,
    hint: "Not contacted in this many days. Never-contacted firms are included.",
  },
  { key: "preferred", label: "Preferred only", kind: "boolean" },
  { key: "sb", label: "Small business", kind: "boolean" },
  {
    key: "blocked",
    label: "Include blocked",
    kind: "boolean",
    hint: "Blocked firms are hidden by default so nobody emails one by accident.",
  },
];

const SORT_KEYS = Object.keys(SUB_SORTS);

export default async function SubsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const values = parseFilters(SPECS, searchParams);
  const sort = parseSort(searchParams, SORT_KEYS);

  const filters = {
    q: values.q,
    trade: values.trade,
    state: values.state,
    minReliability: values.minRel != null ? Number(values.minRel) : undefined,
    minRating: values.minRating != null ? Number(values.minRating) : undefined,
    quietDays: values.quiet != null ? Number(values.quiet) : undefined,
    preferred: values.preferred === "1",
    sbOnly: values.sb === "1",
    includeBlocked: values.blocked === "1",
    emailHealth: values.health as
      | "verified"
      | "unverified"
      | "none"
      | "unchecked"
      | undefined,
    license: values.license as "active" | "other" | "unknown" | undefined,
  };

  /*
   * Count first, then fetch one page. The page number has to be clamped
   * against a real total before the fetch, or a bookmark pointing at page 12
   * of a list a filter has narrowed to two pages returns nothing and reads as
   * "you have no subcontractors".
   */
  const total = await subDatabaseCount(filters);
  const paging = parsePaging(searchParams, total);
  const subs = await subDatabase(filters, {
    sort: sort.key ?? undefined,
    direction: sort.direction,
    limit: paging.perPage,
    offset: paging.offset,
  });

  const filtered = Object.keys(values).length > 0;

  /*
   * The peek is a query parameter, so it survives the back button and can be
   * pasted to somebody. An id that is not this org's simply returns nothing
   * and the list renders without a drawer, which is the same thing a deleted
   * record does and needs no separate branch.
   */
  const peekId = typeof searchParams.peek === "string" ? searchParams.peek : null;
  const peeked = peekId ? await subPeek(peekId) : null;

  function withoutPeek(): string {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (k === "peek" || v == null) continue;
      if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
      else p.set(k, v);
    }
    const q = p.toString();
    return q ? `/subs?${q}` : "/subs";
  }

  /*
   * The list URL with the peek stripped and a trailing separator, so the table
   * can append `peek=<id>` without knowing whether there were filters.
   */
  const peekBase = (() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (k === "peek" || v == null) continue;
      if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
      else p.set(k, v);
    }
    const q = p.toString();
    return q ? `/subs?${q}&` : "/subs?";
  })();

  function withPeek(id: string): string {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (k === "peek" || v == null) continue;
      if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
      else p.set(k, v);
    }
    p.set("peek", id);
    return `/subs?${p.toString()}`;
  }

  return (
    <div className="flex page-shell">
      <PageFrame
        help={PAGE_HELP["subs"]}
        title="Subcontractors"
        status={
          total === 0 && !filtered
            ? "Empty"
            : `${total} on the roster${filtered ? " matching these filters" : ""}`
        }
        explanation="Firms Brost Co finds, verifies and reuses across bids. Preferred subs are contacted first on new work."
      />

      <FilterToolbar
        pathname="/subs"
        specs={SPECS}
        values={values}
        sortParam={serializeSort(sort)}
        perPage={paging.perPage}
        viewsKey="brostco.subs.views"
        /* Always a count, including when it is none: the filter sheet shows
           this line above Apply, and a blank there reads as a control that has
           not worked rather than a search that found nothing. */
        resultLabel={
          total > 0
            ? `Showing ${paging.from}-${paging.to} of ${total}`
            : filtered
              ? "No subcontractors match these filters"
              : "No subcontractors on the roster yet"
        }
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="scroll-thin min-w-0 flex-1 overflow-auto p-4">
        {/* Mobile keeps the stacked cards: a ten-column table on a phone is
            a horizontal scroll nobody wins. */}
        <ul className="space-y-4 lg:hidden">
          {subs.map((s: Subcontractor) => (
            <li key={s.id}>
              <Link
                href={`/subs/${s.id}`}
                className="card block transition-colors hover:border-gold/60"
              >
                <p className="eyebrow mb-2">
                  {(s.trade_categories ?? [])[0] ?? "Subcontractor"}
                </p>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {s.is_preferred ? "★ " : ""}
                      {s.company_name}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[s.owner_name, [s.city, s.state].filter(Boolean).join(", ")]
                        .filter(Boolean)
                        .join(" · ") || "No location on file"}
                    </p>
                  </div>
                  {s.reliability_score != null && (
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                      {s.reliability_score}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(s.trade_categories ?? []).slice(0, 4).map((t) => (
                    <span key={t} className="badge bg-muted text-muted-foreground">
                      {t}
                    </span>
                  ))}
                  {s.email && s.email_verified ? (
                    <span className="badge bg-pursue/15 text-pursue">Email verified</span>
                  ) : s.email ? (
                    <span className="badge bg-review/15 text-review">Email unverified</span>
                  ) : null}
                </div>
              </Link>
              {/*
                * Outside the card link, not inside it: a link inside a link is
                * invalid markup and the browser resolves it by dropping one of
                * them, which is how a control stops working for no visible
                * reason.
                */}
              <Link href={withPeek(s.id)} className="btn-ghost mt-2 inline-flex text-xs">
                Quick look
              </Link>
            </li>
          ))}
        </ul>

        <div className="hidden lg:block">
          <SubsTable
            peekBase={peekBase}
            rows={subs}
            total={total}
            filters={values}
            sort={sort}
            paging={paging}
            emptyState={
              filtered ? (
                <EmptyState
                  title="No subcontractors match these filters"
                  description="Every filter above is applied together. Remove one from the chips to widen the search."
                  action={
                    <Link href="/subs" className="btn-ghost text-sm">
                      Clear all filters
                    </Link>
                  }
                />
              ) : (
                <EmptyState
                  title="Your roster is empty"
                  description="Sub Finder fills this when you pursue an opportunity: it searches for local contractors in each required trade, verifies contact details, and keeps them here for future bids."
                  action={
                    <Link href="/pipeline" className="btn-ghost text-sm">
                      Open opportunities
                    </Link>
                  }
                />
              )
            }
          />
        </div>
      </div>

      {peeked && <SubPeek sub={peeked} closeHref={withoutPeek()} />}
      </div>
    </div>
  );
}
