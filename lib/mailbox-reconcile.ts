import {query,queryOne,tenantTransaction} from "./db";
import {gmail,type GmailMailboxMessage} from "./integrations/gmail";
import {singleMailbox} from "./domain/email-mime";
import {classifyReplyNotice} from "./domain/reply-notice";
import {captureReply,type MatchedComm} from "./reply-capture";
import {runWithOrg,currentOrgId} from "./tenant-context";
import {withReplyProcessingLock} from "./reply-processing-lock";
import {isAutomationPaused,isPlatformAutomationPaused} from "./app-settings";
import {looksLikeBounce,parseBounce} from "./domain/email-delivery";

const norm=(value:string|null|undefined)=>singleMailbox(value ?? "")?.toLowerCase() ?? "";
// Split only actual mailbox tokens. An address in a quoted display name is
// not a recipient, and ambiguous/group syntax is held rather than guessed.
function addresses(value:string):string[] {
  if(/[\r\n\x00-\x1f\x7f]/.test(value))return [];
  const parts:string[]=[];let part="",quoted=false,angle=false,escaped=false;
  for(const char of value) {
    if(escaped){part+=char;escaped=false;continue;}
    if(char==="\\" && quoted){part+=char;escaped=true;continue;}
    if(char==='"')quoted=!quoted;
    if(!quoted) {
      if(char==="<"){if(angle)return [];angle=true;}
      if(char===">"){if(!angle)return [];angle=false;}
      if(char==="," && !angle){parts.push(part);part="";continue;}
      if(char===";" || char===":")return [];
    }
    part+=char;
  }
  if(quoted || angle || escaped)return [];
  parts.push(part);
  const parsed=parts.map(norm);
  return parsed.every(Boolean)?parsed:[];
}
const OVERLAP=300;
interface Connection {
  email:string;send_as:string|null;status:string;connection_generation:string;
  after:string|null;page:string|null;started:string|null;generation:string|null;thread_after:string|null;thread_generation:string|null;senders:string|null;
}
interface BoundThread extends MatchedComm {gmail_message_id:string|null;recipient_email:string|null;created_at:string;direction:string;rfc822_message_id:string|null}
export type MailboxImportResult="imported"|"duplicate"|"unmatched"|"held";

/** Google's internal date, not a sender-controlled Date header or ingestion time. */
export function mailboxSourceAt(message:GmailMailboxMessage,now=new Date()):string|null {
  if(!/^\d{10,16}$/.test(message.internalDate ?? ""))return null;
  const at=new Date(Number(message.internalDate));
  return Number.isFinite(at.getTime()) && at.getTime()>=946684800000 && at.getTime()<=now.getTime()+300_000 ? at.toISOString():null;
}

async function threadRows(orgId:string,threadId:string):Promise<BoundThread[]> {
  return query<BoundThread>(`select c.id,c.subcontractor_id,c.opportunity_id,c.recipient_email,c.created_at::text,
      c.direction,c.gmail_message_id,c.rfc822_message_id,c.meta->>'trade' as trade,s.company_name,s.email as sub_email,o.title as opportunity_title
    from communications c join opportunities o on o.id=c.opportunity_id and o.org_id=c.org_id
    join subcontractors s on s.id=c.subcontractor_id and s.org_id=c.org_id
    where c.org_id=$1 and c.gmail_thread_id=$2 and c.channel='email'
    order by c.created_at,c.id limit 1001`,[orgId,threadId]);
}

/** An exact owned thread must identify one firm/opportunity/trade. No address/subject guess. */
function bindThread(rows:BoundThread[]):BoundThread|null {
  if(!rows.length || rows.length>1000)return null;
  const outbound=rows.filter(r=>r.direction==="outbound");
  const keys=new Set(outbound.map(r=>JSON.stringify([r.opportunity_id,r.subcontractor_id,r.trade ?? ""])));
  const bound=keys.size===1 ? outbound[0] ?? null:null;
  return bound && rows.every(r=>r.opportunity_id===bound.opportunity_id && r.subcontractor_id===bound.subcontractor_id &&
    (!r.trade || r.trade===(bound.trade ?? "")))?bound:null;
}

/** Lock the existing grant through each write. Reconnect/revocation must wait
 * for that unit of capture, or win before it and refuse the stale evidence.
 * Capture's own durable message locks still protect its multi-step effects. */
async function withCurrentMailbox<T>(orgId:string,generation:string,fn:()=>Promise<T>):Promise<T> {
  return tenantTransaction(orgId,async tx=>{
    const row=(await tx.query<{connection_generation:string}>(`select connection_generation from integration_tokens
      where org_id=$1 and provider='gmail' and status<>'revoked' for share`,[orgId])).rows[0];
    if(row?.connection_generation!==generation)throw Error("Mailbox connection changed; stale history was not applied.");
    return fn();
  });
}

/** Observe one real SENT receipt. Never mark a bid/review resolved or create a follow-up. */
export async function importMailboxSent(orgId:string,generation:string,expectedSender:string|string[],message:GmailMailboxMessage,
  now=new Date()):Promise<MailboxImportResult> {
  if(currentOrgId() && currentOrgId()!==orgId)return "held";
  if(!message.messageId || !message.threadId || !message.labels.includes("SENT") || message.labels.includes("DRAFT") ||
      message.labels.includes("TRASH") || message.bodyAvailable===false || !(Array.isArray(expectedSender)?expectedSender:[expectedSender]).some(s=>norm(s)===norm(message.from)))return "held";
  const at=mailboxSourceAt(message,now);if(!at)return "held";
  const rows=await threadRows(orgId,message.threadId),bound=bindThread(rows);
  if(!bound)return rows.length ? "held":"unmatched";
  const known=new Set([norm(bound.sub_email),...rows.filter(r=>r.direction==="outbound").map(r=>norm(r.recipient_email))].filter(Boolean));
  const recipient=addresses(message.to).find(a=>known.has(a));
  if(!recipient)return "held";
  const priorMessage=rows.some(r=>r.gmail_message_id!==message.messageId && new Date(r.created_at).getTime()<=Date.parse(at));
  return tenantTransaction(orgId,async tx=>{
    // Serialize this importer without a new schema or rewriting old duplicates.
    await tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[JSON.stringify(["mailbox-observe",orgId,message.messageId])]);
    const connection=(await tx.query<{connection_generation:string}>(`select connection_generation from integration_tokens
      where org_id=$1 and provider='gmail' and status<>'revoked' for update`,[orgId])).rows[0];
    if(connection?.connection_generation!==generation)return "held";
    const existing=(await tx.query<{id:string;direction:string;gmail_thread_id:string|null;opportunity_id:string|null;subcontractor_id:string|null;delivery_state:string|null;meta:Record<string,unknown>|null}>(`select id,direction,gmail_thread_id,opportunity_id,subcontractor_id,delivery_state,meta from communications
      where org_id=$1 and gmail_message_id=$2 order by created_at limit 2 for update`,[orgId,message.messageId])).rows;
    if(existing.length>1 || existing.some(r=>r.direction!=="outbound" || r.gmail_thread_id!==message.threadId ||
      r.opportunity_id!==bound.opportunity_id || r.subcontractor_id!==bound.subcontractor_id ||
      !["sent","delivered","bounced","failed","deferred"].includes(r.delivery_state ?? "")))return "held";
    // A provider send can be accepted before its application receipt commits.
    // Do not manufacture a second row beside a pending/uncertain intent.
    if(!existing.length) {
      const uncertain=(await tx.query(`select id from communications where org_id=$1 and direction='outbound'
        and lower(recipient_email)=$2 and (delivery_state in ('attempting','unknown')
          or (delivery_state='queued' and provider_attempted_at is not null)
          or (delivery_state='held' and meta->>'reconciled'='gmail_not_found')) limit 1`,[orgId,recipient])).rows;
      if(uncertain.length)return "held";
    }
    const observedReply=priorMessage && (!existing.length || ["mailbox_sent","manual"].includes(String(existing[0].meta?.kind ?? "")));
    let id=existing[0]?.id;
    if(!id)id=(await tx.query<{id:string}>(`insert into communications
      (org_id,opportunity_id,subcontractor_id,channel,direction,subject,body,created_at,recipient_email,
       sender_email,gmail_message_id,gmail_thread_id,rfc822_message_id,provider,delivery_state,provider_accepted_at,meta)
      values($1,$2,$3,'email','outbound',$4,$5,$6,$7,$8,$9,$10,$11,'gmail','sent',$6,$12::jsonb) returning id`,
      [orgId,bound.opportunity_id,bound.subcontractor_id,message.subject.slice(0,1000),message.body.slice(0,20000),at,
        recipient,norm(message.from),message.messageId,message.threadId,message.rfc822MessageId,
        JSON.stringify({kind:"mailbox_sent",trade:bound.trade,mailbox_observed_at:now.toISOString(),
          mailbox_source_at:at,mailbox_reply:observedReply,mailbox_connection_generation:generation,
          envelope:{from:message.from,to:message.to,cc:message.cc,date:message.date},
          attachments:message.attachments.map(a=>a.filename),in_reply_to:message.inReplyTo,references:message.references})])).rows[0]?.id;
    if(!id)throw Error("The observed Sent receipt was not saved.");
    if(observedReply) {
      await tx.query(`update communications set meta=coalesce(meta,'{}'::jsonb)||'{"mailbox_reply":true}'::jsonb
        where id=$1 and org_id=$2`,[id,orgId]);
      await tx.query(`update communications set follow_up_at=null where org_id=$1 and gmail_thread_id=$2
        and opportunity_id=$3 and subcontractor_id=$4 and direction='outbound' and created_at<=$5::timestamptz
        and coalesce(meta->>'kind','')<>'compliance-chase'`,
        [orgId,message.threadId,bound.opportunity_id,bound.subcontractor_id,at]);
      // A queued, provably unattempted chase is not an uncertain provider
      // receipt. Keep its text/evidence, but make its cancellation durable.
      await tx.query(`update communications set delivery_state='held',follow_up_at=null,
        meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('mailbox_reply_cancelled_by',$6::text)
        where org_id=$1 and gmail_thread_id=$2 and opportunity_id=$3 and subcontractor_id=$4
          and direction='outbound' and created_at<=$5::timestamptz and provider_attempted_at is null
          and delivery_state in ('draft','queued','held','failed')
          and coalesce(meta->>'reconciled','')<>'gmail_not_found'
          and meta->>'kind' in ('outreach','followup','final_nudge','clarification','manual','decline_thank_you')`,
        [orgId,message.threadId,bound.opportunity_id,bound.subcontractor_id,at,message.messageId]);
    }
    return existing.length ? "duplicate":"imported";
  });
}

/** While sending is paused, capture known incoming history without paid interpretation or mail. */
async function observePausedIncoming(orgId:string,generation:string,message:GmailMailboxMessage,now:Date):Promise<void> {
  if(message.labels.some(l=>["SENT","DRAFT","TRASH"].includes(l)))return;
  const at=mailboxSourceAt(message,now);if(!at)throw Error("A known incoming message has no trustworthy provider date.");
  const rows=await threadRows(orgId,message.threadId),bound=bindThread(rows);if(!bound)return;
  return withCurrentMailbox(orgId,generation,async()=>{
  if(looksLikeBounce(message)) {
    const report=parseBounce(message.deliveryReport || message.body);
    if(report.recipient && !rows.some(r=>r.direction==="outbound" && norm(r.recipient_email)===norm(report.recipient)))
      throw Error("The delivery notice names a different recipient; review its attribution before applying it.");
    if(report.originalMessageId && !rows.some(r=>r.direction==="outbound" && r.rfc822_message_id===report.originalMessageId))
      throw Error("The delivery notice names a different original message; review its attribution before applying it.");
    const {recordBounce}=await import("./agents/maintenance");
    await recordBounce({orgId,messageId:message.messageId,threadId:message.threadId,subject:message.subject,
      body:message.body,report,sentAt:at,mailboxReceivedAt:at});
    return;
  }
  const from=norm(message.from);if(!from)return;
  const notice=classifyReplyNotice({body:message.body,subject:message.subject,autoSubmitted:message.autoSubmitted,
    attachmentNames:message.attachments.map(a=>a.filename),requestedTrade:bound.trade});
  if(notice.kind!=="human" && message.bodyAvailable!==false) {
    await captureReply({orgId,comm:bound,strongMatch:true,fromEmail:from,replyText:message.body,
      messageId:message.messageId,threadId:message.threadId,rfc822MessageId:message.rfc822MessageId,
      subject:message.subject,contentType:message.contentType,autoSubmitted:message.autoSubmitted,
      fromAddress:message.from,toAddresses:message.to,ccAddresses:message.cc,sentAt:at,
      attachmentNames:message.attachments.map(a=>a.filename),references:message.references,
      acknowledgeDecline:false,mailboxReceivedAt:at});
    return;
  }
  // No pretend understanding. The ordinary poller can resume this same row
  // after sending/paid work is deliberately resumed; its cursor is untouched.
  await query(`insert into communications(org_id,opportunity_id,subcontractor_id,channel,direction,subject,body,
    created_at,recipient_email,gmail_message_id,gmail_thread_id,rfc822_message_id,meta)
    values($1,$2,$3,'email','inbound',$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
    on conflict(org_id,gmail_message_id) where direction='inbound' and gmail_message_id is not null and org_id is not null do nothing`,
    [orgId,bound.opportunity_id,bound.subcontractor_id,message.subject.slice(0,1000),message.body.slice(0,20000),at,message.from,
      message.messageId,message.threadId,message.rfc822MessageId,JSON.stringify({capture_version:1,reply_processing_complete:false,
        capture_stage:"monitor_received",mailbox_source_at:at,trade:bound.trade,unreadable_body:message.bodyAvailable===false,
        envelope:{from:message.from,to:message.to,cc:message.cc,sentAt:at,autoSubmitted:message.autoSubmitted,attachments:message.attachments.map(a=>a.filename)}})]);
  });
}

/** One bounded mailbox scan. Account pause allows capture only; platform pause still stops it. */
export async function reconcileMailboxForOrg(orgId:string,now=new Date()) {
  if(currentOrgId() && currentOrgId()!==orgId)return {ok:false,summary:"Mailbox history sync refused a different organization."};
  return runWithOrg(orgId,()=>withReplyProcessingLock(orgId,"mailbox-history",async()=>{
    if(await isPlatformAutomationPaused())return {ok:true,summary:"Mailbox history sync is stopped by the platform pause."};
    const conn=await queryOne<Connection>(`select email,send_as,status,connection_generation,
      data->>'mailbox_sync_after' as after,data->>'mailbox_sync_page' as page,data->>'mailbox_sync_started' as started,
      data->>'mailbox_sync_generation' as generation,data->>'mailbox_sync_thread_after' as thread_after,
      data->>'mailbox_sync_thread_generation' as thread_generation,data->>'mailbox_sync_senders' as senders
      from integration_tokens where provider='gmail' and org_id=$1`,[orgId]);
    if(!conn || conn.status==="revoked" || !/^[a-f0-9-]{36}$/i.test(conn.connection_generation ?? ""))return {ok:true,summary:"No usable existing mailbox connection; no history imported."};
    const identity=await gmail.mailboxIdentity(orgId);
    if(!identity.ok || norm(identity.email)!==norm(conn.email))return {ok:false,summary:"Connected mailbox identity could not be verified; no history imported."};
    const aliases=await gmail.sendAsAddresses(orgId,{refresh:true,storedOnly:true}),sender=norm(conn.send_as || conn.email);
    if(!aliases.ok || !aliases.options.some(a=>norm(a.address)===sender))return {ok:false,summary:"The configured sending alias could not be verified through the existing grant; no history imported."};
    const observedSenders=aliases.options.map(a=>a.address);
    const senderKey=observedSenders.map(norm).sort().join(",");
    const same=conn.generation===conn.connection_generation;
    const seconds=Math.floor(now.getTime()/1000),rawAfter=Number(conn.after),rawStarted=Number(conn.started);
    const validCursor=same && conn.senders===senderKey && Number.isSafeInteger(rawAfter) && rawAfter>0 && rawAfter<=seconds;
    const after=validCursor?rawAfter:seconds-30*86400;
    const started=validCursor && Number.isSafeInteger(rawStarted) && rawStarted>=after && rawStarted<=seconds?rawStarted:seconds;
    const page=await gmail.fetchSentMailbox(after,orgId,observedSenders,validCursor?conn.page:null);
    let imported=0,held=0,unread=0;
    for(const message of page.messages) {
      const r=await importMailboxSent(orgId,conn.connection_generation,observedSenders,message,now);
      if(r==="imported")imported++;if(r==="held")held++;
    }
    const pageComplete=!page.error && held===0;
    const threads=await query<{gmail_thread_id:string}>(`select distinct c.gmail_thread_id from communications c
      join opportunities o on o.id=c.opportunity_id and o.org_id=c.org_id
      join subcontractors s on s.id=c.subcontractor_id and s.org_id=c.org_id
      where c.org_id=$1 and c.gmail_thread_id is not null and c.gmail_thread_id>$2
      order by c.gmail_thread_id limit 10`,[orgId,conn.thread_generation===conn.connection_generation?conn.thread_after ?? "":""]);
    const paused=await isAutomationPaused();
    for(const thread of threads) {
      const read=await gmail.readMailboxThread(thread.gmail_thread_id,orgId);
      if(read.error){unread++;continue;}
      const ordered=[...read.messages].sort((a,b)=>Number(a.internalDate)-Number(b.internalDate));
      for(const message of ordered) {
        if(message.labels.includes("SENT")) {
          const r=await importMailboxSent(orgId,conn.connection_generation,observedSenders,message,now);
          if(r==="imported")imported++;if(r==="held")held++;
        }else if(paused && !observedSenders.some(s=>norm(s)===norm(message.from))) {
          try {await observePausedIncoming(orgId,conn.connection_generation,message,now);}
          catch {held++;}
        }
      }
    }
    // The Sent walk never skips a failed/ambiguous page. Known threads rotate
    // independently so one held send cannot starve later incoming replies.
    const progress:Record<string,string|null>={mailbox_sync_thread_generation:conn.connection_generation,
      mailbox_sync_thread_after:threads.length===10?threads[threads.length-1].gmail_thread_id:""};
    if(pageComplete)Object.assign(progress,{mailbox_sync_generation:conn.connection_generation,
      mailbox_sync_senders:senderKey,
      mailbox_sync_after:page.nextPageToken?String(after):String(Math.max(1,started-OVERLAP)),
      mailbox_sync_page:page.nextPageToken ?? null,mailbox_sync_started:page.nextPageToken?String(started):null});
    const saved=await query(`update integration_tokens set data=coalesce(data,'{}'::jsonb)||$3::jsonb
      where provider='gmail' and org_id=$1 and connection_generation=$2::uuid and status<>'revoked' returning org_id`,
      [orgId,conn.connection_generation,JSON.stringify(progress)]);
    if(saved.length!==1)throw Error("Mailbox connection changed; cursor update could not be verified.");
    if(page.error || held || unread)return {ok:false,humanActionRequired:held>0,
      summary:`Observed ${imported} new Sent receipt(s); ${held} message(s) held for review, ${unread} thread(s) unread. History is incomplete. ${pageComplete?"Sent page saved; known threads remain in rotation.":"Sent cursor unchanged; known threads remain in rotation."} ${page.error ?? ""}`};
    return {ok:true,summary:`Observed ${imported} new Sent receipt(s); checked ${threads.length} owned thread(s). ${paused?"Sending remains paused; no paid interpretation, outreach or acknowledgments were started.":"No messages or decisions were sent by this history sync."}`};
  }));
}
