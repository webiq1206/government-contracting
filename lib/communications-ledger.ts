import { query } from "./db";
import { THREAD_KEY_SQL } from "./thread-key";
import { messageState, type MessageRow } from "./domain/message-state";

export const LEDGER_FILTERS = {
  all: "All records", sent: "Sent", refused: "Failed or refused", unknown: "Unconfirmed",
  replied: "Replied", received: "Received", held: "Held", draft: "Drafts", other: "Calls and notes",
} as const;
export type LedgerFilter = keyof typeof LEDGER_FILTERS;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface LedgerOptions { q?: string; status?: string; sub?: string; project?: string; thread?: string; before?: string }
interface LedgerRow extends MessageRow {
  id: string; created_at: string; channel: string; body: string | null;
  sender_email: string | null; recipient_email: string | null;
  subcontractor_id: string | null; company_name: string | null;
  opportunity_id: string | null; opportunity_title: string | null;
  gmail_message_id: string | null; thread_key: string; category: LedgerFilter;
}

function cursor(raw?: string): { at: string; id: string } | null {
  if (!raw || raw.length > 300) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    return typeof value.at === "string" && Number.isFinite(Date.parse(value.at)) && UUID.test(value.id)
      ? { at: value.at, id: value.id } : null;
  } catch { return null; }
}

/** Bounded pages across the entire stored ledger; never substitute contact data for historical headers. */
export async function communicationsLedger(orgId: string, opts: LedgerOptions = {}) {
  const before = cursor(opts.before);
  const status = Object.hasOwn(LEDGER_FILTERS, opts.status ?? "") ? opts.status : "all";
  const needle = opts.q?.trim().slice(0, 300).replace(/[\\%_]/g, "\\$&");
  // Invalid record scopes must fail closed, not silently broaden to the account.
  if ((opts.sub && !UUID.test(opts.sub)) || (opts.project && !UUID.test(opts.project)))
    return { rows: [], next: null };
  const rows = await query<LedgerRow>(`with ledger as (
    select c.*, ${THREAD_KEY_SQL} as thread_key, s.company_name, o.title as opportunity_title,
      case when c.channel <> 'email' then 'other'
        when c.direction = 'inbound' then 'received'
        when c.delivery_state in ('failed','bounced') then 'refused'
        when c.delivery_state = 'held' then 'held'
        when c.delivery_state = 'draft' then 'draft'
        when c.delivery_state is null or c.delivery_state in ('queued','attempting','unknown') or c.provider is null then 'unknown'
        when c.replied_at is not null then 'replied'
        else 'sent' end as category
      from communications c
      left join subcontractors s on s.id=c.subcontractor_id and s.org_id=$1
      left join opportunities o on o.id=c.opportunity_id and o.org_id=$1
      where c.org_id=$1
        and ($2::uuid is null or c.subcontractor_id=$2)
        and ($3::uuid is null or c.opportunity_id=$3)
        and ($4::text is null or ${THREAD_KEY_SQL}=$4)
    ) select id, created_at::text, channel, direction, subject, body, provider,
      sender_email, recipient_email, subcontractor_id, company_name, opportunity_id,
      opportunity_title, gmail_message_id, thread_key, category, delivery_state,
      delivery_detail, opened_at, clicked_at, replied_at
    from ledger where ($5::text='all' or category=$5)
      and ($6::text is null or concat_ws(' ',company_name,opportunity_title,subject,body,sender_email,recipient_email) ilike $6)
      and ($7::timestamptz is null or (created_at,id)<($7::timestamptz,$8::uuid))
    order by ledger.created_at desc,id desc limit 51`,
    [orgId, opts.sub || null, opts.project || null, opts.thread?.slice(0, 500) || null,
      status, needle ? `%${needle}%` : null, before?.at ?? null, before?.id ?? null]);
  const shown = rows.slice(0, 50);
  const last = shown.at(-1);
  return {
    rows: shown.map(row => ({ ...row, delivery_detail: null, state: messageState(row) })),
    next: rows.length > 50 && last ? Buffer.from(JSON.stringify({ at: last.created_at, id: last.id })).toString("base64url") : null,
  };
}
