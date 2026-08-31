"use client";

import Link from "next/link";
import { DataTable, type Column } from "@/components/data-table";
import { shortDate } from "@/lib/format";
import type { FilterValues, PageState, SortState } from "@/lib/domain/table-view";
import type { AdminAccountRow } from "@/lib/admin/accounts";
import { activityOf } from "@/lib/domain/account-activity";

const ACCESS_LABEL: Record<string, { text: string; tone: string }> = {
  full: { text: "Full access", tone: "bg-pursue/15 text-pursue" },
  trial: { text: "Trial", tone: "bg-review/15 text-review" },
  none: { text: "Locked out", tone: "bg-risk/15 text-risk" },
};

/**
 * Every account, as a table an operator can interrogate.
 *
 * The column that matters is Access, not Stripe status. Stripe status is what
 * Stripe last said; Access is the answer the product will actually give the
 * customer when they click something, which is what a support question is
 * really about. A comped account reads "canceled" in Stripe and "Full access"
 * here, and that gap is the entire reason the column exists.
 */
export function AdminAccountsTable({
  rows,
  total,
  filters,
  sort,
  paging,
  emptyState,
  peekBase,
}: {
  rows: AdminAccountRow[];
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
  const columns: Column<AdminAccountRow>[] = [
    {
      key: "name",
      header: "Account",
      sortable: true,
      render: (r) => (
        <>
          <Link
            href={`/admin/accounts/${r.id}`}
            /*
             * A width floor as well as a height one. The link is as wide as
             * the account name, so a customer called "Ace" got a 32 by 44
             * target while a long name got a comfortable one. Found by the
             * sweep only because a fixture account happened to be named
             * "Beta": the seeded account is "BROST CO", wide enough to pass,
             * so this had never been visible.
             */
            className="inline-flex min-h-11 min-w-11 items-center font-medium text-foreground hover:text-gold-text lg:min-h-0 lg:min-w-0"
          >
            {r.name}
          </Link>
          <div className="flex flex-wrap gap-1 pt-1">
            {r.suspended_at && <span className="badge bg-risk/15 text-risk">Suspended</span>}
            {r.billing_exempt && <span className="badge bg-pursue/15 text-pursue">Comped</span>}
          </div>
        </>
      ),
    },
    {
      key: "owner_email",
      header: "Owner",
      sortable: true,
      render: (r) => (
        <span className="text-muted-foreground">
          {r.owner_email ?? <span className="text-risk">no owner</span>}
          {r.member_count > 1 && <span className="text-xs"> +{r.member_count - 1}</span>}
        </span>
      ),
    },
    {
      key: "access",
      header: "Access",
      sortable: true,
      hint: "What the product will actually let them do right now.",
      render: (r) => {
        const a = ACCESS_LABEL[r.access] ?? { text: r.access, tone: "bg-muted text-muted-foreground" };
        return <span className={`badge ${a.tone}`}>{a.text}</span>;
      },
    },
    {
      key: "subscription_status",
      header: "Stripe status",
      sortable: true,
      hint: "What Stripe last said. Can disagree with Access, and often should.",
      render: (r) => <span className="text-muted-foreground">{r.subscription_status ?? "-"}</span>,
    },
    {
      key: "plan_key",
      header: "Plan",
      sortable: true,
      optional: true,
      render: (r) => <span className="text-muted-foreground">{r.plan_key ?? "-"}</span>,
    },
    {
      key: "member_count",
      header: "People",
      sortable: true,
      numeric: true,
      optional: true,
      render: (r) => r.member_count,
    },
    {
      key: "created_at",
      header: "Joined",
      sortable: true,
      render: (r) => <span className="text-muted-foreground">{shortDate(r.created_at)}</span>,
    },
    {
      key: "last_active_at",
      header: "Last used",
      sortable: true,
      hint: "The most recent real sign-in. Support sessions are not counted, or every account anyone looked at would read as freshly active.",
      render: (r) => {
        const a = activityOf(r.last_active_at, r.created_at);
        return (
          <span
            className={
              a.state === "never"
                ? a.attention
                  ? "text-review"
                  : "text-muted-foreground"
                : a.state === "dormant"
                  ? "text-review"
                  : "text-muted-foreground"
            }
            title={a.meaning}
          >
            {a.state === "never" ? "Never" : `${a.daysSince}d ago`}
          </span>
        );
      },
    },
    {
      /*
       * The quick look, in the same place the roster puts it.
       *
       * A support question is nearly always "what is going on with this one",
       * and answering it used to mean leaving a filtered, sorted table for a
       * record page and coming back to a table that had forgotten both.
       */
      key: "peek",
      header: "",
      render: (r) => (
        <Link
          href={`${peekBase}peek=${r.id}`}
          scroll={false}
          className="tap text-xs text-muted-foreground underline-offset-2 hover:text-accent"
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
      pathname="/admin/accounts"
      filters={filters}
      sort={sort}
      paging={paging}
      total={total}
      prefsKey="brostco.admin.accounts.table"
      emptyState={emptyState}
    />
  );
}
