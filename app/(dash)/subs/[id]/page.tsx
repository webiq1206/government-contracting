import Link from "next/link";
import { notFound } from "next/navigation";
import { subDetail } from "@/lib/data";
import { PageHeader } from "@/components/badges";
import { SubNotes } from "@/components/sub-notes";
import { SubEditor } from "@/components/sub-editor";
import { InfoTip } from "@/components/info-tip";
import {
  contactBadgeClass,
  contactStatusHint,
  contactStatusLabel,
  outreachBadgeClass,
  outreachHint,
  outreachLabel,
} from "@/lib/domain/sub-contact";
import { stageLabel } from "@/lib/domain/journey";
import { currency, timeAgo, shortDate } from "@/lib/format";
import type { ProjectHistoryItem } from "@/lib/types";

export const dynamic = "force-dynamic";

function s(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function Stat({
  label,
  value,
  tip,
}: {
  label: string;
  value: React.ReactNode;
  tip?: string;
}) {
  return (
    <div className="card">
      <div className="label flex items-center gap-1">
        {label}
        {tip ? <InfoTip label={`About ${label}`}>{tip}</InfoTip> : null}
      </div>
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

  const { sub, communications, quotes, stats, pairings } = detail;
  const projects: ProjectHistoryItem[] = Array.isArray(sub.project_history)
    ? sub.project_history
    : [];
  const contactLabel = contactStatusLabel(sub.contact_status);
  const openPairings = pairings.filter((p) => p.status === "open").length;

  return (
    <div className="flex page-shell">
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
        {contactLabel && (
          <span
            className={`badge inline-flex items-center gap-1 ${contactBadgeClass(sub.contact_status)}`}
          >
            {contactLabel}
            <InfoTip label={`Contactability: ${contactLabel}`}>
              {contactStatusHint(sub.contact_status)}
            </InfoTip>
          </span>
        )}
        <Link href="/subs" className="btn-ghost">
          Back to database
        </Link>
      </PageHeader>

      <div className="scroll-thin flex-1 space-y-6 overflow-auto p-5">
        {/* Contact metrics — live totals from saved communications */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
          <Stat
            label="Emails sent"
            tip="Outbound emails saved on this sub’s record across every opportunity."
            value={<span className="num">{stats.emails_sent}</span>}
          />
          <Stat
            label="Replies"
            tip="Inbound emails captured for this sub."
            value={<span className="num">{stats.emails_in}</span>}
          />
          <Stat
            label="Calls logged"
            tip="Completed call workspace saves recorded as call history."
            value={<span className="num">{stats.calls_logged}</span>}
          />
          <Stat
            label="Skipped calls"
            tip="Times an operator chose not to call from Today or the Call Queue."
            value={<span className="num">{stats.skips_logged}</span>}
          />
          <Stat
            label="Touches"
            tip="All communications: emails, calls, notes, and skips."
            value={<span className="num">{stats.touches}</span>}
          />
          <Stat
            label="Last contacted"
            tip="Updated automatically when outreach or a completed call is recorded."
            value={
              <span className="text-sm">
                {sub.last_contacted ? timeAgo(sub.last_contacted) : "-"}
              </span>
            }
          />
          <Stat
            label="Open jobs"
            tip="Active opportunities this sub is currently paired to."
            value={<span className="num">{openPairings}</span>}
          />
        </div>

        <div className="card" id="pairings">
          <h2 className="mb-1 text-sm font-semibold text-slate-900">
            Opportunities paired{" "}
            <span className="font-normal text-slate-500">({pairings.length})</span>
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            Every job Brost Co has associated this company with, including outreach
            and quote status. Reuse this relationship instead of treating them as new.
          </p>
          {pairings.length === 0 ? (
            <p className="text-sm text-slate-500">Not paired to any opportunities yet.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {pairings.map((p) => {
                const label = outreachLabel(p.outreach_state);
                return (
                  <li
                    key={`${p.opportunity_id}-${p.trade ?? "t"}`}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/opportunity/${p.opportunity_id}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {p.opportunity_title ?? "Opportunity"}
                      </Link>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {[
                          p.trade,
                          stageLabel(p.stage),
                          p.deadline ? `Due ${shortDate(p.deadline)}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <span
                        className={`badge inline-flex items-center gap-1 ${outreachBadgeClass(p.outreach_state)}`}
                        title={outreachHint(p.outreach_state)}
                      >
                        {label}
                      </span>
                      {p.quote_amount != null && (
                        <span className="num text-sm text-slate-700">
                          {currency(Number(p.quote_amount))}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
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

            <div className="card">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
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

            <div className="card" id="communications">
              <h2 className="mb-1 text-sm font-semibold text-slate-900">
                Communications & history{" "}
                <span className="font-normal text-slate-500">({communications.length})</span>
              </h2>
              <p className="mb-3 text-xs text-slate-500">
                Every email, reply, call, skip, and note is saved here automatically
                as work happens across opportunities.
              </p>
              {communications.length === 0 ? (
                <p className="text-sm text-slate-500">No communications logged yet.</p>
              ) : (
                <div className="space-y-3">
                  {communications.map((c, i) => {
                    const channel = s(c.channel) ?? "note";
                    const direction = s(c.direction);
                    const subject = s(c.subject);
                    const bodyText = s(c.body);
                    const createdAt = s(c.created_at);
                    const oppTitle = s(c.opportunity_title);
                    const oppId = s(c.opportunity_id);
                    return (
                      <div
                        key={s(c.id) ?? i}
                        className="border-l-2 border-border pl-3"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="badge bg-slate-200 text-slate-700">{channel}</span>
                          {direction && (
                            <span className="text-slate-500">{direction}</span>
                          )}
                          {oppTitle && oppId ? (
                            <Link
                              href={`/opportunity/${oppId}`}
                              className="truncate text-accent hover:underline"
                            >
                              {oppTitle}
                            </Link>
                          ) : null}
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

            <div className="card">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
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
                      const oppId = s(q.opportunity_id);
                      const title = s(q.opportunity_title) ?? "-";
                      return (
                        <tr key={s(q.id) ?? i} className="border-t border-border">
                          <td className="td">
                            {oppId ? (
                              <Link
                                href={`/opportunity/${oppId}`}
                                className="text-accent hover:underline"
                              >
                                {title}
                              </Link>
                            ) : (
                              title
                            )}
                          </td>
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

          <div className="lg:col-span-1">
            <div className="card sticky top-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Permanent Notes</h2>
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
