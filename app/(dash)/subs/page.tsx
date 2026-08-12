import Link from "next/link";
import { subDatabase } from "@/lib/data";
import { PageHeader } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { PAGE_HELP } from "@/lib/help-content";
import { SubFilters } from "@/components/sub-filters";
import { ContactQuickEdit } from "@/components/contact-quick-edit";
import type { Subcontractor } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SubsPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const minRelRaw = searchParams.minReliability;
  const minReliability =
    minRelRaw != null && minRelRaw !== "" && Number.isFinite(Number(minRelRaw))
      ? Number(minRelRaw)
      : undefined;

  const filters = {
    trade: searchParams.trade || undefined,
    state: searchParams.state || undefined,
    minReliability,
    q: searchParams.q || undefined,
  };

  const subs = await subDatabase(filters);
  const contactable = subs.filter((s) => s.email && s.email_verified).length;
  const hasFilters = Boolean(
    filters.trade || filters.state || filters.q || minReliability != null
  );

  return (
    <div className="flex page-shell">
      <PageHeader
        help={PAGE_HELP["subs"]}
        title="Sub Database"
        status={
          subs.length === 0 && !hasFilters
            ? "Empty"
            : `${subs.length} subcontractor${subs.length === 1 ? "" : "s"}${
                hasFilters ? " matching filters" : ""
              } · ${contactable} contactable by email`
        }
        subtitle="Verified subcontractors Brost Co finds and reuses across bids. Preferred subs are contacted first on new work."
      />
      <SubFilters
        trade={searchParams.trade}
        state={searchParams.state}
        minReliability={minRelRaw}
        q={searchParams.q}
      />
      <div className="scroll-thin flex-1 overflow-auto p-4">
        {subs.length === 0 && !hasFilters && (
          <EmptyState
            title="Your sub database is empty"
            description="Sub Finder fills this when you pursue an opportunity: it searches for local contractors in each required trade, verifies contact info, and saves them here for future bids."
            action={
              <Link href="/pipeline" className="btn-ghost text-sm">
                Open opportunities
              </Link>
            }
          />
        )}

        {/* Mobile: stacked cards — the 9-column table is unusable on a phone. */}
        <ul
          className={`space-y-4 lg:hidden ${
            subs.length === 0 && !hasFilters ? "hidden" : ""
          }`}
        >
          {subs.map((s: Subcontractor) => (
            <li key={s.id}>
              <Link
                href={`/subs/${s.id}`}
                className="card block transition-colors hover:border-accent/60"
              >
                {/* Gold eyebrow label for mobile list cards */}
                <p className="eyebrow mb-2 md:hidden">
                  {(s.trade_categories ?? [])[0] ?? "Subcontractor"}
                </p>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {s.is_preferred ? "★ " : ""}
                      {s.company_name}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {[s.owner_name, [s.city, s.state].filter(Boolean).join(", ")]
                        .filter(Boolean)
                        .join(" · ") || "No location on file"}
                    </p>
                  </div>
                  {s.reliability_score != null && (
                    <span className="num shrink-0 text-sm font-semibold text-slate-800">
                      {s.reliability_score}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(s.trade_categories ?? []).slice(0, 4).map((t) => (
                    <span key={t} className="badge bg-slate-200 text-slate-700">
                      {t}
                    </span>
                  ))}
                  {s.email && s.email_verified ? (
                    <span className="badge bg-pursue/15 text-pursue">Email verified</span>
                  ) : s.email ? (
                    <span className="badge bg-review/15 text-review">Email unverified</span>
                  ) : (
                    <span className="badge bg-slate-200 text-slate-500">No email</span>
                  )}
                  {s.sam_excluded && (
                    <span className="badge bg-risk/15 text-risk">SAM excluded</span>
                  )}
                </div>
                {(s.phone || s.email) && (
                  <p className="mt-2 truncate text-xs text-slate-500">
                    {[s.phone, s.email].filter(Boolean).join(" · ")}
                  </p>
                )}
              </Link>
            </li>
          ))}
          {subs.length === 0 && hasFilters && (
            <li>
              <EmptyState
                title="No subcontractors match these filters"
                description="Try a broader trade, remove the reliability minimum, or clear filters to see the full roster."
                action={
                  <Link href="/subs" className="btn-ghost text-sm">
                    Clear filters
                  </Link>
                }
              />
            </li>
          )}
        </ul>

        <div
          className={`card scroll-thin hidden overflow-x-auto p-0 lg:block ${
            subs.length === 0 && !hasFilters ? "!hidden" : ""
          }`}
        >
          <table className="w-full border-collapse">
            <thead className="border-b border-border bg-surface">
              <tr>
                <th className="th w-8"></th>
                <th className="th">Company</th>
                <th className="th">Trades</th>
                <th className="th">Location</th>
                <th className="th">Rating</th>
                <th className="th">Reliability</th>
                <th className="th">Contact</th>
                <th className="th">License</th>
                <th className="th">Flags</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s: Subcontractor) => (
                <tr
                  key={s.id}
                  className="border-b border-border transition-colors hover:bg-surface"
                >
                  <td className="td text-center">
                    {s.is_preferred ? (
                      <span
                        title="Preferred sub: reliable in past work, contacted first for new bids"
                        className="text-review"
                      >
                        ★
                      </span>
                    ) : (
                      <span title="Not marked preferred" className="text-slate-300">
                        ☆
                      </span>
                    )}
                  </td>
                  <td className="td">
                    <Link
                      href={`/subs/${s.id}`}
                      className="font-medium text-slate-900 hover:text-accent"
                    >
                      {s.company_name}
                    </Link>
                    {s.owner_name && (
                      <div className="text-xs text-slate-500">{s.owner_name}</div>
                    )}
                  </td>
                  <td className="td">
                    <div className="flex flex-wrap gap-1">
                      {(s.trade_categories ?? []).slice(0, 3).map((t) => (
                        <span key={t} className="badge bg-slate-200 text-slate-700">
                          {t}
                        </span>
                      ))}
                      {(s.trade_categories?.length ?? 0) > 3 && (
                        <span className="badge bg-slate-200 text-slate-500">
                          +{(s.trade_categories?.length ?? 0) - 3}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="td whitespace-nowrap text-slate-600">
                    {[s.city, s.state].filter(Boolean).join(", ") || "-"}
                  </td>
                  <td className="td whitespace-nowrap">
                    {s.google_rating != null ? (
                      <span>
                        <span className="num text-slate-900">
                          {Number(s.google_rating).toFixed(1)}
                        </span>
                        <span className="ml-1 text-xs text-slate-500">
                          ({s.review_count ?? 0})
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-500">-</span>
                    )}
                  </td>
                  <td className="td">
                    {s.reliability_score != null ? (
                      <span className="num font-semibold text-slate-900">
                        {s.reliability_score}
                      </span>
                    ) : (
                      <span className="text-slate-500">-</span>
                    )}
                  </td>
                  <td className="td whitespace-nowrap">
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
                        Email verified
                      </span>
                    ) : s.email ? (
                      <span className="badge bg-review/15 text-review" title={s.email}>
                        Email unverified
                      </span>
                    ) : s.contact_status === "no_email_found" ? (
                      <span className="badge bg-slate-200 text-slate-600">No email found</span>
                    ) : s.contact_status === "no_website" ? (
                      <span className="badge bg-slate-200 text-slate-600">No website</span>
                    ) : (
                      <span
                        className="badge bg-slate-200 text-slate-500"
                        title="Sub Verify has not completed email discovery for this sub yet"
                      >
                        Not checked
                      </span>
                    )}
                  </td>
                  <td className="td whitespace-nowrap">
                    {s.license_status ? (
                      <span
                        className={`badge ${
                          s.license_status.toLowerCase() === "active"
                            ? "bg-pursue/15 text-pursue"
                            : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {s.license_status}
                      </span>
                    ) : (
                      <span className="text-slate-500">-</span>
                    )}
                  </td>
                  <td className="td">
                    <div className="flex flex-wrap gap-1">
                      {s.sam_excluded && (
                        <span className="badge bg-risk/15 text-risk">SAM excluded</span>
                      )}
                      {s.email_verified && (
                        <span className="badge bg-pursue/15 text-pursue">Verified</span>
                      )}
                      {s.sb_certified && (
                        <span
                          className="badge bg-accent/10 text-accent"
                          title="Certified small business (counts toward federal small-business requirements)"
                        >
                          Small business
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {subs.length === 0 && hasFilters && (
                <tr>
                  <td className="td py-8 text-center text-slate-600" colSpan={9}>
                    No subcontractors match these filters.{" "}
                    <Link href="/subs" className="text-accent hover:underline">
                      Clear filters
                    </Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
