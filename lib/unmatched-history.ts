import { query } from "./db";
import { UUID } from "./communications-ledger";
import { THREAD_KEY_SQL } from "./thread-key";
import type { PendingMessage } from "../components/needs-matching-inbox";

export interface UnmatchedOptions { q?: string; known?: string; after?: string }

/** Read every waiting message through bounded pages, including beyond the inbox preview. */
export async function unmatchedHistory(orgId: string, opts: UnmatchedOptions = {}) {
  let cursor: { at: string; id: string } | null = null;
  if (opts.after) {
    try {
      const c = opts.after.length <= 400 ? JSON.parse(Buffer.from(opts.after,"base64url").toString()) : null;
      if (c && typeof c.at === "string" && Number.isFinite(Date.parse(c.at)) && typeof c.id === "string" && UUID.test(c.id)) cursor = c;
    } catch { /* rejected below */ }
    if (!cursor) throw new Error("Invalid unmatched-mail cursor. Return to the oldest records.");
  }
  const needle = opts.q?.trim().slice(0,300).replace(/[\\%_]/g,"\\$&");
  const [result] = await query<{ total: number; rows: PendingMessage[] }>(`with waiting as (
    select u.id,u.received_at,u.from_email,u.from_name,u.subject,u.snippet,u.subcontractor_id,s.company_name,
      u.attachment_names,u.unreadable_attachments,
      (select ${THREAD_KEY_SQL} from communications c where c.org_id=u.org_id and c.gmail_message_id=u.message_id
        and c.channel='email' and c.direction='inbound' order by c.created_at,c.id limit 1) as captured_thread_key
      from unmatched_inbound u left join subcontractors s on s.id=u.subcontractor_id and s.org_id=u.org_id
     where u.org_id=$1 and u.state='needs_matching'
       and (not $2::boolean or s.id is not null)
       and ($3::text is null or concat_ws(' ',u.from_email,u.from_name,u.subject,u.snippet,s.company_name) ilike $3)
  ), page as (
    select id,received_at::text as "receivedAt",from_email as "fromEmail",from_name as "fromName",
      subject,snippet,subcontractor_id as "subcontractorId",company_name as "subcontractorName",
      attachment_names as "attachmentNames",unreadable_attachments as "unreadableAttachments",captured_thread_key as "capturedThreadKey"
    from waiting where ($4::timestamptz is null or (received_at,id)>($4::timestamptz,$5::uuid))
    order by received_at,id limit 51
  ) select (select count(*)::int from waiting) as total,
    coalesce((select jsonb_agg(p order by "receivedAt"::timestamptz,id) from page p),'[]'::jsonb) as rows`,
    [orgId,opts.known === "yes",needle ? `%${needle}%` : null,cursor?.at ?? null,cursor?.id ?? null]);
  const rows = result.rows.slice(0,50), last = rows.at(-1);
  return {rows,total:result.total,next:result.rows.length>50 && last
    ? Buffer.from(JSON.stringify({at:last.receivedAt,id:last.id})).toString("base64url") : null};
}
