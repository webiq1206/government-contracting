import Link from "next/link";
import { notFound } from "next/navigation";
import { subDetail } from "@/lib/data";
import { subConversations } from "@/lib/domain/conversation";
import { draftsForSubcontractor } from "@/lib/domain/reply-draft";
import { tryResolveTenantOrgId } from "@/lib/tenant";
import { gmail } from "@/lib/integrations/gmail";
import { ConversationThreads } from "@/components/conversation-threads";
import { PageFrame } from "@/components/page-frame";
import { SubNotes } from "@/components/sub-notes";
import { SubPerformance } from "@/components/sub-performance";
import { performanceFor } from "@/lib/subcontractor-performance";
import { Collapsible } from "@/components/collapsible";
import { RecordActions } from "@/components/record-actions";
import { SubEditor } from "@/components/sub-editor";
import { SubCompliancePanel } from "@/components/sub-compliance-panel";
import { subComplianceView } from "@/lib/sub-compliance-store";
import {
  contactBadgeClass,
  contactStatusHint,
  contactStatusLabel,
  outreachBadgeClass,
  outreachHint,
  outreachLabel,
} from "@/lib/domain/sub-contact";
import { stageLabel } from "@/lib/domain/journey";
import { buildSubPlan } from "@/lib/domain/sub-plan";
import { GuidedPlanPanel } from "@/components/guided-plan";
import { currency, timeAgo, shortDate } from "@/lib/format";
import type { ProjectHistoryItem } from "@/lib/types";
import { SubcontractorRecord } from "@/components/subcontractor-record";
import { ActivityTimeline } from "@/components/activity-timeline";
import { buildActivityTimeline } from "@/lib/domain/activity-timeline";
import { subActivityLogs } from "@/lib/data";
import { OwnerPicker } from "@/components/owner-picker";
import { assignableMembers, ownerOf } from "@/lib/ownership";
import { currentUser } from "@/lib/auth";
import { can } from "@/lib/domain/roles";

export const dynamic = "force-dynamic";

function s(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * A count with somewhere to go. Tiles that summarise a section on this page
 * link to it; a number the operator can only look at is decoration. Tiles
 * with nothing behind them (a date, an empty count) stay inert rather than
 * promising a destination that turns out to be blank.
 */
function Stat({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  href?: string;
}) {
  const body = (
    <>
      <div className="label">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
    </>
  );
  if (!href) {
    return (
      <div className="card" title={hint}>
        {body}
      </div>
    );
  }
  return (
    <a href={href} className="card card-hover block" title={hint}>
      {body}
    </a>
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
  // Threads and inbox state are read alongside the detail so the page renders
  // in one pass; a missing connection disables the composer rather than
  // letting a reply fail after it is typed.
  const [conversations, inboxConnected, compliance, savedDrafts, subOwner, teamMembers, viewer] =
    await Promise.all([
    subConversations(params.id),
    gmail.isConnected().catch(() => false),
    subComplianceView(params.id),
    // Drafts already written for these threads, so returning to the page shows
    // the work rather than an empty box that costs money to refill.
    draftsForSubcontractor(params.id, await tryResolveTenantOrgId()).catch(() => ({})),
    /*
     * All three tolerate failure: a picker that cannot load is a field saying
     * Unassigned, where a throw here is a record page that will not open
     * because of a dropdown.
     */
    ownerOf("subcontractor", params.id).catch(() => null),
    assignableMembers().catch(() => []),
    currentUser().catch(() => null),
  ]);

  /*
   * What somebody has written down about how the work went, which is the one
   * part of the reliability score nothing can infer. Tolerates failure the
   * same way the pickers above do: a record page that will not open because a
   * performance note could not load is a worse outcome than a missing panel.
   */
  const performance = await performanceFor(
    (await tryResolveTenantOrgId()) ?? "",
    params.id
  ).catch(() => []);

  /*
   * One timeline, from the sources this record is actually made of. The
   * builder is the same one the opportunity record uses, so an email reads
   * the same way on both pages rather than being formatted twice.
   */
  const activity = buildActivityTimeline({
    logs: await subActivityLogs(params.id).catch(() => []),
    communications,
    quotes,
    documents: compliance.docs,
    limit: 200,
  });
  const projects: ProjectHistoryItem[] = Array.isArray(sub.project_history)
    ? sub.project_history
    : [];
  const contactLabel = contactStatusLabel(sub.contact_status);
  const openPairings = pairings.filter((p) => p.status === "open").length;
  const plan = buildSubPlan({
    hasEmail: Boolean(sub.email),
    hasPhone: Boolean(sub.phone),
    emailVerified: Boolean(sub.email_verified),
    contactStatus: sub.contact_status ?? null,
    samExcluded: Boolean(sub.sam_excluded),
    touches: stats.touches,
    openPairings,
    totalPairings: pairings.length,
    quoteCount: quotes.length,
    compliance: compliance.assessment,
  });

  return (
    <div className="flex page-shell">
      <PageFrame
        breadcrumbs={[
          { label: "Subcontractors", href: "/subs" },
          { label: sub.company_name },
        ]}
        title={sub.company_name}
        explanation={
          [sub.owner_name, [sub.city, sub.state].filter(Boolean).join(", ")]
            .filter(Boolean)
            .join(" \u00b7 ") || "Location not on file"
        }
        /*
         * These are states, not actions, so they sit with the status rather
         * than competing with it as buttons. "Back to database" is gone: that
         * is what the breadcrumb above is for, and having both meant two
         * controls doing the same thing on every subcontractor page.
         */
        status={
          <span className="flex flex-wrap items-center gap-2">
            <span>
              {openPairings > 0
                ? `${openPairings} open job${openPairings === 1 ? "" : "s"} \u00b7 ${stats.touches} touch${stats.touches === 1 ? "" : "es"} logged`
                : `${stats.touches} touch${stats.touches === 1 ? "" : "es"} logged`}
            </span>
            {!compliance.assessment.clearedForAward && (
              <a
                href="#compliance"
                className="badge bg-risk/15 text-risk"
                title={compliance.assessment.blockReason ?? undefined}
              >
                Cannot be sent work
              </a>
            )}
            {sub.is_preferred && (
              <span className="badge bg-review/15 text-review">Preferred</span>
            )}
            {contactLabel && (
              <span
                className={`badge ${contactBadgeClass(sub.contact_status)}`}
                title={contactStatusHint(sub.contact_status)}
              >
                {contactLabel}
              </span>
            )}
          </span>
        }
      />

      <div className="min-h-0 flex-1 overflow-hidden">
        <SubcontractorRecord
          overview={
            <div className="space-y-6 px-5 py-6">
              {/*
                Who here knows this firm.
                A subcontractor relationship is held by a person, not by a
                company: the estimator who has called them nine times knows
                what they are like to work with, and until this field existed
                that knowledge had nowhere to live except that person's head.
              */}
              <div className="max-w-xs">
                <OwnerPicker
                  kind="subcontractor"
                  recordId={sub.id}
                  owner={subOwner}
                  members={teamMembers}
                  viewerId={viewer?.id}
                  canAssign={can(viewer?.orgRole, "manage_subs")}
                />
              </div>

              {/* The readiness story first: what stands between this listing and a
                  company you can send work to, with the fix for each gap. */}
              <GuidedPlanPanel plan={plan} eyebrow="Getting this sub job-ready" />

              {/* Every way to reach this company, one tap from the name. Dimmed
                  rather than hidden when a channel is missing, so the row doubles
                  as a contact-data health check. */}
              <RecordActions
                actions={[
                  {
                    key: "call",
                    label: "Call",
                    glyph: "\u260F",
                    href: sub.phone ? `tel:${sub.phone.replace(/[^\d+]/g, "")}` : null,
                    missing: "No phone on file",
                  },
                  {
                    key: "email",
                    label: "Email",
                    glyph: "\u2709",
                    href: sub.email ? `mailto:${sub.email}` : null,
                    missing: "No email on file",
                  },
                  {
                    key: "website",
                    label: "Website",
                    glyph: "\u2197",
                    href: sub.website || null,
                    missing: "No website on file",
                    external: true,
                  },
                  { key: "note", label: "Note", glyph: "\u270E", href: "#notes" },
                ]}
              />

              {/* Contact metrics — live totals from saved communications */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
                <Stat
                  label="Emails sent"
                  hint="Outbound emails saved on this sub's record across every opportunity."
                  href={stats.emails_sent > 0 ? "#communications" : undefined}
                  value={<span className="num">{stats.emails_sent}</span>}
                />
                <Stat
                  label="Replies"
                  hint="Inbound emails captured for this sub."
                  href={stats.emails_in > 0 ? "#communications" : undefined}
                  value={<span className="num">{stats.emails_in}</span>}
                />
                <Stat
                  label="Calls logged"
                  hint="Completed call workspace saves recorded as call history."
                  href={stats.calls_logged > 0 ? "#communications" : undefined}
                  value={<span className="num">{stats.calls_logged}</span>}
                />
                <Stat
                  label="Skipped calls"
                  hint="Times an operator chose not to call from Today or the Call Queue."
                  value={<span className="num">{stats.skips_logged}</span>}
                />
                <Stat
                  label="Touches"
                  hint="All communications: emails, calls, notes, and skips."
                  href={stats.touches > 0 ? "#communications" : undefined}
                  value={<span className="num">{stats.touches}</span>}
                />
                <Stat
                  label="Last contacted"
                  hint="Updated automatically when outreach or a completed call is recorded."
                  value={
                    <span className="text-sm">
                      {sub.last_contacted ? timeAgo(sub.last_contacted) : "-"}
                    </span>
                  }
                />
                <Stat
                  label="Open jobs"
                  hint="Active opportunities this sub is currently paired to."
                  href={pairings.length > 0 ? "#pairings" : undefined}
                  value={<span className="num">{openPairings}</span>}
                />
              </div>
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
              <Collapsible title="Project History" meta={projects.length}>
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
              </Collapsible>

            </div>
          }
          opportunities={
            <div className="space-y-6 px-5 py-6">
              <div id="pairings">
              <Collapsible title="Opportunities paired" meta={pairings.length} defaultOpen>
                <p className="mb-3 text-xs text-slate-500">
                  Every job Brost Co has associated this company with, including outreach
                  and quote status. Reuse this relationship instead of treating them as new.
                </p>
                {pairings.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border bg-surface/60 px-4 py-5 text-center text-sm text-slate-600">
                    Not paired to any opportunities yet. When Brost Co pairs this company to a
                    pursued job, the opportunity, outreach status, and quotes show here.
                  </p>
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
              </Collapsible>
              </div>
            </div>
          }
          communications={
            <div className="space-y-6 px-5 py-6">
              <div id="conversations">
              <Collapsible title="Email conversations" meta={conversations.length} defaultOpen>
                <p className="mb-3 text-xs text-slate-500">
                  Read and reply right here. Messages go out from your own address and stay in
                  the same thread, so you never have to open Gmail.
                </p>
                <ConversationThreads
                  subcontractorId={sub.id}
                  canSend={inboxConnected}
                  conversations={conversations}
                  savedDrafts={savedDrafts}
                />
              </Collapsible>
              </div>

              <div id="communications">
              <Collapsible title="Full history" meta={communications.length}>
                <p className="mb-3 text-xs text-slate-500">
                  Every email, reply, call, skip, and note is saved here automatically
                  as work happens across opportunities.
                </p>
                {communications.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border bg-surface/60 px-4 py-5 text-center text-sm text-slate-600">
                    No communications logged yet. Emails, replies, calls, skips, and notes
                    appear here automatically as outreach runs.
                  </p>
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
              </Collapsible>
              </div>
            </div>
          }
          quotes={
            <div className="space-y-6 px-5 py-6">
              <Collapsible title="Quotes" meta={quotes.length}>
                {quotes.length === 0 ? (
                  <p className="text-sm text-slate-500">No quotes on file.</p>
                ) : (
                  <div className="overflow-x-auto">
                  <table className="w-full min-w-[28rem]">
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
                  </div>
                )}
              </Collapsible>
            </div>
          }
          compliance={
            <div className="space-y-6 px-5 py-6">
              {/* Ahead of the contact card: whether this sub can be sent work at
                  all outranks how to reach them. */}
              <SubCompliancePanel
                subId={sub.id}
                companyName={sub.company_name}
                docs={compliance.docs.map((d) => ({
                  ...d,
                  // Show the status as of now, not as of whenever the row was
                  // last written. A certificate can lapse between sweeps.
                  status: compliance.liveStatus[d.id] ?? d.status,
                }))}
                blockReason={compliance.assessment.blockReason}
                cleared={compliance.assessment.clearedForAward}
                expiringSoon={compliance.assessment.expiringSoon}
              />
            </div>
          }
          notes={
            <div className="space-y-6 px-5 py-6">
              <div className="lg:col-span-1" id="notes">
                <div className="card sticky top-4 scroll-mt-4">
                  <h2 className="mb-3 text-sm font-semibold text-slate-900">Permanent Notes</h2>
                  <p className="mb-3 text-xs text-slate-500">
                    Editable after every call. Saved permanently to this sub.
                  </p>
                  <SubNotes subId={sub.id} initialNotes={sub.notes} />
                </div>
              </div>
            </div>
          }
          activity={
            <div className="space-y-6 px-5 py-6">
              {/*
                Above the timeline, because it is the only thing on this tab a
                person writes rather than reads, and because it is the half of
                the reliability score nothing else can supply.
              */}
              <div className="card">
                <SubPerformance
                  subcontractorId={sub.id}
                  events={performance.map((e) => ({
                    id: e.id,
                    kind: e.kind,
                    note: e.note,
                    recordedBy: e.recordedBy,
                    at: e.at.toISOString(),
                    opportunityId: e.opportunityId,
                    opportunityTitle: e.opportunityTitle,
                    retractedAt: e.retractedAt ? e.retractedAt.toISOString() : null,
                    retractedReason: e.retractedReason,
                  }))}
                  canRecord={can(viewer?.orgRole, "decide")}
                />
              </div>
              <ActivityTimeline events={activity} />
            </div>
          }
        />
      </div>
    </div>
  );
}
