"use client";

import { useState } from "react";
import Link from "next/link";
import { DataTable, type Column } from "@/components/data-table";
import { ContactQuickEdit } from "@/components/contact-quick-edit";
import type { FilterValues, PageState, SortState } from "@/lib/domain/table-view";
import type { Subcontractor } from "@/lib/types";

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
      hint: "0-100, from how consistently this firm answers, quotes on time, and delivers.",
      render: (s) =>
        s.reliability_score != null ? (
          <span className="font-semibold text-foreground">{s.reliability_score}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
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
      key: "flags",
      header: "Flags",
      optional: true,
      render: (s) => (
        <div className="flex flex-wrap gap-1">
          {s.sam_excluded && <span className="badge bg-risk/15 text-risk">SAM excluded</span>}
          {s.blacklisted && <span className="badge bg-risk/15 text-risk">Blocked</span>}
          {s.sb_certified && (
            <span
              className="badge bg-gold/15 text-gold-text"
              title="Certified small business: counts toward federal small-business requirements"
            >
              Small business
            </span>
          )}
        </div>
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
