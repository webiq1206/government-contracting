import Link from "next/link";
import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { rejectOrgPageResponse } from "@/lib/org-page-guard";
import { communicationsLedger, LEDGER_FILTERS, type LedgerOptions } from "@/lib/communications-ledger";
import { EmailMessage } from "@/components/email-message";
import { MESSAGE_STATE_LABEL, MESSAGE_STATE_MEANING } from "@/lib/domain/message-state";

export const dynamic = "force-dynamic";

export default async function CommunicationsHistory({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) rejectOrgPageResponse(ctx);
  const raw = await searchParams;
  const opts: LedgerOptions = {};
  for (const key of ["q", "status", "sub", "project", "thread", "before"] as const) {
    const value = raw[key]; opts[key] = Array.isArray(value) ? value[0] : value;
  }
  const { rows, next } = await communicationsLedger(ctx.orgId, opts);
  function href(changes: LedgerOptions) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...opts, ...changes })) if (value) params.set(key, value);
    return `/communications/history?${params}`;
  }
  return <div className="page-shell scroll-thin overflow-y-auto p-5">
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <header className="space-y-2">
        <Link href="/communications" className="text-sm text-accent">Back to inbox</Link>
        <h1 className="text-2xl font-semibold">Communication history</h1>
        <p className="text-sm text-muted-foreground">Search every stored email, reply, call and note. Sender details and outcomes reflect the saved record; missing historical evidence stays unknown.</p>
        {opts.sub && <Link href={`/subs/${encodeURIComponent(opts.sub)}`} className="mr-4 text-sm text-accent">Contact record</Link>}
        {opts.project && <Link href={`/opportunity/${encodeURIComponent(opts.project)}`} className="text-sm text-accent">Project record</Link>}
      </header>
      <form className="flex flex-wrap items-end gap-3" action="/communications/history">
        {["sub", "project", "thread"].map(key => opts[key as keyof LedgerOptions] && <input key={key} type="hidden" name={key} value={opts[key as keyof LedgerOptions]} />)}
        <label className="min-w-0 w-full flex-none text-sm sm:w-auto sm:flex-1">Search messages
          <input className="input mt-1 w-full" name="q" type="search" defaultValue={opts.q} placeholder="Name, address, subject, message or project" maxLength={300} />
        </label>
        <label className="text-sm">Outcome
          <select className="input mt-1 block" name="status" defaultValue={opts.status ?? "all"}>
            {Object.entries(LEDGER_FILTERS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <button className="btn-primary" type="submit">Search</button>
        <Link href={href({ q: undefined, status: undefined, before: undefined })} className="btn-ghost">Clear search filters</Link>
        {(opts.sub || opts.project || opts.thread) && <Link href="/communications/history" className="btn-ghost">View all account history</Link>}
      </form>
      {rows.length === 0 && <p className="card">No stored records match these filters.</p>}
      <div className="space-y-6">{rows.map(row => <section key={row.id} className="space-y-2">
        <div className="flex flex-wrap gap-3 text-sm">
          {row.subcontractor_id && <Link className="text-accent" href={`/subs/${row.subcontractor_id}`}>{row.company_name ?? "Contact record"}</Link>}
          {row.opportunity_id && <Link className="text-accent" href={`/opportunity/${row.opportunity_id}`}>{row.opportunity_title ?? "Project record"}</Link>}
          {row.channel === "email" && <Link className="text-accent" href={href({ thread: row.thread_key, before: undefined, q: undefined, status: undefined })}>All messages in thread</Link>}
          {row.channel === "email" && <Link className="text-accent" href={`/communications?c=${encodeURIComponent(row.thread_key)}`}>Open conversation</Link>}
        </div>
        {row.channel === "email" ? <EmailMessage body={row.body} subject={row.subject}
          direction={row.direction === "inbound" ? "inbound" : "outbound"}
          sender={row.sender_email} recipient={row.recipient_email} contact={row.company_name ?? "Contact"} date={row.created_at}>
          <span className="text-xs font-medium" title={MESSAGE_STATE_MEANING[row.state]}>{MESSAGE_STATE_LABEL[row.state]}</span>
          {row.gmail_message_id && <span className="text-xs text-muted-foreground">Mail service message ID recorded; this alone does not confirm delivery</span>}
        </EmailMessage> : <article className="card space-y-2">
          <p className="text-sm font-medium">{row.channel} · {row.subject ?? "Saved record"}</p>
          <time className="text-xs text-muted-foreground" dateTime={row.created_at}>{new Date(row.created_at).toLocaleString()}</time>
          <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{row.body ?? "No content recorded."}</p>
        </article>}
      </section>)}</div>
      <nav className="flex justify-between pb-6" aria-label="Ledger pages">
        {opts.before ? <Link className="btn-ghost" href={href({ before: undefined })}>Newest records</Link> : <span />}
        {next && <Link className="btn-ghost" href={href({ before: next })}>Older records</Link>}
      </nav>
    </div>
  </div>;
}
