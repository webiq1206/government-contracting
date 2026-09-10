import { notFound } from "next/navigation";
import { PageFrame } from "@/components/page-frame";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { adminAccountPage, ACCOUNT_SORT_KEYS } from "@/lib/admin/accounts";
import Link from "next/link";
import { ACTIVITY_FILTERS } from "@/lib/domain/account-activity";
import { FilterToolbar } from "@/components/filter-toolbar";
import { AdminAccountsTable } from "@/components/admin-accounts-table";
import { AccountQuickViews } from "@/components/admin/account-quick-views";
import {
  parseFilters,
  parseSort,
  serializeSort,
  type FilterSpec,
} from "@/lib/domain/table-view";

export const dynamic = "force-dynamic";


/**
 * Every account on the platform, and what each one can actually do.
 *
 * The column that matters is Access, not Status. Status is what Stripe last
 * said; Access is the answer the product will actually give the customer when
 * they click something, which is what a support question is really about. A
 * comped account reads "canceled" in Stripe and "Full access" here, and that
 * gap is the entire reason this column exists.
 */
const SPECS: FilterSpec[] = [
  { key: "q", label: "Search", kind: "text", placeholder: "Account or owner email" },
  {
    key: "access",
    label: "Access",
    kind: "select",
    placeholder: "Any",
    hint: "What the product will actually let them do right now.",
    options: [
      { value: "full", label: "Full access" },
      { value: "trial", label: "Trial" },
      { value: "none", label: "Locked out" },
    ],
  },
  {
    key: "billing",
    label: "Billing",
    kind: "select",
    placeholder: "Any",
    options: [
      { value: "comped", label: "Comped" },
      { value: "paying", label: "Paying" },
      { value: "none", label: "No subscription" },
    ],
  },
  {
    key: "plan",
    label: "Plan",
    kind: "select",
    placeholder: "Any",
    options: [
      { value: "founding", label: "Founding" },
      { value: "standard", label: "Standard" },
      { value: "none", label: "No plan" },
    ],
  },
  {
    key: "activity",
    label: "Use",
    kind: "select",
    placeholder: "Any",
    hint: "Never signed in is a failed onboarding and is recoverable. Dormant is churn already under way.",
    options: ACTIVITY_FILTERS.map((f) => ({ value: f.value, label: f.label })),
  },
  {
    key: "signup",
    label: "Signed up",
    kind: "select",
    placeholder: "Any time",
    options: [
      { value: "7", label: "Last 7 days" },
      { value: "30", label: "Last 30 days" },
      { value: "90", label: "Last 90 days" },
    ],
  },
  { key: "trial", label: "On trial only", kind: "boolean" },
  { key: "suspended", label: "Suspended only", kind: "boolean" },
  {
    key: "kind",
    label: "Kind",
    kind: "select",
    placeholder: "Customers",
    hint: "The counts above only ever describe customers. Internal and test accounts are here when you ask for them.",
    options: [
      { value: "all", label: "Everything" },
      { value: "internal", label: "Internal only" },
      { value: "test", label: "Test only" },
    ],
  },
  {
    key: "noowner",
    label: "No owner",
    kind: "boolean",
    hint: "An account nobody can sign in to administer. Always worth a look.",
  },
];

export default async function AdminAccountsPage(
  props: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const auth = await requirePlatformAdmin();
  // 404 rather than 403 for a signed-in non-admin: naming the page confirms it
  // exists and is worth attacking.
  if (auth instanceof Response) notFound();

  const values = parseFilters(SPECS, searchParams);
  const sort = parseSort(searchParams, ACCOUNT_SORT_KEYS);
  const { rows, total, paging, customers, locked_out: lockedOut, comped,
    suspended, never_used: neverUsed, hidden } = await adminAccountPage(values, sort, searchParams);
  const kind = values.kind ?? "customer";
  const filtered = Object.keys(values).length > 0;

  /*
   * The quick look, as a query parameter, so the back button works and an
   * administrator can send somebody a link to the account they are asking
   * about with the filters that found it still applied.
   */

  function listHref(id: string | null): string {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (k === "peek" || v == null) continue;
      if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
      else p.set(k, v);
    }
    if (id) p.set("peek", id);
    const q = p.toString();
    return q ? `/admin/accounts?${q}` : "/admin/accounts";
  }
  const peekBase = (() => {
    const href = listHref(null);
    return href.includes("?") ? `${href}&` : `${href}?`;
  })();

  return (
    <>
      <PageFrame
        breadcrumbs={[{ label: "Platform admin" }]}
        title="All accounts"
        explanation="Every organization, who owns it, and whether it can use the product right now."
      />
      <AccountQuickViews rows={rows}>
      <div className="scroll-thin min-w-0 flex-1 space-y-6 overflow-y-auto p-5">
        {/*
          * Whole-platform counts, and each one is a filter.
          *
          * "Accounts" read `rows.length`, which is the current page rather
          * than the platform, so a page of 25 out of 300 organizations
          * reported 25 accounts under a comment saying these describe the
          * whole platform. The other three were already right, which is what
          * made the wrong one so easy to believe.
          */}
        <details className="rounded-lg border border-border bg-surface p-3">
          <summary className="cursor-pointer py-2 text-sm font-medium">{customers} customer accounts · {lockedOut} locked out · Account overview</summary>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Customers" value={customers} href="/admin/accounts" />
          <Stat
            label="Locked out"
            value={lockedOut}
            tone={lockedOut ? "text-risk" : undefined}
            href="/admin/accounts?access=none"
          />
          <Stat
            label="Never signed in"
            value={neverUsed}
            tone={neverUsed ? "text-review" : undefined}
            href="/admin/accounts?activity=never"
          />
          <Stat label="Comped" value={comped} href="/admin/accounts?billing=comped" />
          <Stat
            label="Suspended"
            value={suspended}
            tone={suspended ? "text-risk" : undefined}
            href="/admin/accounts?suspended=1"
          />
        </div>
        </details>

        <FilterToolbar
          pathname="/admin/accounts"
          specs={SPECS}
          values={values}
          sortParam={serializeSort(sort)}
          perPage={paging.perPage}
          viewsKey="brostco.admin.accounts.views"
          /* None is a count too. See the note on the Subcontractors page. */
          resultLabel={
            total > 0
              ? `Showing ${paging.from}-${paging.to} of ${total}`
              : Object.keys(values).length > 0
                ? "No accounts match these filters"
                : "No accounts yet"
          }
        />

        {/* Stated rather than silent: a hidden row is one thing, a hidden
            row nobody knows is hidden is a page that lies about its total. */}
        {hidden > 0 && kind !== "all" && (
          <p className="text-xs text-muted-foreground">
            {hidden} account{hidden === 1 ? " is" : "s are"} outside the selected kind. The Kind filter shows them.
          </p>
        )}

        <AdminAccountsTable
          peekBase={peekBase}
          rows={rows}
          total={total}
          filters={values}
          sort={sort}
          paging={paging}
          emptyState={
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {filtered ? "No accounts match these filters." : "No accounts yet."}
            </p>
          }
        />

        {/*
          * The audit log has its own area now. The audit asks for it, and the
          * reason is that it answers a different question: this page is "which
          * account is in trouble", and the log is "what did we do to somebody".
          * Mixing them meant fifteen arbitrary rows of history under a table
          * that scrolls, which is neither a summary nor a record.
          */}
        <p className="text-sm text-muted-foreground">
          Everything administrators have done to other people&apos;s accounts is kept in the{" "}
          <Link href="/admin/audit" className="font-medium text-accent hover:underline">
            admin audit log
          </Link>
          , including for accounts that have since been deleted.
        </p>

      </div>

      </AccountQuickViews>
    </>
  );
}

/** A count, and the filtered list it counts. The audit asks for these to be clickable. */
function Stat({
  label,
  value,
  tone,
  href,
}: {
  label: string;
  value: number;
  tone?: string;
  href: string;
}) {
  return (
    <Link href={href} className="panel-inset block p-3 transition-colors hover:border-accent/50">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${tone ?? ""}`}>{value}</div>
    </Link>
  );
}
