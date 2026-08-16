import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/badges";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { adminAccountRows } from "@/lib/admin/accounts";
import { recentAdminActions } from "@/lib/admin/audit";
import { shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const ACCESS_LABEL: Record<string, { text: string; tone: string }> = {
  full: { text: "Full access", tone: "bg-pursue/15 text-pursue" },
  trial: { text: "On trial", tone: "bg-accent/15 text-accent-strong" },
  none: { text: "Locked out", tone: "bg-risk/15 text-risk" },
};

/**
 * Every account on the platform, and what each one can actually do.
 *
 * The column that matters is Access, not Status. Status is what Stripe last
 * said; Access is the answer the product will actually give the customer when
 * they click something, which is what a support question is really about. A
 * comped account reads "canceled" in Stripe and "Full access" here, and that
 * gap is the entire reason this column exists.
 */
export default async function AdminAccountsPage() {
  const auth = await requirePlatformAdmin();
  // 404 rather than 403 for a signed-in non-admin: naming the page confirms it
  // exists and is worth attacking.
  if (auth instanceof Response) notFound();

  const [rows, audit] = await Promise.all([
    adminAccountRows(),
    recentAdminActions(15),
  ]);

  const lockedOut = rows.filter((r) => r.access === "none").length;
  const comped = rows.filter((r) => r.billing_exempt).length;
  const suspended = rows.filter((r) => r.suspended_at).length;

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

        <div className="overflow-x-auto panel-inset">
          <table className="w-full min-w-[54rem] text-left text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 font-medium">Owner</th>
                <th className="px-4 py-2 font-medium">Access</th>
                <th className="px-4 py-2 font-medium">Stripe status</th>
                <th className="px-4 py-2 font-medium">Plan</th>
                <th className="px-4 py-2 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const access = ACCESS_LABEL[r.access];
                return (
                  <tr key={r.id} className="border-t border-border/60 hover:bg-surface/60">
                    <td className="px-4 py-2">
                      <Link
                        href={`/admin/accounts/${r.id}`}
                        className="font-medium text-accent-strong hover:underline"
                      >
                        {r.name}
                      </Link>
                      <div className="flex flex-wrap gap-1 pt-1">
                        {r.suspended_at && (
                          <span className="rounded bg-risk/15 px-1.5 py-0.5 text-[11px] font-medium text-risk">
                            Suspended
                          </span>
                        )}
                        {r.billing_exempt && (
                          <span className="rounded bg-pursue/15 px-1.5 py-0.5 text-[11px] font-medium text-pursue">
                            Comped
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {r.owner_email ?? <span className="text-risk">no owner</span>}
                      {r.member_count > 1 && (
                        <span className="text-xs"> +{r.member_count - 1}</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${access.tone}`}>
                        {access.text}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {r.subscription_status ?? "-"}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{r.plan_key ?? "-"}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {shortDate(r.created_at)}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No accounts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

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
