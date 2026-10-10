import Link from "next/link";
import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { requireOrgContext, findOrgRecord } from "@/lib/org-guard";
import { rejectOrgPageResponse } from "@/lib/org-page-guard";
import { can } from "@/lib/domain/roles";
import { outreachHistory, type OutreachHistoryOptions } from "@/lib/outreach-history";
import { OUTREACH_OUTCOMES } from "@/lib/domain/outreach-evidence";
import { communicationTimestamp } from "@/lib/domain/communication-timestamp";
import { EmailMessage } from "@/components/email-message";

export const dynamic = "force-dynamic";

function time(value: string | null) {
  return value ? communicationTimestamp(value).label : "Not recorded";
}

export default async function OutreachPage({ searchParams }: {
  searchParams: Promise<Record<string,string|string[]|undefined>>;
}) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) rejectOrgPageResponse(ctx);
  const raw = await searchParams;
  const opts: OutreachHistoryOptions = {};
  for (const key of ["project","status","q","days","before","asOf"] as const) {
    const v = raw[key]; opts[key] = Array.isArray(v) ? v[0] : v;
  }
  const project = opts.project
    ? await findOrgRecord<{id:string;title:string;solicitation_number:string|null}>("opportunities",opts.project,ctx.orgId,"id,title,solicitation_number")
    : null;
  if (opts.project && !project) notFound();
  const canSeeDiagnostics = can(ctx.user.orgRole,"manage_integrations");
  const data = await outreachHistory(ctx.orgId,opts,canSeeDiagnostics);
  function href(changes: OutreachHistoryOptions) {
    const params = new URLSearchParams();
    for (const [k,v] of Object.entries({...opts,asOf:data.asOf,days:data.days,...changes})) if(v) params.set(k,v);
    return `/outreach?${params}`;
  }
  const projects = new Map<string,{label:string;count:number}>();
  for (const r of data.projectCounts) projects.set(r.opportunity_id ?? "unlinked",{
    label: [r.opportunity_title ?? "Solicitation",r.solicitation_number].filter(Boolean).join(" · "),
    count:(projects.get(r.opportunity_id ?? "unlinked")?.count ?? 0)+Number(r.messages)});
  return <div className="page-shell scroll-thin overflow-y-auto p-5">
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="space-y-2">
        <Link href="/communications" className="text-sm text-accent">Back to inbox</Link>
        <h1 className="font-display text-2xl font-semibold">Outreach overview</h1>
        <p className="text-sm text-muted-foreground">{project ? `${project.title}${project.solicitation_number ? ` · ${project.solicitation_number}` : ""}` : "Email history across this account's solicitations, including holds, drafts and replies."}</p>
        <p className="text-sm text-muted-foreground">Provider acceptance confirms a handoff. It does not establish recipient-server delivery or Inbox versus Spam. Opens and clicks may come from scanners; a reply is not automatically a usable quote.</p>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link className="text-accent" href="/communications/history">All communication history</Link>
          <Link className="text-accent" href="/communications/unmatched">Review unmatched mail</Link>
          {project && <Link className="text-accent" href={`/opportunity/${project.id}`}>Solicitation and next steps</Link>}
          {project && <Link className="text-accent" href={href({project:undefined,before:undefined})}>All account solicitations</Link>}
        </div>
      </header>

      <form action="/outreach" className="card flex flex-wrap items-end gap-3">
        {opts.project && <input type="hidden" name="project" value={opts.project} />}
        <input type="hidden" name="asOf" value={data.asOf} />
        <label className="min-w-0 w-full text-sm sm:w-auto sm:flex-1">Search outreach
          <input className="input mt-1 w-full" type="search" name="q" defaultValue={opts.q} maxLength={300} placeholder="Supplier, saved address, solicitation or message" />
        </label>
        <label className="text-sm">Recorded period
          <select className="input mt-1 block" name="days" defaultValue={data.days}>
            <option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All stored history</option>
          </select>
        </label>
        <label className="text-sm">Outcome
          <select className="input mt-1 block" name="status" defaultValue={data.status}>
            {Object.entries(OUTREACH_OUTCOMES).map(([k,v])=><option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button type="submit" className="btn-primary">Apply filters</button>
        <Link className="btn-ghost" href={href({q:undefined,status:undefined,before:undefined})}>Clear filters</Link>
      </form>

      <section className="space-y-3" aria-label="Recorded outreach totals">
        <p className="text-xs text-muted-foreground">The date range selects when records were created. Outcomes show their current saved state; this is not a historical status snapshot.</p>
        <p className="text-sm"><strong>{data.total} stored email records</strong> match this cohort. {data.since ? `After ${time(data.since)} through ${time(data.asOf)}.` : `All stored dates through ${time(data.asOf)}.`} Counts include unsent and received records; they are not a send or response rate.</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {Object.entries(data.counts).map(([k,n])=><Link key={k} className="card min-w-0 p-3" href={href({status:k,before:undefined})}>
            <span className="block text-xs text-muted-foreground">{OUTREACH_OUTCOMES[k as keyof typeof OUTREACH_OUTCOMES]}</span>
            <strong className="num text-xl">{n}</strong>
          </Link>)}
        </div>
        <p className="text-xs text-muted-foreground">Delivery confirmation is unavailable unless a trustworthy recipient-server event is preserved. Historical “delivered” labels and tracking activity alone do not supply that event. Automatic-response classification can require human review.</p>
        {!project && projects.size>0 && <details className="card">
          <summary className="min-h-11 cursor-pointer text-sm font-medium">Reconcile records by solicitation ({projects.size} groups)</summary>
          <p className="mb-3 text-xs text-muted-foreground">These groups use the same dates and filters as the totals above. Unlinked records stay separate.</p>
          <ul className="space-y-2 text-sm">{[...projects].map(([id,n])=><li key={id} className="flex min-w-0 flex-wrap justify-between gap-2">
            {id==="unlinked" ? <span>No solicitation recorded</span> : <Link className="break-words text-accent" href={href({project:id,before:undefined})}>{n.label}</Link>}
            <span>{n.count} records</span>
          </li>)}</ul>
        </details>}
      </section>

      {data.rows.length===0 && <p className="card">No stored emails match this cohort. This does not establish that no mail arrived at the provider. Check sync health and unmatched mail.</p>}
      <div className="space-y-6">{data.rows.map(row=><section key={row.id} className="min-w-0 space-y-3" aria-label={`Email record ${row.id}`}>
        <div className="flex flex-wrap gap-3 text-sm">
          {row.opportunity_id && <Link className="text-accent" href={href({project:row.opportunity_id,before:undefined})}>{row.opportunity_title ?? "Solicitation history"}{row.solicitation_number ? ` · ${row.solicitation_number}` : ""}</Link>}
          {row.subcontractor_id && <Link className="text-accent" href={`/subs/${row.subcontractor_id}`}>{row.company_name ?? "Supplier record"}</Link>}
          <Link className="text-accent" href={`/communications/history?thread=${encodeURIComponent(row.thread_key)}`}>Read full conversation history</Link>
          <Link className="text-accent" href={`/outreach/${row.id}`}>Recorded attempts and changes</Link>
        </div>
        <EmailMessage body={row.body} subject={row.subject} direction={row.direction==="inbound"?"inbound":"outbound"}
          sender={row.sender_email} recipient={row.recipient_email} contact={row.company_name ?? "Contact"} date={row.created_at}>
          <strong className="text-xs">{OUTREACH_OUTCOMES[row.outcome]}</strong>
        </EmailMessage>
        <div className="card space-y-3">
          <p className="text-sm"><strong>Next action:</strong> {row.next_action}</p>
          <dl className="grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2">
            {[["Provider attempt",row.provider_attempted_at],["Provider acceptance",row.provider_accepted_at],
              ["Open activity",row.opened_at],["Link activity",row.clicked_at],
              ["Reply marker",row.replied_at],["Saved follow-up due",row.follow_up_at]].map(([label,value])=><div key={label}><dt className="text-muted-foreground">{label}</dt><dd>{time(value)}</dd></div>)}
          </dl>
          <p className="text-xs text-muted-foreground">{row.follow_up_at ? "A saved follow-up date is not proof a job is queued or eligible; current reply, deadline, suppression and pursuit checks still apply." : "No follow-up date is recorded."}</p>
          {row.related_quote_count>0 && <p className="text-sm">{row.related_quote_count} saved quote{row.related_quote_count===1?"":"s"} share this supplier and solicitation. <strong>That association does not prove this message supplied the quote.</strong> {row.opportunity_id && <Link className="text-accent" href={`/opportunity/${row.opportunity_id}`}>Review pricing and quote evidence</Link>}</p>}
          {row.reply_review && <p className="text-sm text-review">This reply has an unresolved extraction or attribution review.</p>}
          <details>
            <summary className="min-h-11 cursor-pointer text-sm">Evidence and recorded identifiers</summary>
            <dl className="grid min-w-0 gap-2 text-xs [overflow-wrap:anywhere]">
              <div><dt>Communication ID</dt><dd>{row.id}</dd></div>
              <div><dt>Recorded provider</dt><dd>{row.provider ?? "Not recorded"}</dd></div>
              <div><dt>Provider message ID</dt><dd>{row.gmail_message_id ?? "No receipt ID recorded"}</dd></div>
              <div><dt>RFC Message-ID</dt><dd>{row.rfc822_message_id ?? "Not recorded"}</dd></div>
              <div><dt>Recorded intent / actor</dt><dd>{row.intent_kind ?? "Intent not recorded"} / {row.saved_actor ?? "Actor not recorded; no approval inferred"}</dd></div>
              <div><dt>Current contact evidence</dt><dd>{row.current_contact_source ?? "Source unknown"}; {row.current_contact_verified ? "currently marked verified" : "not currently marked verified"}. This is not the recipient's historical verification snapshot.</dd></div>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">Missing attempt history, sender-account identity and approval evidence remain unavailable. Recorded times describe their specific event; the message's creation time does not substitute for acceptance or delivery.</p>
            {canSeeDiagnostics && row.delivery_detail && <p className="mt-2 whitespace-pre-wrap text-xs [overflow-wrap:anywhere]">Recorded diagnostic: {row.delivery_detail}</p>}
          </details>
        </div>
      </section>)}</div>
      <nav className="flex justify-between gap-3 pb-6" aria-label="Outreach history pages">
        {opts.before ? <Link className="btn-ghost" href={href({before:undefined})}>Newest in this cohort</Link> : <span />}
        {data.next && <Link className="btn-ghost" href={href({before:data.next})}>Older records</Link>}
      </nav>
    </div>
  </div>;
}
