import Link from "next/link";
import { subDatabase } from "@/lib/data";
import { PageHeader } from "@/components/badges";
import { PAGE_HELP } from "@/lib/help-content";
import { SubFilters } from "@/components/sub-filters";
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

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        help={PAGE_HELP["subs"]}
        title="Sub Database"
        subtitle={`${subs.length} subcontractor${subs.length === 1 ? "" : "s"}${
          filters.trade || filters.state || filters.q || minReliability != null
            ? " matching filters"
            : ""
        }`}
      />
      <SubFilters
        trade={searchParams.trade}
        state={searchParams.state}
        minReliability={minRelRaw}
        q={searchParams.q}
      />
      <div className="scroll-thin flex-1 overflow-auto p-4">
        {subs.length === 0 && !(filters.trade || filters.state || filters.q || minReliability != null) && (
          <div className="card mx-auto mt-8 max-w-md text-center">
            <p className="text-3xl">🏗️</p>
            <p className="mt-3 text-base font-semibold text-foreground">
              Your sub database is empty.
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Sub Finder fills this automatically when an opportunity is pursued:
              it searches for local contractors in each required trade, verifies
              them, and saves them here for future bids.
            </p>
          </div>
        )}
        <div
          className={`card scroll-thin overflow-x-auto p-0 ${
            subs.length === 0 && !(filters.trade || filters.state || filters.q || minReliability != null)
              ? "hidden"
              : ""
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
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                  <td className="td">
                    {s.reliability_score != null ? (
                      <span className="num font-semibold text-slate-900">
                        {s.reliability_score}
                      </span>
                    ) : (
                      <span className="text-slate-400">-</span>
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
                      <span className="text-slate-400">-</span>
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
              {subs.length === 0 && (
                <tr>
                  <td className="td py-8 text-center text-slate-500" colSpan={8}>
                    No subcontractors match these filters.
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
