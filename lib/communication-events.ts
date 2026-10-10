import { query } from "./db";
export interface CommunicationEvent {
  id:string; recorded_at:string; kind:string;
  evidence:{delivery_state?:string|null;previous_delivery_state?:string|null;legacy_snapshot?:boolean;
    provider?:string|null;provider_message_id?:string|null;rfc822_message_id?:string|null;gmail_thread_id?:string|null;
    sender_email?:string|null;provider_attempted_at?:string|null;provider_accepted_at?:string|null;
    provider_account_email?:string|null;provider_connection_generation?:string|null;
    delivery_detail?:string|null;opened_at?:string|null;clicked_at?:string|null;replied_at?:string|null;follow_up_at?:string|null;record_created_at?:string|null};
  content:{subject?:string|null;body?:string|null;recipient_email?:string|null;direction?:string|null;intent_kind?:string|null;actor_id?:string|null;scheduled_key?:string|null;request_key?:string|null}|null;
}
export async function communicationEvents(orgId:string,communicationId:string,before?:string,canSeeDiagnostics=false) {
  if(before && (!/^[1-9][0-9]{0,18}$/.test(before) || BigInt(before)>9223372036854775807n)) throw new Error("Invalid event cursor.");
  const rows=await query<CommunicationEvent>(`select id::text,recorded_at::text,kind,evidence,content from communication_events
    where org_id=$1 and communication_id=$2 and ($3::bigint is null or id<$3::bigint)
    order by id desc limit 51`,[orgId,communicationId,before ?? null]);
  return {rows:rows.slice(0,50).map(r=>({...r,evidence:{...r.evidence,delivery_detail:canSeeDiagnostics?r.evidence.delivery_detail:null}})),
    next:rows.length>50?rows[49].id:null};
}
