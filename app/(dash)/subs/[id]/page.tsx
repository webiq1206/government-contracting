import Link from "next/link";
import { notFound } from "next/navigation";
import { subDetail } from "@/lib/data";
import { PageHeader } from "@/components/badges";
import { SubNotes } from "@/components/sub-notes";
import { SubEditor } from "@/components/sub-editor";
import { currency, timeAgo, shortDate } from "@/lib/format";
import type { ProjectHistoryItem } from "@/lib/types";

export const dynamic = "force-dynamic";

function s(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
    </div>
  );
}

export default async function SubDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const detail = await subDetail(params.id);
  if (!detail) notFound();

  const { sub, communications, quotes } = detail;
  const projects: ProjectHistoryItem[] = Array.isArray(sub.project_history)
    ? sub.project_history
    : [];

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title={sub.company_name}
        subtitle={
          [sub.owner_name, [sub.city, sub.state].filter(Boolean).join(", ")]
            .filter(Boolean)
            .join(" · ") || undefined
        }
      >
        {sub.is_preferred && (
          <span className="badge bg-review/15 text-review">★ Preferred</span>
        )}
        <Link href="/subs" className="btn-ghost">
          Back to database
        </Link>
      </PageHeader>

      <div className="scroll-thin flex-1 space-y-6 overflow-auto p-5">
        {/* Contact + scores */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label="Google rating"
            value={
              sub.google_rating != null ? (
                <>
                  {Number(sub.google_rating).toFixed(1)}
                  <span className="ml-1 text-xs font-normal text-slate-500">
                    ({sub.review_count ?? 0})
                  </span>
                </>
              ) : (
                "-"
              )
            }
          />
          <Stat
            label="Reliability"
            value={sub.reliability_score != null ? sub.reliability_score : "-"}
          />
          <Stat
            label="Responsiveness"
            value={sub.responsiveness_score != null ? sub.responsiveness_score : "-"}
          />
          <Stat
            label="Last contacted"
            value={
              <span className="text-sm">{sub.last_contacted ? timeAgo(sub.last_contacted) : "-"}</span>
            }
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {/* Contact + verification (editable in place) */}
            <SubEditor
              sub={{
                id: sub.id,
                company_name: sub.company_name,
                owner_name: sub.owner_name ?? null,
                email: sub.email ?? null,
                email_verified: Boolean(sub.email_verified),
                phone: sub.phone ?? null,
                website: sub.website ?? null,
                license_number: sub.license_number ?? null,
                license_status: sub.license_status ?? null,
                sam_excluded: Boolean(sub.sam_excluded),
                trade_categories: sub.trade_categories ?? [],
                address: sub.address ?? null,
                city: sub.city ?? null,
                state: sub.state ?? null,
                is_preferred: Boolean(sub.is_preferred),
                reviews_summary: sub.reviews_summary ?? null,
              }}
            />

            {/* Project history */}
            <div className="card">
              <h2 className="mb-3 text-sm font-semibold text-neutral-900">
                Project History{" "}
                <span className="font-normal text-slate-500">({projects.length})</span>
              </h2>
              {projects.length === 0 ? (
                <p className="text-sm text-slate-500">No project history on file.</p>
              ) : (
                <div className="space-y-2">
                  {projects.map((p, i) => (
                    <div
                      key={i}
                      className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0"
                    >
                      <div>
                        <div className="text-sm font-medium text-slate-900">{p.name}</div>
                        <div className="text-xs text-slate-500">
                          {p.scope}
                          {p.client_type ? ` · ${p.client_type}` : ""}
                          {p.year ? ` · ${p.year}` : ""}
                        </div>
                      </div>
                      <div className="whitespace-nowrap text-sm num text-slate-700">
                        {currency(p.value)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Communications timeline */}
            <div className="card">
              <h2 className="mb-3 text-sm font-semibold text-neutral-900">
                Communications & Call History{" "}
                <span className="font-normal text-slate-500">({communications.length})</span>
              </h2>
              {communications.length === 0 ? (
                <p className="text-sm text-slate-500">No communications logged.</p>
              ) : (
                <div className="space-y-3">
                  {communications.map((c, i) => {
                    const channel = s(c.channel) ?? "note";
                    const direction = s(c.direction);
                    const subject = s(c.subject);
                    const bodyText = s(c.body);
                    const createdAt = s(c.created_at);
                    return (
                      <div
                        key={s(c.id) ?? i}
                        className="border-l-2 border-border pl-3"
                      >
                        <div className="flex items-center gap-2 text-xs">
                          <span className="badge bg-slate-200 text-slate-700">{channel}</span>
                          {direction && (
                            <span className="text-slate-500">{direction}</span>
                          )}
                          <span className="ml-auto text-slate-500">
                            {timeAgo(createdAt)}
                          </span>
                        </div>
                        {subject && (
                          <div className="mt-1 text-sm font-medium text-slate-900">
                            {subject}
                          </div>
                        )}
                        {bodyText && (
                          <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-600">
                            {bodyText}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Quotes */}
            <div className="card">
              <h2 className="mb-3 text-sm font-semibold text-neutral-900">
                Quotes <span className="font-normal text-slate-500">({quotes.length})</span>
              </h2>
              {quotes.length === 0 ? (
                <p className="text-sm text-slate-500">No quotes on file.</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="th">Opportunity</th>
                      <th className="th">Amount</th>
                      <th className="th">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quotes.map((q, i) => {
                      const amt = q.quote_amount;
                      return (
                        <tr key={s(q.id) ?? i} className="border-t border-border">
                          <td className="td">{s(q.opportunity_title) ?? "-"}</td>
                          <td className="td num">
                            {typeof amt === "number" ? currency(amt) : currency(Number(amt) || null)}
                          </td>
                          <td className="td text-slate-500">{shortDate(s(q.created_at))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Permanent notes */}
          <div className="lg:col-span-1">
            <div className="card sticky top-4">
              <h2 className="mb-3 text-sm font-semibold text-neutral-900">Permanent Notes</h2>
              <p className="mb-3 text-xs text-slate-500">
                Editable after every call. Saved permanently to this sub.
              </p>
              <SubNotes subId={sub.id} initialNotes={sub.notes} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
