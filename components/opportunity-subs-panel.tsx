import Link from "next/link";
import { Collapsible } from "@/components/collapsible";
import { InfoTip } from "@/components/info-tip";
import {
  contactBadgeClass,
  contactStatusHint,
  contactStatusLabel,
  outreachBadgeClass,
  outreachHint,
  outreachLabel,
} from "@/lib/domain/sub-contact";
import { timeAgo } from "@/lib/format";
import { resolveSubWork } from "@/lib/domain/sub-work";
import type { OppSubCommRow, OppSubRow } from "@/lib/data";
import { SubWorkNeeded } from "@/components/sub-work-needed";

/** One-line next human/system action so each row answers "what now?" */
function nextActionForSub(s: OppSubRow): string | null {
  switch (s.outreach_state) {
    case "pending":
    case null:
    case undefined:
      return "Waiting for outreach to send";
    case "no_email":
    case "email_unverified":
      return s.phone ? "Call (email is not usable yet)" : "Find a working email or phone";
    case "draft":
    case "send_failed":
      return "Fix email transport or retry outreach";
    case "sent":
      return "Awaiting reply; auto follow-up is scheduled";
    case "followed_up":
    case "unresponsive":
      return s.phone ? "Call them about pricing" : "Try another contact method";
    case "responsive":
      return "Collect or confirm their quote";
    case "declined":
      return "Find another sub for this trade";
    default:
      return null;
  }
}

/**
 * Opportunity-scoped subcontractors: who was found, how contactable they are,
 * outreach status for this bid, and a short expandable history drawn from
 * communications already saved on each sub's record.
 */
export function OpportunitySubsPanel({
  subs,
  communications,
  analysis = null,
  description = null,
}: {
  subs: OppSubRow[];
  communications: OppSubCommRow[];
  /** Solicitation analysis — used for per-trade "what we need them to do". */
  analysis?: Record<string, unknown> | null;
  description?: string | null;
}) {
  const bySub = new Map<string, OppSubCommRow[]>();
  for (const c of communications) {
    const list = bySub.get(c.subcontractor_id) ?? [];
    list.push(c);
    bySub.set(c.subcontractor_id, list);
  }

  // Group by trade for scanning.
  const trades = new Map<string, OppSubRow[]>();
  for (const s of subs) {
    const key = s.trade?.trim() || "General";
    const list = trades.get(key) ?? [];
    list.push(s);
    trades.set(key, list);
  }

  return (
    <div id="subs" className="scroll-mt-editorial">
      <Collapsible
        title="Subcontractors on this bid"
        meta={<span className="num">{subs.length}</span>}
        defaultOpen={subs.length > 0}
      >
        {subs.length === 0 ? (
          <p className="text-sm leading-relaxed text-slate-500">
            No subs paired yet. After you pursue, Sub Finder finds local trades,
            verifies contact info, and Outreach emails them. Their status and
            history will show up here automatically.
          </p>
        ) : (
          <div className="space-y-5">
            <p className="text-xs leading-relaxed text-slate-500">
              Status and history update as emails send, replies arrive, calls are
              logged, or a call is skipped, the same record you see on each
              sub&rsquo;s full profile.
            </p>
            {[...trades.entries()].map(([trade, rows]) => {
              const tradeWork = resolveSubWork({
                trade,
                analysis,
                description,

              });
              return (
              <div key={trade}>
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <p className="label">{trade}</p>
                  <span className="num text-xs text-slate-500">{rows.length}</span>
                </div>
                {tradeWork.work && (
                  <div className="mb-2">
                    <SubWorkNeeded work={tradeWork} variant="compact" />
                  </div>
                )}
                <ul className="divide-y divide-border panel-inset">
                  {rows.map((s) => {
                    const history = bySub.get(s.subcontractor_id) ?? [];
                    const contactLabel = contactStatusLabel(s.contact_status);
                    return (
                      <li key={s.id} className="bg-background px-3 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <Link
                              href={`/subs/${s.subcontractor_id}`}
                              className="text-sm font-medium text-slate-900 hover:text-accent"
                            >
                              {s.company_name}
                            </Link>
                            <p className="mt-0.5 truncate text-xs text-slate-500">
                              {[s.email ?? "No email", s.phone ?? "No phone"]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {contactLabel && (
                              <span
                                className={`badge inline-flex items-center gap-1 ${contactBadgeClass(s.contact_status)}`}
                              >
                                {contactLabel}
                                <InfoTip label={`Contactability: ${contactLabel}`}>
                                  {contactStatusHint(s.contact_status)}
                                </InfoTip>
                              </span>
                            )}
                            <span
                              className={`badge inline-flex items-center gap-1 ${outreachBadgeClass(s.outreach_state)}`}
                            >
                              {outreachLabel(s.outreach_state)}
                              <InfoTip label={`Outreach: ${outreachLabel(s.outreach_state)}`}>
                                {outreachHint(s.outreach_state)}
                              </InfoTip>
                            </span>
                          </div>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                          <span>
                            <span className="text-slate-500">Emails </span>
                            <span className="num text-slate-700">{s.emails_sent}</span>
                          </span>
                          <span>
                            <span className="text-slate-500">Calls </span>
                            <span className="num text-slate-700">{s.calls_logged}</span>
                          </span>
                          <span>
                            <span className="text-slate-500">Touches </span>
                            <span className="num text-slate-700">{s.touches}</span>
                          </span>
                          <span>
                            <span className="text-slate-500">Last touch </span>
                            {s.last_touch_at
                              ? timeAgo(s.last_touch_at)
                              : s.last_contacted
                                ? timeAgo(s.last_contacted)
                                : "Not set"}
                          </span>
                          {s.responded_at && (
                            <span className="text-pursue">
                              Replied {timeAgo(s.responded_at)}
                            </span>
                          )}
                        </div>
                        {(() => {
                          const next = nextActionForSub(s);
                          return next ? (
                            <p className="mt-2 text-xs font-medium text-slate-800">
                              Next: {next}
                            </p>
                          ) : null;
                        })()}

                        {history.length > 0 && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs font-medium text-accent hover:underline">
                              History on this bid ({history.length})
                            </summary>
                            <ul className="mt-2 space-y-2 border-l border-border pl-3">
                              {history.slice(0, 8).map((h) => (
                                <li key={h.id} className="text-xs">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="badge bg-slate-200 text-slate-700">
                                      {h.channel}
                                    </span>
                                    {h.direction && (
                                      <span className="text-slate-500">{h.direction}</span>
                                    )}
                                    <span className="ml-auto text-slate-500">
                                      {timeAgo(h.created_at)}
                                    </span>
                                  </div>
                                  {h.subject && (
                                    <p className="mt-0.5 font-medium text-slate-800">
                                      {h.subject}
                                    </p>
                                  )}
                                  {h.body && (
                                    <p className="mt-0.5 line-clamp-2 text-slate-500">
                                      {h.body}
                                    </p>
                                  )}
                                </li>
                              ))}
                            </ul>
                            <Link
                              href={`/subs/${s.subcontractor_id}`}
                              className="mt-2 inline-block text-xs text-accent hover:underline"
                            >
                              Full sub record →
                            </Link>
                          </details>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
              );
            })}
          </div>
        )}
      </Collapsible>
    </div>
  );
}
