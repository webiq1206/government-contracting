import Link from "next/link";
import { CERTIFICATIONS } from "@/lib/domain/sub-capability";
import { DEFAULT_RATE_EVIDENCE } from "@/lib/data";
import { subDatabase, subDatabaseCount, subPeek, SUB_SORTS } from "@/lib/data";
import { SubPeek } from "@/components/sub-peek";
import { QueueKeys } from "@/components/workspace/workspace-keys";
import { queuePosition } from "@/lib/domain/workspace-queue";
import { currentUser } from "@/lib/auth";
import { assignableMembers } from "@/lib/ownership";
import { can } from "@/lib/domain/roles";
import { PageFrame } from "@/components/page-frame";
import { EmptyState } from "@/components/empty-state";
import { PAGE_HELP } from "@/lib/help-content";
import { FilterToolbar } from "@/components/filter-toolbar";
import { SubsTable } from "@/components/subs-table";
import { RowActions } from "@/components/row-actions";
import { subcontractorRowActions } from "@/lib/domain/row-actions";
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
  {
    key: "reach",
    label: "Can we reach them",
    kind: "select",
    placeholder: "Any",
    hint: "A verified address or a phone number. The same test the record page shows as its state.",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No usable email or phone" },
    ],
  },
  {
    key: "paperwork",
    label: "Paperwork",
    kind: "select",
    placeholder: "Any",
    hint: "Whether the documents an award needs are on file and current.",
    options: [
      { value: "ready", label: "Nothing outstanding" },
      { value: "short", label: "Something missing or lapsed" },
    ],
  },
  {
    key: "worksIn",
    label: "Will work in",
    kind: "text",
    placeholder: "NM",
    upper: true,
    hint: "Their recorded service area, or their own state when nobody has asked them.",
  },
  {
    key: "cert",
    label: "Certification",
    kind: "select",
    placeholder: "Any",
    hint: "Set-aside certifications, for a solicitation that reserves work for one.",
    options: CERTIFICATIONS.map((c) => ({ value: c.key, label: c.label })),
  },
  {
    key: "minBond",
    label: "Bonded to at least ($)",
    kind: "min",
    min: 0,
    max: 100_000_000,
    hint: "Single-job bond. A firm bonded to an amount nobody has recorded does not pass.",
  },
  {
    key: "minCrew",
    label: "Crew of at least",
    kind: "min",
    min: 1,
    max: 5000,
    hint: "Firms whose crew size nobody has asked about are set aside, not counted as zero.",
  },
  {
    key: "tag",
    label: "Tag",
    kind: "text",
    placeholder: "Shortlist",
    hint: "Tags your team put on records. Case does not matter.",
  },
  {
    key: "minResp",
    label: "Answers at least (%)",
    kind: "min",
    min: 0,
    max: 100,
    hint: "Of what we sent them. Firms we have emailed fewer than three times are set aside, because a stranger has no response rate.",
  },
  {
    key: "minQuote",
    label: "Quotes at least (%)",
    kind: "min",
    min: 0,
    max: 100,
    hint: "Of what we sent them, on the same three-email floor.",
  },
  {
    key: "minAward",
    label: "Wins at least (%)",
    kind: "min",
    min: 0,
    max: 100,
    hint: "Of the quotes they gave, not of the emails we sent: this measures their bids rather than our outreach.",
  },
  { key: "preferred", label: "Preferred only", kind: "boolean" },
  { key: "sb", label: "Small business", kind: "boolean" },
  {
    key: "blocked",
    label: "Include blocked",
    kind: "boolean",
    hint: "Blocked firms are hidden by default so nobody emails one by accident.",
  },
  {
    key: "archived",
    label: "Include put aside",
    kind: "boolean",
    hint: "Records taken off the roster, and ones folded into another. Different from blocked, and hidden by default for the same reason.",
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
    includeArchived: values.archived === "1",
    contactable: values.reach as "yes" | "no" | undefined,
    paperwork: values.paperwork as "ready" | "short" | undefined,
    worksIn: values.worksIn,
    certification: values.cert,
    // Typed in dollars, stored in cents. The filter box says dollars because
    // that is the number on a bond.
    minBondCents: values.minBond != null ? Math.round(Number(values.minBond) * 100) : undefined,
    minCrew: values.minCrew != null ? Number(values.minCrew) : undefined,
    minResponseRate: values.minResp != null ? Number(values.minResp) : undefined,
    minQuoteRate: values.minQuote != null ? Number(values.minQuote) : undefined,
    minAwardRate: values.minAward != null ? Number(values.minAward) : undefined,
    tag: values.tag,
  };

  /*
   * Count first, then fetch one page. The page number has to be clamped
   * against a real total before the fetch, or a bookmark pointing at page 12
   * of a list a filter has narrowed to two pages returns nothing and reads as
   * "you have no subcontractors".
   */
  /*
   * Whether any filter that needs a denominator is on. Used only to explain
   * an empty list, which is the one place the difference between "none of
   * them" and "not enough evidence about any of them" changes what somebody
   * does next.
   */
  const rateFiltered =
    filters.minResponseRate != null ||
    filters.minQuoteRate != null ||
    filters.minAwardRate != null;

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
  const [peeked, viewer, members] = await Promise.all([
    peekId ? subPeek(peekId) : Promise.resolve(null),
    currentUser().catch(() => null),
    // Everybody a firm could be handed to, read once for the page.
    assignableMembers().catch(() => []),
  ]);

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

  /*
   * Where the open firm sits among the rows on this page, so the drawer can
   * offer the next one instead of being a dead end.
   */
  const peekNav = queuePosition(
    subs.map((s: Subcontractor) => String(s.id)),
    peekId
  );

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
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <Link href={withPeek(s.id)} className="btn-ghost inline-flex text-xs">
                  Quick look
                </Link>
                {/*
                  The same controls the table's rows carry. This list is what
                  a phone actually gets: the table beside it is hidden below
                  lg, so wiring only the table would have left every narrow
                  screen with nothing but navigation.
                */}
                <RowActions
                  actions={subcontractorRowActions(
                    {
                      id: s.id,
                      companyName: s.company_name,
                      phone: s.phone,
                      email: s.email,
                      emailVerified: s.email_verified,
                      outreachStopped: Boolean(s.blacklisted || s.archived_at),
                    },
                    { role: viewer?.orgRole }
                  )}
                  members={members}
                  viewerId={viewer?.id}
                  recordLabel={s.company_name}
                  compact
                />
              </div>
            </li>
          ))}
        </ul>

        <div className="hidden lg:block">
          <SubsTable
            peekBase={peekBase}
            role={viewer?.orgRole}
            members={members}
            rows={subs}
            total={total}
            filters={values}
            sort={sort}
            paging={paging}
            emptyState={
              filtered ? (
                <EmptyState
                  title="No subcontractors match these filters"
                  description={
                    /*
                     * A rate filter empties differently from the others, and
                     * saying so matters. "Answers at least half the time"
                     * returning nothing reads as "no firm here is
                     * responsive", when the truth is usually that no firm has
                     * been emailed enough times to have a rate at all. Those
                     * two lead to opposite next actions.
                     */
                    rateFiltered
                      ? `A rate needs something to divide by, so firms with fewer than ${DEFAULT_RATE_EVIDENCE} sends are set aside rather than counted as zero. If your roster is new, that may be all of them.`
                      : "Every filter above is applied together. Remove one from the chips to widen the search."
                  }
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

      {peeked && (
        <SubPeek
          sub={peeked}
          closeHref={withoutPeek()}
          canManage={can(viewer?.orgRole, "manage_subs")}
          nav={{
            prevHref: peekNav.prevId ? withPeek(peekNav.prevId) : null,
            nextHref: peekNav.nextId ? withPeek(peekNav.nextId) : null,
            index: peekNav.index,
            total: peekNav.total,
          }}
        />
      )}
      {/*
        * The roster, walked from the keyboard.
        *
        * Only over the rows on this page, which is what the arrows can
        * actually reach: paging is a server round trip with its own controls,
        * and a J at the bottom of page one that silently fetched page two
        * would be a different thing from what the key does everywhere else in
        * the product.
        */}
      <QueueKeys
        prevHref={peekNav.prevId ? withPeek(peekNav.prevId) : null}
        nextHref={peekNav.nextId ? withPeek(peekNav.nextId) : null}
        closeHref={peekId ? withoutPeek() : null}
      />
      </div>
    </div>
  );
}
