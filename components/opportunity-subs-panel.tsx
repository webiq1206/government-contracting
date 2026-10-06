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
import { StopOutreach } from "@/components/stop-outreach";
import { SubActions } from "@/components/sub-actions";
import { isEmailable } from "@/lib/domain/sub-contactability";
import { OpportunityMessageHistory } from "./opportunity-message-history";
import { ContactDiscoveryEvidence } from "./contact-discovery-evidence";

/** One-line next human/system action so each row answers "what now?" */
function nextActionForSub(s: OppSubRow): string | null {
  switch (s.outreach_state) {
    case "pending":
    case null:
    case undefined:
      return "Review contact details and outreach readiness. No send is confirmed by this status.";
    case "no_email":
    case "email_unverified":
      return s.phone ? "Call (email is not usable yet)" : "Find a working email or phone";
    case "draft":
      return "Review the saved draft and any reason it was held before deciding whether to send.";
    case "send_failed":
      return "Review the failed attempt and mailbox connection before retrying.";
    case "held":
      return "Review why outreach was held. Resolve that reason before considering a send.";
    case "queued":
      return "Check the queued request before retrying so the message is not sent twice.";
    case "sent":
      return "Check the message history for replies and any saved follow-up time.";
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
  opportunityId = null,
  canStopOutreach = false,
  canDecide = false,
  callsEnabled = true,
  researchOnly = false,
}: {
  subs: OppSubRow[];
  communications: OppSubCommRow[];
  /** The bid these pairings belong to, so a stop can be scoped to it. */
  opportunityId?: string | null;
  /** Stopping outreach is an outreach decision, not a viewing one. */
  canStopOutreach?: boolean;
  /** Ranking a firm and taking one off the bid are bid decisions. */
  canDecide?: boolean;
  /** Calling can be turned off for the account, and the row must say so. */
  callsEnabled?: boolean;
  researchOnly?: boolean;
  /** Solicitation analysis — used for per-trade "what we need them to do". */
  analysis?: Record<string, unknown> | null;
  description?: string | null;
}) {
  const bySub = new Map<string, OppSubCommRow[]>();
  const foundCount = new Set(subs.map(sub => sub.subcontractor_id)).size;
  const contactedCount = new Set(subs.filter(sub => sub.emails_sent > 0 || sub.calls_logged > 0).map(sub => sub.subcontractor_id)).size;
  const repliedCount = new Set(subs.filter(sub => sub.last_inbound_at).map(sub => sub.subcontractor_id)).size;
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
      <p className="mb-3 text-sm text-slate-700">
        {foundCount} subcontractors found; {contactedCount} with a sent email or logged call;
        {" "}{repliedCount} with an incoming message recorded.
      </p>
      {subs.length >= 300 && <p className="mb-3 text-sm text-attention">Showing the first 300 subcontractor pairings. The totals above describe this loaded list.</p>}
      {communications.length >= 400 && <p role="status" className="mb-3 text-sm text-attention">Showing the latest 400 communication records for this opportunity. Open a subcontractor&apos;s conversation to review older records.</p>}
      <Collapsible
        title={researchOnly ? "Saved subcontractor history" : "Subcontractors on this bid"}
        meta={<span className="num">{subs.length}</span>}
        defaultOpen={subs.length > 0}
      >
        {subs.length === 0 ? (
          <p className="text-sm leading-relaxed text-slate-500">
            {researchOnly ? "No subcontractors are saved for this notice." : "No subcontractors have been linked to this opportunity. Review the required trades and research settings before starting a search."}
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
                            <p className="mt-0.5 break-words text-xs text-slate-500">
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
                            <span className="text-slate-500">Sent emails </span>
                            <span className="num text-slate-700">{s.emails_sent}</span>
                          </span>
                          <span>
                            <span className="text-slate-500">Logged calls </span>
                            <span className="num text-slate-700">{s.calls_logged}</span>
                          </span>
                          <span>
                            <span className="text-slate-500">Saved records </span>
                            <span className="num text-slate-700">{s.touches}</span>
                          </span>
                          <span>
                            <span className="text-slate-500">Last record on this opportunity </span>
                            {s.last_touch_at
                              ? timeAgo(s.last_touch_at)
                              : "Not recorded"}
                          </span>
                          {s.responded_at && (
                            <span className="text-pursue">
                              Replied {timeAgo(s.responded_at)}
                            </span>
                          )}
                        </div>
                        {(() => {
                          const next = researchOnly ? null : nextActionForSub(s);
                          return next ? (
                            <p className="mt-2 text-xs font-medium text-slate-800">
                              Next: {next}
                            </p>
                          ) : null;
                        })()}

                        {/*
                          The control lives beside the pairing it acts on.
                          Somewhere in Settings is where a stop goes to be
                          hunted for; here is where an operator is standing
                          when they decide this firm has had enough emails.
                        */}
                        {!researchOnly && <SubActions
                          opportunityId={opportunityId ?? ""}
                          pairingId={s.id}
                          subcontractorId={s.subcontractor_id}
                          companyName={s.company_name}
                          trade={s.trade}
                          canAct={canDecide && Boolean(opportunityId)}
                          canSend={canStopOutreach && Boolean(opportunityId)}
                          facts={{
                            outreachState: s.outreach_state,
                            role: s.role,
                            removed: Boolean(s.removed_at),
                            /*
                             * Usable, not merely present. An address that
                             * failed verification is one outreach will not
                             * send to, and offering "Send again" over it
                             * would be a button that queues a job destined
                             * to skip this firm.
                             */
                            hasEmail: isEmailable(s),
                            emailOnFile: Boolean(s.email),
                            hasPhone: Boolean(s.phone),
                            emailsSent: s.emails_sent,
                            hasQuote: s.has_quote,
                            threadKey: s.thread_key,
                            hasThread: s.touches > 0,
                            callsEnabled,
                          }}
                        />}
                        {researchOnly && s.thread_key && <Link className="inline-flex min-h-11 items-center text-sm text-accent" href={`/communications?c=${encodeURIComponent(s.thread_key)}`}>Open saved conversation</Link>}

                        {canStopOutreach && !s.removed_at && (
                          <div className="mt-2">
                            <StopOutreach
                              subcontractorId={s.subcontractor_id}
                              companyName={s.company_name}
                              opportunityId={opportunityId ?? null}
                              trade={s.trade ?? null}
                            />
                          </div>
                        )}

                        <ContactDiscoveryEvidence verification={s.verification_json} />
                        <OpportunityMessageHistory messages={history} />

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
