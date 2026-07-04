import Link from "next/link";
import { subDatabase } from "@/lib/data";
import { PageHeader } from "@/components/badges";
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
        <div className="card overflow-hidden p-0">
          <table className="w-full border-collapse">
            <thead className="border-b border-ink-800 bg-ink-900/60">
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
                  className="border-b border-ink-800/60 transition-colors hover:bg-ink-800/40"
                >
                  <td className="td text-center">
                    {s.is_preferred ? (
                      <span title="Preferred" className="text-review">
                        ★
                      </span>
                    ) : (
                      <span className="text-slate-700">☆</span>
                    )}
                  </td>
                  <td className="td">
                    <Link
                      href={`/subs/${s.id}`}
                      className="font-medium text-slate-100 hover:text-brand-400"
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
                        <span key={t} className="badge bg-ink-700 text-slate-300">
                          {t}
                        </span>
                      ))}
                      {(s.trade_categories?.length ?? 0) > 3 && (
                        <span className="badge bg-ink-700 text-slate-500">
                          +{(s.trade_categories?.length ?? 0) - 3}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="td whitespace-nowrap text-slate-400">
                    {[s.city, s.state].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="td whitespace-nowrap">
                    {s.google_rating != null ? (
                      <span>
                        <span className="num text-slate-100">
                          {s.google_rating.toFixed(1)}
                        </span>
                        <span className="ml-1 text-xs text-slate-500">
                          ({s.review_count ?? 0})
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="td">
                    {s.reliability_score != null ? (
                      <span className="num font-semibold text-slate-100">
                        {s.reliability_score}
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="td whitespace-nowrap">
                    {s.license_status ? (
                      <span
                        className={`badge ${
                          s.license_status.toLowerCase() === "active"
                            ? "bg-pursue/15 text-pursue"
                            : "bg-ink-700 text-slate-300"
                        }`}
                      >
                        {s.license_status}
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
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
                        <span className="badge bg-brand-600/20 text-brand-400">SB</span>
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
