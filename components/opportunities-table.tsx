"use client";

import Link from "next/link";
import { DataTable, type Column } from "@/components/data-table";
import { ScoreBadge } from "@/components/badges";
import { DeadlineBadge } from "@/components/deadline-badge";
import { STAGE_LABEL } from "@/lib/domain/journey";
import { currency, shortDate } from "@/lib/format";
import type { FilterValues, PageState, SortState } from "@/lib/domain/table-view";
import type { AutomationRules } from "@/lib/domain/intake";
import type { Opportunity } from "@/lib/types";
import { describeOwner, type Owner } from "@/lib/domain/ownership";
import { AgencyPath } from "@/components/agency-path";

/**
 * Every opportunity, as a table.
 *
 * The board is the right tool for moving one job along and the wrong one for
 * answering "which of these is due this week", "what have we got in Texas", or
 * "which scores rest on a value nobody published". Past a hundred cards it is
 * a wall of tiles. This is the same records, in the shape you interrogate
 * rather than the shape you drag.
 *
 * The board stays: they answer different questions and neither replaces the
 * other.
 */
export function OpportunitiesTable({
  rows,
  total,
  filters,
  sort,
  paging,
  rules,
  emptyState,
  peekBase,
  owners,
  viewerId,
}: {
  rows: Opportunity[];
  total: number;
  filters: FilterValues;
  sort: SortState;
  paging: PageState;
  rules?: AutomationRules;
  emptyState: React.ReactNode;
  /** The current list URL with the peek stripped, ready for `peek=<id>`. */
  peekBase: string;
  /** Owners by opportunity id, read once for the page rather than per row. */
  owners?: Map<string, Owner>;
  viewerId?: string;
}) {
  const columns: Column<Opportunity>[] = [
    {
      key: "title",
      header: "Opportunity",
      sortable: true,
      render: (o) => (
        <>
          <Link
            href={`/opportunity/${o.id}`}
            className="font-medium text-foreground hover:text-gold-text"
          >
            {o.title ?? "Untitled opportunity"}
          </Link>
          {o.solicitation_number && (
            <div className="text-xs text-muted-foreground">{o.solicitation_number}</div>
          )}
        </>
      ),
    },
    {
      key: "agency",
      header: "Agency",
      sortable: true,
      /*
       * The most specific level, not the first forty characters.
       *
       * Truncation cut at a character count rather than at a meaning, so every
       * row read "DEPT OF DEFENSE, DEPT OF THE A..." and the part that varied
       * was the part that got cut. The rest of the path is in the DOM for a
       * screen reader and in the title for a mouse, so nothing here is
       * hover-only.
       */
      render: (o) => (
        <AgencyPath
          agency={o.agency}
          subAgency={o.sub_agency}
          className="block max-w-[16rem] truncate text-muted-foreground"
        />
      ),
    },
    {
      key: "stage",
      header: "Stage",
      sortable: true,
      render: (o) => (
        <span className="badge bg-muted text-muted-foreground">
          {STAGE_LABEL[o.stage] ?? o.stage.replace(/_/g, " ")}
        </span>
      ),
    },
    {
      key: "needs",
      header: "Waiting on",
      hint: "Whether this is sitting with you or with someone else.",
      render: (o) =>
        o.human_action_required ? (
          <span className="badge bg-review/15 text-review">You</span>
        ) : (
          <span className="badge bg-muted text-muted-foreground">Not you</span>
        ),
    },
    {
      key: "deadline",
      header: "Due",
      sortable: true,
      render: (o) =>
        o.deadline ? (
          <DeadlineBadge deadline={o.deadline} rules={rules} />
        ) : (
          <span className="text-muted-foreground">No date</span>
        ),
    },
    {
      key: "score",
      header: "Score",
      sortable: true,
      numeric: true,
      render: (o) => (o.score != null ? <ScoreBadge score={o.score} /> : <span className="text-muted-foreground">-</span>),
    },
    {
      key: "value_estimated",
      header: "Value",
      sortable: true,
      numeric: true,
      hint: "Most federal notices publish no value. Blank means unknown, not zero.",
      render: (o) =>
        o.value_estimated != null ? (
          currency(o.value_estimated)
        ) : (
          // Never a zero. A missing value is an unknown, and printing $0 turns
          // an absent fact into a claim about the size of the job.
          <span className="text-muted-foreground" title="Not published in this notice">
            Unknown
          </span>
        ),
    },
    {
      key: "location_state",
      header: "State",
      sortable: true,
      optional: true,
      render: (o) => o.location_state ?? "-",
    },
    {
      key: "set_aside_type",
      header: "Set-aside",
      optional: true,
      render: (o) => (
        <span className="block max-w-[12rem] truncate" title={o.set_aside_type ?? ""}>
          {o.set_aside_type || "Unrestricted"}
        </span>
      ),
    },
    {
      key: "naics_code",
      header: "NAICS",
      optional: true,
      render: (o) => o.naics_code ?? "-",
    },
    {
      key: "owner",
      header: "Owner",
      optional: true,
      /*
       * Read-only here. Assigning belongs on the record, where the person
       * doing it can see the deadline and the stage they are taking on; a
       * dropdown in a two-hundred-row table is a mis-click that hands
       * somebody else's bid to the wrong person without either of them
       * noticing.
       */
      render: (o) => (
        <span className="text-muted-foreground">{describeOwner(owners?.get(o.id), viewerId)}</span>
      ),
    },
    {
      key: "updated_at",
      header: "Last touched",
      sortable: true,
      optional: true,
      render: (o) => (
        <span className="text-muted-foreground">{shortDate(o.updated_at)}</span>
      ),
    },
    {
      key: "peek",
      header: "",
      render: (o) => (
        <Link
          href={`${peekBase}peek=${o.id}`}
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
      pathname="/pipeline"
      filters={{ ...filters, view: "table" }}
      sort={sort}
      paging={paging}
      total={total}
      prefsKey="brostco.opportunities.table"
      emptyState={emptyState}
    />
  );
}
