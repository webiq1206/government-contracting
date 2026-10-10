import Link from "next/link";
import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { rejectOrgPageResponse } from "@/lib/org-page-guard";
import { can } from "@/lib/domain/roles";
import { query } from "@/lib/db";
import { unmatchedHistory, type UnmatchedOptions } from "@/lib/unmatched-history";
import { NeedsMatchingInbox } from "@/components/needs-matching-inbox";

export const dynamic = "force-dynamic";

export default async function UnmatchedPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const ctx = await requireOrgContext();
  if(ctx instanceof NextResponse) rejectOrgPageResponse(ctx);
  const raw = await searchParams, opts:UnmatchedOptions = {};
  for(const key of ["q","known","after"] as const) opts[key] = Array.isArray(raw[key]) ? raw[key][0] : raw[key];
  const [data,targets] = await Promise.all([
    unmatchedHistory(ctx.orgId,opts),
    query<{id:string;title:string}>(`select id,title from opportunities where org_id=$1
      and status='open' and coalesce(pursuit_state,'active')='active'
      and stage not in ('archived','won','lost','dismissed') order by coalesce(deadline,created_at) desc limit 100`,[ctx.orgId]),
  ]);
  function href(after?:string) {
    const p = new URLSearchParams();
    if(opts.q) p.set("q",opts.q); if(opts.known === "yes") p.set("known","yes"); if(after) p.set("after",after);
    return `/communications/unmatched?${p}`;
  }
  return <div className="page-shell scroll-thin overflow-y-auto p-5"><div className="mx-auto w-full max-w-4xl space-y-5">
    <header className="space-y-2">
      <Link href="/communications" className="text-sm text-accent">Back to inbox</Link>
      <h1 className="font-display text-2xl font-semibold">Unmatched mail</h1>
      <p className="text-sm text-muted-foreground">Stored messages waiting for attribution, including mail that may be unrelated to procurement. A known sender alone does not prove which solicitation a reply belongs to.</p>
      <Link href="/outreach" className="text-sm text-accent">Review outreach evidence</Link>
    </header>
    <form action="/communications/unmatched" className="card flex flex-wrap items-end gap-3">
      <label className="min-w-0 w-full text-sm sm:flex-1">Search all unmatched mail
        <input className="input mt-1 w-full" name="q" type="search" defaultValue={opts.q} maxLength={300} placeholder="Supplier, sender, subject or message text" />
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="known" value="yes" defaultChecked={opts.known==="yes"} />Known suppliers only</label>
      <button className="btn-primary" type="submit">Apply filters</button>
      <a className="btn-ghost" href="/communications/unmatched">Clear filters</a>
    </form>
    <p className="text-sm"><strong>{data.total.toLocaleString("en-US")} stored messages</strong> match these filters. Showing {data.rows.length} on this page, oldest first. The queue can change as new mail is captured or reviewed.</p>
    <NeedsMatchingInbox messages={data.rows} opportunities={targets} canAct={can(ctx.user.orgRole,"outreach")} totalCount={data.total} expanded />
    <p className="text-xs text-muted-foreground">Manual filing offers the latest 100 eligible open solicitations. Missing mail may still be at the provider; this queue does not establish current mailbox-sync health. Automatic matching and dismissing are never performed by opening this page.</p>
    <nav className="flex justify-between gap-3 pb-6" aria-label="Unmatched mail pages">
      {opts.after ? <a href={href()} className="btn-ghost">Oldest matching records</a> : <span />}
      {data.next && <a href={href(data.next)} className="btn-ghost">Next 50 messages</a>}
    </nav>
  </div></div>;
}
