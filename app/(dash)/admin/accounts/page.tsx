import { notFound } from "next/navigation";
import { PageHeader } from "@/components/badges";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { adminAccountRows, type AdminAccountRow } from "@/lib/admin/accounts";
import { recentAdminActions } from "@/lib/admin/audit";
import { shortDate } from "@/lib/format";
import { FilterToolbar } from "@/components/filter-toolbar";
import { AdminAccountsTable } from "@/components/admin-accounts-table";
import {
  parseFilters,
  parseSort,
  parsePaging,
  serializeSort,
  sortRows,
  pageRows,
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
  { key: "suspended", label: "Suspended only", kind: "boolean" },
  {
    key: "noowner",
    label: "No owner",
    kind: "boolean",
    hint: "An account nobody can sign in to administer. Always worth a look.",
  },
];

const SORT_ACCESSORS: Record<string, (r: AdminAccountRow) => unknown> = {
  name: (r) => r.name,
  owner_email: (r) => r.owner_email,
  access: (r) => r.access,
  subscription_status: (r) => r.subscription_status,
  plan_key: (r) => r.plan_key,
  member_count: (r) => r.member_count,
  created_at: (r) => r.created_at,
};

export default async function AdminAccountsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const auth = await requirePlatformAdmin();
  // 404 rather than 403 for a signed-in non-admin: naming the page confirms it
  // exists and is worth attacking.
  if (auth instanceof Response) notFound();

  const [all, audit] = await Promise.all([
    adminAccountRows(),
    recentAdminActions(15),
  ]);

  // Headline counts describe the WHOLE platform, not the current filter. A
  // number that moves when you type in a search box is not a fact about the
  // business, and these are the four an admin opens this page to check.
  const lockedOut = all.filter((r) => r.access === "none").length;
  const comped = all.filter((r) => r.billing_exempt).length;
  const suspended = all.filter((r) => r.suspended_at).length;

  const values = parseFilters(SPECS, searchParams);
  const needle = (values.q ?? "").toLowerCase();
  const matched = all.filter((r) => {
    if (needle && !`${r.name} ${r.owner_email ?? ""}`.toLowerCase().includes(needle)) return false;
    if (values.access && r.access !== values.access) return false;
    if (values.billing === "comped" && !r.billing_exempt) return false;
    if (values.billing === "paying" && (r.billing_exempt || !r.subscription_status)) return false;
    if (values.billing === "none" && r.subscription_status) return false;
    if (values.suspended === "1" && !r.suspended_at) return false;
    if (values.noowner === "1" && r.owner_email) return false;
    return true;
  });

  const sort = parseSort(searchParams, Object.keys(SORT_ACCESSORS));
  const paging = parsePaging(searchParams, matched.length);
  const rows = pageRows(sortRows(matched, sort, SORT_ACCESSORS), paging);
  const filtered = Object.keys(values).length > 0;

  return (
    <>
      <PageHeader
        eyebrow="Platform admin"
        title="All accounts"
        subtitle="Every organization, who owns it, and whether it can use the product right now."
      />
      <div className="scroll-thin flex-1 space-y-6 overflow-y-auto p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Accounts" value={rows.length} />
          <Stat label="Locked out" value={lockedOut} tone={lockedOut ? "text-risk" : undefined} />
          <Stat label="Comped" value={comped} />
          <Stat label="Suspended" value={suspended} tone={suspended ? "text-risk" : undefined} />
        </div>

        <FilterToolbar
          pathname="/admin/accounts"
          specs={SPECS}
          values={values}
          sortParam={serializeSort(sort)}
          perPage={paging.perPage}
          viewsKey="brostco.admin.accounts.views"
          resultLabel={
            matched.length > 0
              ? `Showing ${paging.from}-${paging.to} of ${matched.length}`
              : undefined
          }
        />

        <AdminAccountsTable
          rows={rows}
          total={matched.length}
          filters={values}
          sort={sort}
          paging={paging}
          emptyState={
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {filtered ? "No accounts match these filters." : "No accounts yet."}
            </p>
          }
        />

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Recent admin activity</h2>
          <p className="text-xs text-muted-foreground">
            Everything administrators have done to other people&apos;s accounts. Kept
            even after an account is deleted.
          </p>
          <div className="panel-inset">
            {audit.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                Nothing yet.
              </p>
            ) : (
              <ul className="divide-y divide-border/60 text-sm">
                {audit.map((a) => (
                  <li key={a.id} className="flex flex-wrap gap-x-2 px-4 py-2">
                    <span className="text-muted-foreground">{shortDate(a.created_at)}</span>
                    <span className="font-medium">{a.admin_email}</span>
                    <span>{a.action.replace(/_/g, " ")}</span>
                    {a.target_org_name && (
                      <span className="text-muted-foreground">{a.target_org_name}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="panel-inset p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}
