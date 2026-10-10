import { query } from "./db";
import { UUID } from "./communications-ledger";
import { THREAD_KEY_SQL } from "./thread-key";
import { AUTOMATIC_SUBJECT_SQL } from "./domain/message-state";
import { OUTREACH_OUTCOMES, outreachOutcomeSql, outreachNextAction, type OutreachOutcome } from "./domain/outreach-evidence";

export interface OutreachHistoryOptions { project?: string; status?: string; q?: string; days?: string; before?: string; asOf?: string }
export interface OutreachHistoryRow {
  id: string; created_at: string; direction: string; subject: string | null; body: string | null;
  sender_email: string | null; recipient_email: string | null; provider: string | null;
  gmail_message_id: string | null; rfc822_message_id: string | null; thread_key: string;
  provider_attempted_at: string | null; provider_accepted_at: string | null;
  opened_at: string | null; clicked_at: string | null; replied_at: string | null;
  follow_up_at: string | null; delivery_state: string | null; delivery_detail: string | null;
  opportunity_id: string | null; opportunity_title: string | null; solicitation_number: string | null;
  subcontractor_id: string | null; company_name: string | null;
  current_contact_source: string | null; current_contact_verified: boolean | null;
  intent_kind: string | null; saved_actor: string | null; closed: boolean;
  outcome: OutreachOutcome; related_quote_count: number; reply_review: boolean;
  next_action: string;
}

function parseCursor(raw?: string): { at: string; id: string; asOf: string } | null {
  if (!raw || raw.length > 600) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString());
    return c && typeof c.id === 'string' && UUID.test(c.id)
      && typeof c.at === 'string' && Number.isFinite(Date.parse(c.at))
      && typeof c.asOf === 'string' && Number.isFinite(Date.parse(c.asOf))
      && Date.parse(c.at) <= Date.parse(c.asOf) ? c : null;
  } catch { return null; }
}

interface ProjectCount { outcome: OutreachOutcome; opportunity_id: string | null; opportunity_title: string | null; solicitation_number: string | null; messages: number }

/** A fixed creation-date cohort; statuses are current, not a historical snapshot. */
export async function outreachHistory(orgId: string, opts: OutreachHistoryOptions = {}, canSeeDiagnostics = false) {
  if (opts.project && !UUID.test(opts.project)) throw new Error("Invalid solicitation scope.");
  const cursor = parseCursor(opts.before);
  if (opts.before && !cursor) throw new Error("Invalid history cursor. Open the newest records to restart.");
  const asOf = cursor?.asOf ?? (opts.asOf && Number.isFinite(Date.parse(opts.asOf)) ? new Date(opts.asOf).toISOString() : new Date().toISOString());
  const days = opts.days === "all" ? null : opts.days === "30" ? 30 : 90;
  const since = days === null ? null : new Date(Date.parse(asOf) - days * 86400000).toISOString();
  const status = Object.hasOwn(OUTREACH_OUTCOMES, opts.status ?? "") ? opts.status! : "all";
  const needle = opts.q?.trim().slice(0, 300).replace(/[\\%_]/g, "\\$&");
  const params = [orgId, opts.project || null, asOf, since, AUTOMATIC_SUBJECT_SQL,
    status, needle ? `%${needle}%` : null];
  // Contacts and opportunities join on the organization as well as the ID.
  // Source/verification describes the CURRENT contact, never an old recipient.
  const scoped = `with scoped as (
    select c.*, ${THREAD_KEY_SQL} as thread_key,
      o.title as opportunity_title,o.solicitation_number,
      s.company_name,s.email_source as current_contact_source,s.email_verified as current_contact_verified,
      coalesce(o.status<>'open' or o.stage in ('archived','won','lost','dismissed')
        or coalesce(o.pursuit_state,'active')<>'active',false) as closed,
      ${outreachOutcomeSql("c", "$5")} as outcome
    from communications c
    left join opportunities o on o.id=c.opportunity_id and o.org_id=c.org_id
    left join subcontractors s on s.id=c.subcontractor_id and s.org_id=c.org_id
    where c.org_id=$1 and c.channel='email'
      and ($2::uuid is null or c.opportunity_id=$2)
      and c.created_at <= $3::timestamptz
      and ($4::timestamptz is null or c.created_at > $4::timestamptz)
  ), filtered as (select * from scoped
    where ($6::text='all' or outcome=$6)
      and ($7::text is null or concat_ws(' ',subject,body,sender_email,recipient_email,
        company_name,opportunity_title,solicitation_number) ilike $7))`;
  // One SQL statement gives rows and totals the same database snapshot.
  const [result] = await query<{ summary: ProjectCount[]; rows: OutreachHistoryRow[] }>(`${scoped},
    totals as (select outcome,opportunity_id,opportunity_title,solicitation_number,count(*)::int as messages from filtered
      group by outcome,opportunity_id,opportunity_title,solicitation_number),
    page as (
      select f.id,f.created_at::text,f.direction,f.subject,f.body,
        coalesce(f.sender_email,case when f.direction='inbound' then f.meta->'envelope'->>'from' end) as sender_email,
        f.recipient_email,f.provider,f.gmail_message_id,f.rfc822_message_id,f.thread_key,
        f.provider_attempted_at::text,f.provider_accepted_at::text,
        f.opened_at::text,f.clicked_at::text,f.replied_at::text,f.follow_up_at::text,
        f.delivery_state,f.delivery_detail,f.opportunity_id,f.opportunity_title,f.solicitation_number,
        f.subcontractor_id,f.company_name,f.current_contact_source,f.current_contact_verified,
        f.meta->>'kind' as intent_kind,f.meta->>'actor_id' as saved_actor,f.closed,f.outcome,
        (select count(*)::int from quotes q where q.org_id=$1 and q.opportunity_id=f.opportunity_id
          and q.subcontractor_id=f.subcontractor_id) as related_quote_count,
        exists(select 1 from subcontractor_reply_events r where r.org_id=$1
          and r.gmail_message_id=f.gmail_message_id and r.opportunity_id=f.opportunity_id
          and r.subcontractor_id=f.subcontractor_id and r.needs_review and r.reviewed_at is null) as reply_review
      from filtered f
      where ($8::timestamptz is null or (f.created_at,f.id)<($8::timestamptz,$9::uuid))
      order by f.created_at desc,f.id desc limit 51)
    select coalesce((select jsonb_agg(t order by opportunity_title nulls last,opportunity_id,outcome) from totals t),'[]'::jsonb) as summary,
      coalesce((select jsonb_agg(p order by created_at::timestamptz desc,id desc) from page p),'[]'::jsonb) as rows`,
    [...params,cursor?.at ?? null,cursor?.id ?? null]);
  const {summary,rows} = result;
  const shown = rows.slice(0,50).map(row => ({ ...row,
    delivery_detail: canSeeDiagnostics ? row.delivery_detail : null,
    next_action: outreachNextAction({outcome:row.outcome,closed:row.closed,quoteCount:row.related_quote_count,replyReview:row.reply_review}),
  }));
  const last = shown.at(-1);
  const counts = Object.fromEntries(Object.keys(OUTREACH_OUTCOMES).filter(k=>k!=="all").map(k=>[k,0])) as Record<OutreachOutcome,number>;
  for (const row of summary) counts[row.outcome] += Number(row.messages);
  return { rows: shown, counts, projectCounts: summary, total: summary.reduce((n,r)=>n+Number(r.messages),0),
    asOf,since,status,days:days?.toString() ?? "all",
    next:rows.length>50 && last ? Buffer.from(JSON.stringify({at:last.created_at,id:last.id,asOf})).toString("base64url") : null };
}
