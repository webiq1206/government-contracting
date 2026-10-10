import Link from "next/link";
import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { requireOrgContext,findOrgRecord } from "@/lib/org-guard";
import { rejectOrgPageResponse } from "@/lib/org-page-guard";
import { can } from "@/lib/domain/roles";
import { communicationEvents } from "@/lib/communication-events";
import { communicationTimestamp } from "@/lib/domain/communication-timestamp";
import { EmailMessage } from "@/components/email-message";
import { UUID } from "@/lib/communications-ledger";
import { query } from "@/lib/db";
export const dynamic="force-dynamic";
const time=(v:string|null|undefined)=>v?communicationTimestamp(v).label:"Not recorded";
export default async function CommunicationEvidence({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{before?:string}>}) {
  const ctx=await requireOrgContext();if(ctx instanceof NextResponse) rejectOrgPageResponse(ctx);
  const {id}=await params;if(!UUID.test(id)) notFound();
  const message=await findOrgRecord<{id:string;subject:string|null;opportunity_id:string|null}>("communications",id,ctx.orgId,"id,subject,opportunity_id");
  if(!message) notFound();
  const {before}=await searchParams;
  const [data,quotes]=await Promise.all([
    communicationEvents(ctx.orgId,id,before,can(ctx.user.orgRole,"manage_integrations")),
    query<{id:string;trade:string|null}>("select id,trade from quotes where org_id=$1 and source_communication_id=$2 order by created_at,id",[ctx.orgId,id]),
  ]);
  return <div className="page-shell scroll-thin overflow-y-auto p-5"><div className="mx-auto w-full max-w-4xl space-y-5">
    <header className="space-y-2"><Link className="text-sm text-accent" href={message.opportunity_id?`/outreach?project=${message.opportunity_id}&days=all`:'/outreach?days=all'}>Back to outreach history</Link>
      <h1 className="font-display text-2xl font-semibold">Recorded email changes</h1>
      <p className="text-sm break-words">{message.subject ?? 'Email record'}</p>
      <p className="text-sm text-muted-foreground">Application checkpoints, newest first. These preserve future changes and attempts; they are not recipient-server delivery events. A checkpoint records what was stored at that time. Missing older history and mailbox-account identity remain unknown.</p>
    </header>
    {quotes.length>0 && <p className="card text-sm">{quotes.length} saved quote{quotes.length===1?'':'s'} explicitly cite this inbound message as their source. {message.opportunity_id && <Link className="text-accent" href={`/opportunity/${message.opportunity_id}`}>Review the quote and pricing</Link>}</p>}
    {!data.rows.length && <p className="card">No application change history is stored for this record{before?' on this page':''}. The original communication may predate event capture. Do not interpret missing history as proof that nothing was sent or received.</p>}
    {data.rows.map(event=><section key={event.id} className="card min-w-0 space-y-3 [overflow-wrap:anywhere]">
      <h2 className="font-medium">{event.evidence.legacy_snapshot?'First observed historical snapshot':({record_created:'Record created',content_revised:'Content or intent revised',state_changed:'Send state changed',activity_recorded:'Activity or metadata changed'}[event.kind] ?? 'Recorded change')}</h2>
      <p className="text-xs text-muted-foreground">Checkpoint {time(event.recorded_at)} · Event {event.id}</p>
      {event.evidence.legacy_snapshot && <p className="text-sm">This snapshot was taken when an older record changed. Its checkpoint time does not reconstruct a historical attempt or acceptance.</p>}
      <dl className="grid gap-2 text-xs sm:grid-cols-2">
        <div><dt>Stored state</dt><dd>{event.evidence.previous_delivery_state ? `${event.evidence.previous_delivery_state} → `:''}{event.evidence.delivery_state ?? 'Unknown'}</dd></div>
        <div><dt>Provider / message ID</dt><dd>{event.evidence.provider ?? 'Unknown'} / {event.evidence.provider_message_id ?? 'Not recorded'}</dd></div>
        <div><dt>Sender</dt><dd>{event.evidence.sender_email ?? 'Not recorded'}</dd></div>
        <div><dt>Sending mailbox / connection version</dt><dd>{event.evidence.provider_account_email ?? 'Not recorded'} / {event.evidence.provider_connection_generation ?? 'Not recorded'}</dd></div>
        <div><dt>RFC Message-ID</dt><dd>{event.evidence.rfc822_message_id ?? 'Not recorded'}</dd></div>
        {[["Provider attempt",event.evidence.provider_attempted_at],["Provider acceptance",event.evidence.provider_accepted_at],
          ["Open activity",event.evidence.opened_at],["Link activity",event.evidence.clicked_at],
          ["Reply marker",event.evidence.replied_at],["Saved follow-up due",event.evidence.follow_up_at]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{time(value)}</dd></div>)}
      </dl>
      {event.content && <details><summary className="min-h-11 cursor-pointer text-sm">Original content and intent saved at this checkpoint</summary>
        <p className="mb-3 text-xs">Intent: {event.content.intent_kind ?? 'Not recorded'} · Actor: {event.content.actor_id ?? 'Not recorded; no approval inferred'}</p>
        <EmailMessage body={event.content.body ?? null} subject={event.content.subject ?? null} direction={event.content.direction==='inbound'?'inbound':'outbound'}
          sender={event.evidence.sender_email ?? null} recipient={event.content.recipient_email ?? null} contact="Saved contact" date={event.evidence.record_created_at ?? event.recorded_at} />
      </details>}
      {event.evidence.delivery_detail && <details><summary className="min-h-11 cursor-pointer text-sm">Recorded diagnostic</summary><p className="text-xs whitespace-pre-wrap">{event.evidence.delivery_detail}</p></details>}
    </section>)}
    <nav className="flex justify-between gap-3 pb-6" aria-label="Email evidence pages">{before?<a className="btn-ghost" href={`/outreach/${id}`}>Newest checkpoints</a>:<span/>}{data.next&&<a className="btn-ghost" href={`/outreach/${id}?before=${data.next}`}>Older checkpoints</a>}</nav>
  </div></div>;
}
