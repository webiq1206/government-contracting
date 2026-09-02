import Link from "next/link";
import { notFound } from "next/navigation";
import { PageFrame } from "@/components/page-frame";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { recentAdminActions } from "@/lib/admin/audit";
import { shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * What administrators have done to other people's accounts.
 *
 * Its own area, which the audit asks for, and the reason is that it answers a
 * different question from the accounts list. That page is "which account is in
 * trouble"; this is "what did we do, to whom, and when". Fifteen arbitrary
 * rows underneath a table that scrolls was neither a summary nor a record.
 *
 * Append-only, and kept for accounts that no longer exist: deleting an account
 * must not erase the evidence that it was deleted. The consequence is that
 * every test organization ever created and torn down is in here too, so the
 * default view filters them out by the same matcher the purge tool uses, and
 * `?tests=1` brings them back for anyone who wants the raw log.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams?: { tests?: string };
}) {
  const auth = await requirePlatformAdmin();
  // 404 rather than 403 for a signed-in non-admin: naming the page confirms it
  // exists and is worth attacking.
  if (auth instanceof Response) notFound();

  const includeTests = searchParams?.tests === "1";
  const entries = await recentAdminActions(200, { includeTestAccounts: includeTests });

  return (
    <>
      <PageFrame
        breadcrumbs={[
          { label: "Platform admin" },
          { label: "All accounts", href: "/admin/accounts" },
        ]}
        title="Admin audit log"
        explanation="Every administrative action taken on a customer account, kept even after the account is gone."
        status={
          entries.length === 0
            ? includeTests
              ? "Nothing recorded"
              : "Nothing recorded on real accounts"
            : `${entries.length} action${entries.length === 1 ? "" : "s"}${includeTests ? ", test accounts included" : ""}`
        }
      />
      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/audit"
            aria-current={!includeTests ? "true" : undefined}
            className={`tap rounded-full border px-3 py-1 text-xs font-medium ${
              !includeTests
                ? "border-accent bg-accent/10 text-accent"
                : "border-border bg-surface text-slate-600 hover:border-accent/50"
            }`}
          >
            Real accounts
          </Link>
          <Link
            href="/admin/audit?tests=1"
            aria-current={includeTests ? "true" : undefined}
            className={`tap rounded-full border px-3 py-1 text-xs font-medium ${
              includeTests
                ? "border-accent bg-accent/10 text-accent"
                : "border-border bg-surface text-slate-600 hover:border-accent/50"
            }`}
          >
            Include test accounts
          </Link>
        </div>

        {entries.length === 0 ? (
          <p className="panel-inset px-4 py-8 text-center text-sm text-muted-foreground">
            {includeTests
              ? "No administrative action has been recorded."
              : "No administrative action has been taken on a real account. Test history is hidden; include it above if you are looking for a specific run."}
          </p>
        ) : (
          <>
          <ul className="space-y-2 lg:hidden">
            {entries.map((a) => (
              <li key={a.id} className="panel-inset p-3">
                <p className="text-xs text-muted-foreground">{shortDate(a.created_at)}</p>
                <p className="mt-1 text-sm font-medium text-foreground">{a.action.replace(/_/g, " ")}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{a.admin_email}</p>
                <p className="mt-1 text-sm">
                  {a.target_org_id ? (
                    <Link
                      href={`/admin/accounts/${a.target_org_id}`}
                      className="text-accent hover:underline"
                    >
                      {a.target_org_name ?? a.target_org_id}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">
                      {a.target_org_name ?? "-"}
                    </span>
                  )}
                </p>
                {a.detail && Object.keys(a.detail).length > 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {Object.entries(a.detail)
                      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`)
                      .join(" · ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="panel-inset scroll-thin hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Administrator</th>
                  <th className="px-4 py-2 font-medium">Action</th>
                  <th className="px-4 py-2 font-medium">Account</th>
                  <th className="px-4 py-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((a) => (
                  <tr key={a.id} className="border-t border-border/60 align-top">
                    <td className="px-4 py-2 text-muted-foreground">{shortDate(a.created_at)}</td>
                    <td className="px-4 py-2 font-medium">{a.admin_email}</td>
                    <td className="px-4 py-2">{a.action.replace(/_/g, " ")}</td>
                    <td className="px-4 py-2">
                      {/* The account name is kept on the audit row itself, so a
                          deleted account still reads as a name rather than as a
                          dangling identifier. */}
                      {a.target_org_id ? (
                        <Link
                          href={`/admin/accounts/${a.target_org_id}`}
                          className="text-accent hover:underline"
                        >
                          {a.target_org_name ?? a.target_org_id}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">
                          {a.target_org_name ?? "-"}
                        </span>
                      )}
                    </td>
                    {/* Stored as JSON, so it is read out as key and value
                        rather than dumped: an admin reading a suspension wants
                        the reason, not a serialized object. */}
                    <td className="px-4 py-2 text-muted-foreground">
                      {a.detail && Object.keys(a.detail).length > 0
                        ? Object.entries(a.detail)
                            .map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`)
                            .join(" · ")
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </>
  );
}
