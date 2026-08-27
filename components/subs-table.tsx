"use client";

import { useState } from "react";
import Link from "next/link";
import { DataTable, type Column } from "@/components/data-table";
import { ContactQuickEdit } from "@/components/contact-quick-edit";
import type { FilterValues, PageState, SortState } from "@/lib/domain/table-view";
import type { Subcontractor } from "@/lib/types";
import { subState, SUB_STATE_TONE } from "@/lib/domain/sub-state";

/**
 * The roster's read of a row, from the same function every other surface uses.
 *
 * `unmet_required_docs` is optional on the type: a read that did not count
 * them leaves it undefined, and undefined is not zero. Treating it as zero
 * here would have the roster promise clean paperwork it never checked.
 */
function rowState(s: Subcontractor) {
  const unmet = s.unmet_required_docs;
  return subState({
    samExcluded: Boolean(s.sam_excluded),
    blacklisted: Boolean(s.blacklisted),
    blacklistReason: s.blacklist_reason ?? null,
    archivedAt: s.archived_at ?? null,
    archivedReason: s.archived_reason ?? null,
    mergedInto: s.merged_into ?? null,
    email: s.email,
    emailVerified: Boolean(s.email_verified),
    phone: s.phone,
    missingDocuments: unmet && unmet > 0 ? [`${unmet} required for award`] : [],
    preferred: Boolean(s.is_preferred),
  });
}

/**
 * The roster, as a table you can actually work.
 *
 * Client-side only for what the browser owns -- which rows are selected, which
 * columns are shown. Filtering, sorting and paging all happened on the server
 * before this rendered, because five hundred subcontractors should not be sent
 * to a phone so that JavaScript can hide four hundred and fifty of them.
 */
export function SubsTable({
  rows,
  total,
  filters,
  sort,
  paging,
  emptyState,
  peekBase,
}: {
  rows: Subcontractor[];
  total: number;
  filters: FilterValues;
  sort: SortState;
  paging: PageState;
  emptyState: React.ReactNode;
  /**
   * The current list URL with the peek removed, ready to have one appended.
   * Built on the server: a function prop cannot cross into a client component,
   * and rebuilding the query here from `useSearchParams` would be a second
   * implementation of the same string.
   */
  peekBase: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const columns: Column<Subcontractor>[] = [
    {
      key: "company_name",
      header: "Company",
      sortable: true,
      render: (s) => (
        <>
          <Link href={`/subs/${s.id}`} className="font-medium text-foreground hover:text-gold-text">
            {s.is_preferred ? "★ " : ""}
            {s.company_name}
          </Link>
          {s.owner_name && (
            <div className="text-xs text-muted-foreground">{s.owner_name}</div>
          )}
        </>
      ),
    },
    {
      key: "trades",
      header: "Trades",
      render: (s) => (
        <div className="flex flex-wrap gap-1">
          {(s.trade_categories ?? []).slice(0, 3).map((t) => (
            <span key={t} className="badge bg-muted text-muted-foreground">
              {t}
            </span>
          ))}
          {(s.trade_categories?.length ?? 0) > 3 && (
            <span className="badge bg-muted text-muted-foreground">
              +{(s.trade_categories?.length ?? 0) - 3}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "state",
      header: "Location",
      sortable: true,
      render: (s) => [s.city, s.state].filter(Boolean).join(", ") || "-",
    },
    {
      key: "contact",
      header: "Email",
      hint: "Whether outreach can actually reach this firm.",
      render: (s) => (
        <span className="whitespace-nowrap">
          <ContactQuickEdit
            subId={s.id}
            companyName={s.company_name}
            email={s.email}
            phone={s.phone}
            website={s.website}
            ownerName={s.owner_name}
            className="mr-1 align-middle"
          />
          {s.email && s.email_verified ? (
            <span className="badge bg-pursue/15 text-pursue" title={s.email}>
              Verified
            </span>
          ) : s.email ? (
            <span className="badge bg-review/15 text-review" title={s.email}>
              Unverified
            </span>
          ) : s.contact_status ? (
            <span className="badge bg-muted text-muted-foreground">None found</span>
          ) : (
            <span
              className="badge bg-muted text-muted-foreground"
              title="Sub Verify has not looked for an address yet"
            >
              Not checked
            </span>
          )}
        </span>
      ),
    },
    {
      key: "reliability_score",
      header: "Reliability",
      sortable: true,
      numeric: true,
      hint: "0-100, from six things: whether they answer, whether they quote, whether the quote arrives by the date they were given, whether it covers the scope, how the work went, and how often they have backed out. Blank means not enough history to score, which is not a low score.",
      render: (s) =>
        s.reliability_score != null ? (
          <span className="font-semibold text-foreground">{s.reliability_score}</span>
        ) : (
          /*
            Words, not a dash. A dash reads as a gap in the table; this is a
            statement about the firm, and the difference matters on the column
            an operator sorts by to decide who to approach first.
          */
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            No history yet
          </span>
        ),
    },
    {
      key: "google_rating",
      header: "Rating",
      sortable: true,
      numeric: true,
      render: (s) =>
        s.google_rating != null ? (
          <span>
            {Number(s.google_rating).toFixed(1)}
            <span className="ml-1 text-xs text-muted-foreground">({s.review_count ?? 0})</span>
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: "last_contacted",
      header: "Last contacted",
      sortable: true,
      optional: true,
      render: (s) =>
        s.last_contacted ? (
          new Date(s.last_contacted).toLocaleDateString()
        ) : (
          <span className="text-muted-foreground">Never</span>
        ),
    },
    {
      key: "license_status",
      header: "Licence",
      sortable: true,
      optional: true,
      render: (s) =>
        s.license_status ? (
          <span
            className={`badge ${
              s.license_status.toLowerCase() === "active"
                ? "bg-pursue/15 text-pursue"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {s.license_status}
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: "state",
      header: "State",
      /*
       * One badge, from the same function the record page and the quick look
       * use. The roster used to show SAM exclusion and a block side by side
       * and say nothing at all about lapsed paperwork or an unusable address,
       * so a firm could read clean here and blocked on its own page.
       */
      render: (s) => {
        const v = rowState(s);
        return (
          <span className={`badge ${SUB_STATE_TONE[v.state]}`} title={v.detail}>
            {v.label}
          </span>
        );
      },
    },
    {
      key: "flags",
      header: "Flags",
      optional: true,
      render: (s) =>
        s.sb_certified ? (
          <span
            className="badge bg-gold/15 text-gold-text"
            title="Certified small business: counts toward federal small-business requirements"
          >
            Small business
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: "peek",
      header: "",
      render: (s) => (
        <Link
          href={`${peekBase}peek=${s.id}`}
          scroll={false}
          className="tap text-xs text-slate-500 underline-offset-2 hover:text-accent"
        >
          Quick look
        </Link>
      ),
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      pathname="/subs"
      filters={filters}
      sort={sort}
      paging={paging}
      total={total}
      prefsKey="brostco.subs.table"
      emptyState={emptyState}
      selection={{
        selected,
        onToggle: (id) =>
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          }),
        onToggleAll: (ids) =>
          setSelected((prev) => {
            if (ids.length === 0) return new Set();
            const all = ids.every((i) => prev.has(i));
            const next = new Set(prev);
            for (const i of ids) {
              if (all) next.delete(i);
              else next.add(i);
            }
            return next;
          }),
        bar: (ids) => (
          <>
            {/*
              Export is the one bulk action that is safe to ship before the
              others: it reads. Bulk verify, tag and archive each write to a
              roster shared across live bids, and an undo path matters more
              than the button.
            */}
            <a
              className="btn-ghost h-8 text-xs"
              href={`/api/subs/export?ids=${encodeURIComponent(ids.join(","))}`}
            >
              Export {ids.length} as CSV
            </a>
          </>
        ),
      }}
    />
  );
}
