/**
 * Maintenance jobs, not part of the 13-agent roster, but the plumbing that
 * keeps time-based workflows moving:
 *   - outreach-followup : send the automated 48-hour follow-up (spec step 6)
 *   - review-expiry-sweep : auto-dismiss review-tier items after the timer (spec)
 *   - reply-poll : detect sub replies via Gmail, mark responsive, trigger Call Prep
 */
import { query, queryOne } from "../db";
import { gmail } from "../integrations/gmail";
import { sms } from "../integrations/twilio";
import { email } from "../integrations/resend";
import { config } from "../config";
import { logAgent } from "../logger";
import { STALL_HOURS, STAGE_AGENT } from "../domain/journey";
import { getAutomationRules } from "../app-settings";
import { enqueue } from "../queue";
import { sendPendingApproved, sendFollowUps } from "../backlink-send";
import type { AgentDefinition } from "./types";
import type { AgentResult } from "../types";

export const outreachFollowup: AgentDefinition = {
  name: "outreach-followup",
  label: "Outreach Follow-up",
  description: "Sends the automated 48-hour follow-up to non-responsive subcontractors.",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    const due = await query<{
      id: string;
      subcontractor_id: string;
      opportunity_id: string;
      subject: string | null;
      body: string | null;
      tracking_id: string | null;
      email: string | null;
      email_verified: boolean;
    }>(
      `select c.id, c.subcontractor_id, c.opportunity_id, c.subject, c.body, c.tracking_id,
              s.email, s.email_verified
         from communications c
         join subcontractors s on s.id = c.subcontractor_id
        where c.channel='email' and c.direction='outbound'
          and c.follow_up_at is not null and c.follow_up_at <= now()
          and c.replied_at is null
        limit 50`
    );
    let sent = 0;
    for (const row of due) {
      // Consume the follow-up marker regardless, so we don't loop.
      await query(`update communications set follow_up_at = null where id = $1`, [row.id]);
      if (!row.email || !row.email_verified) continue;
      const subject = `Following up: ${row.subject ?? "our request"}`;
      const html = `<p>Just following up on my note below, happy to answer any questions or set up a quick call.</p><hr/>${(row.body ?? "").replace(/\n/g, "<br/>")}`;
      const res = await gmail.send({ to: row.email, subject, html, trackingId: row.tracking_id ?? undefined });
      if (!res.disabled && !res.error) {
        await query(
          `insert into communications (subcontractor_id, opportunity_id, channel, direction, subject, body, gmail_message_id)
           values ($1,$2,'email','outbound',$3,$4,$5)`,
          [row.subcontractor_id, row.opportunity_id, subject, html, res.messageId ?? null]
        );
        sent++;
      }
    }
    return { ok: true, summary: `Sent ${sent} follow-up(s) of ${due.length} due.` };
  },
};

export const reviewExpirySweep: AgentDefinition = {
  name: "review-expiry-sweep",
  label: "Review Expiry Sweep",
  description: "Auto-dismisses review-tier opportunities not actioned within the timer.",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    const expired = await query<{ id: string; title: string | null }>(
      `update opportunities
          set stage='dismissed', status='archived', human_action_required=false
        where tier='review' and human_action_required=true
          and review_expires_at is not null and review_expires_at <= now()
        returning id, title`
    );
    for (const o of expired) {
      await logAgent({
        agent: "review-expiry-sweep",
        action: "auto-dismiss",
        opportunityId: o.id,
        level: "info",
        message: `Auto-dismissed review-tier item "${o.title ?? o.id}" (timer expired).`,
        reasoning: "Review-tier opportunities auto-dismiss if not actioned within the configured window.",
      });
    }
    return { ok: true, summary: `Auto-dismissed ${expired.length} expired review item(s).` };
  },
};

/** Why each auto stage stalls, and what the operator should do about it. */
const STALL_REASONING: Record<string, string> = {
  scoring:
    "Scoring never completed. The Scoring Engine may have errored or the Claude key may be missing; check its log and re-run it.",
  analysis:
    "The solicitation analysis never completed. Check the Solicitation Analyst's log and re-run it.",
  sub_research:
    "No subcontractor cleared verification for this opportunity. Needs operator attention (add subs or dismiss).",
  outreach:
    "No subcontractor replied after outreach + follow-up. Needs operator attention (call subs directly or dismiss).",
  bid_building:
    "Quotes were entered but the Bid Builder never priced the bid. Check its log and re-run it.",
};

export const stalledPipelineSweep: AgentDefinition = {
  name: "stalled-pipeline-sweep",
  label: "Stalled Pipeline Sweep",
  description:
    "Flags opportunities stuck in an automatic stage beyond its expected window (same thresholds as the on-page 'looks stuck' banner) so nothing silently dies.",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    // One threshold table drives both this sweep and the opportunity page's
    // "this looks stuck" banner (lib/domain/journey). Two-strike policy:
    //   1st time a record is found stuck -> re-enqueue the responsible agent
    //      automatically (most stalls are a lost/failed job) + mark it.
    //   still stuck on a later sweep    -> flag for the operator.
    // Nothing is ever silently abandoned, and humans are only pulled in when
    // an automatic retry didn't fix it.
    let rescued = 0;
    const stalled: { id: string; title: string | null; stage: string; hours: number }[] = [];
    for (const [stage, hours] of Object.entries(STALL_HOURS)) {
      if (hours == null) continue;
      // bid_building only counts as a system stall while no bid exists yet;
      // once the bid is built, the stage is legitimately waiting on the human.
      const bidGuard =
        stage === "bid_building"
          ? "and not exists (select 1 from bids b where b.opportunity_id = opportunities.id)"
          : "";
      const agent = STAGE_AGENT[stage];
      const retryMarker = `auto_retried_${stage}`;

      // Strike 1: stuck, no retry attempted yet, and we know which agent to
      // re-run -> rescue automatically instead of bothering the operator.
      if (agent) {
        const rescuable = await query<{ id: string; title: string | null }>(
          `update opportunities
              set risk_flags = coalesce(risk_flags, '{}') || array[$3::text]
            where status = 'open' and human_action_required = false
              and stage = $1
              and updated_at < now() - make_interval(hours => $2)
              and not ($3 = any(coalesce(risk_flags, '{}')))
              ${bidGuard}
            returning id, title`,
          [stage, hours, retryMarker]
        );
        for (const o of rescuable) {
          rescued++;
          await enqueue(agent, { opportunityId: o.id, trigger: "rescue" }).catch(() => {});
          await logAgent({
            agent: "stalled-pipeline-sweep",
            action: "auto-retry",
            opportunityId: o.id,
            level: "info",
            message: `"${o.title ?? o.id}" sat in ${stage.replace(/_/g, " ")} past its ${hours}h window; re-running ${agent} automatically. You'll only be asked to step in if this retry doesn't move it.`,
          });
        }
      }

      // Strike 2: still stuck after a rescue (or no agent to rescue with) ->
      // the operator's judgment is genuinely needed.
      const rows = await query<{ id: string; title: string | null; stage: string }>(
        `update opportunities
            set human_action_required = true,
                risk_flags = coalesce(risk_flags, '{}') || array['stalled_' || stage]
          where status = 'open' and human_action_required = false
            and stage = $1
            and updated_at < now() - make_interval(hours => $2)
            and ($3::text is null or $4 = any(coalesce(risk_flags, '{}')))
            ${bidGuard}
          returning id, title, stage`,
        [stage, hours, agent ?? null, `auto_retried_${stage}`]
      );
      stalled.push(...rows.map((r) => ({ ...r, hours })));
    }
    for (const o of stalled) {
      await logAgent({
        agent: "stalled-pipeline-sweep",
        action: "flag-stalled",
        opportunityId: o.id,
        level: "warn",
        message: `Flagged stalled opportunity "${o.title ?? o.id}" (no progress in ${o.stage.replace(/_/g, " ")} for over ${o.hours}h, automatic retry did not move it).`,
        reasoning: STALL_REASONING[o.stage] ?? "No progress beyond the stage's expected window.",
      });
    }
    return {
      ok: true,
      summary: `Auto-retried ${rescued} stuck record(s); flagged ${stalled.length} for review (retry didn't help).`,
    };
  },
};

export const deadlineMonitor: AgentDefinition = {
  name: "deadline-monitor",
  label: "Deadline Monitor",
  description:
    "Warns the operator when a live opportunity's bid deadline is under 48 hours away and no bid has been submitted.",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    // Flag once per opportunity: the deadline_soon risk flag excludes it from
    // the next sweep so the operator isn't re-alerted every 6 hours.
    const urgent = await query<{ id: string; title: string | null; deadline: string; stage: string }>(
      `update opportunities
          set human_action_required = true,
              risk_flags = coalesce(risk_flags, '{}') || array['deadline_soon']
        where status = 'open'
          and stage in ('analysis','sub_research','outreach','call_queue','quote_entry','bid_building')
          and deadline is not null
          and deadline > now()
          and deadline <= now() + interval '48 hours'
          and not ('deadline_soon' = any(coalesce(risk_flags, '{}')))
        returning id, title, deadline, stage`
    );
    for (const o of urgent) {
      const hoursLeft = Math.max(
        0,
        (new Date(o.deadline).getTime() - Date.now()) / 3_600_000
      ).toFixed(0);
      const msg = `Bid due in ${hoursLeft}h: "${o.title ?? o.id}" is still in ${o.stage.replace(/_/g, " ")}. Submit or dismiss before the deadline.`;
      await logAgent({
        agent: "deadline-monitor",
        action: "deadline-warning",
        opportunityId: o.id,
        level: "warn",
        message: msg,
      });
      // Best-effort SMS; silently skipped when Twilio is not configured.
      await sms.alert(msg).catch(() => undefined);
    }
    return {
      ok: true,
      summary: `Deadline check: ${urgent.length} opportunit${urgent.length === 1 ? "y" : "ies"} due within 48h flagged.`,
    };
  },
};

export const scoringRecoverySweep: AgentDefinition = {
  name: "scoring-recovery-sweep",
  label: "Scoring Recovery",
  description:
    "Safety net: re-queues scoring for any opportunity that was ingested but never scored, so nothing can sit in Scoring forever.",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    // Deliberately its OWN job rather than a step inside the Opportunity
    // Monitor: recovery must keep working even when ingestion is failing,
    // which is precisely when records get stranded. Singleton per opportunity
    // per hour makes repeated sweeps idempotent.
    const unscored = await query<{ id: string; title: string | null }>(
      `select id, title from opportunities
        where status='open' and stage in ('monitoring','scoring')
          and score is null
          and created_at < now() - interval '20 minutes'
        order by created_at asc
        limit 200`
    );
    for (const o of unscored) {
      await enqueue(
        "scoring-engine",
        { opportunityId: o.id, trigger: "recovery" },
        { singletonKey: `score:${o.id}`, singletonSeconds: 3600 }
      ).catch(() => {});
    }
    if (unscored.length > 0) {
      await logAgent({
        agent: "scoring-recovery-sweep",
        action: "requeue-scoring",
        level: "info",
        message: `Re-queued scoring for ${unscored.length} opportunit${unscored.length === 1 ? "y" : "ies"} that were ingested but never scored.`,
        reasoning:
          "Their original scoring job was lost or failed out of retries. Scoring is idempotent, so re-running is safe.",
      });
    }
    return {
      ok: true,
      summary:
        unscored.length > 0
          ? `Re-queued scoring for ${unscored.length} unscored opportunit${unscored.length === 1 ? "y" : "ies"}.`
          : "No unscored opportunities; nothing to recover.",
    };
  },
};

export const expiredOpportunitySweep: AgentDefinition = {
  name: "expired-opportunity-sweep",
  label: "Expired Opportunity Sweep",
  description:
    "Archives opportunities whose submission deadline passed without a bid. Nothing is deleted: all documents, communications, and history stay on the archived record.",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    // A passed deadline with no submitted bid means the record can never be
    // won; it leaves the active pipeline (status=archived) so lists stay
    // clean, but keeps its stage and full history for reference. Submitted /
    // won / lost records are untouched — the agency decides those timelines.
    const expired = await query<{ id: string; title: string | null; stage: string; deadline: string }>(
      `update opportunities
          set status='archived', human_action_required=false,
              risk_flags = (select array(select distinct unnest(coalesce(risk_flags,'{}') || array['expired'])))
        where status='open'
          and stage not in ('submitted','won','lost')
          and deadline is not null and deadline < now()
        returning id, title, stage, deadline`
    );
    for (const o of expired) {
      await logAgent({
        agent: "expired-opportunity-sweep",
        action: "archive-expired",
        opportunityId: o.id,
        level: "info",
        message: `Archived "${o.title ?? o.id}": the ${new Date(o.deadline).toISOString().slice(0, 10)} deadline passed while it was still in ${o.stage.replace(/_/g, " ")}.`,
        reasoning:
          "A passed deadline with no submitted bid cannot be won. The record was archived (never deleted) with all documents, communications, and history preserved.",
      });
    }
    return {
      ok: true,
      summary: `Archived ${expired.length} expired opportunit${expired.length === 1 ? "y" : "ies"}.`,
    };
  },
};

export const retentionSweep: AgentDefinition = {
  name: "retention-sweep",
  label: "Retention Sweep",
  description:
    "Permanently deletes archived opportunities past the configured retention period, only when they have no bids or contracts. Off by default (retention 0 = keep forever).",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    const rules = await getAutomationRules();
    if (rules.retention_days <= 0) {
      return {
        ok: true,
        summary: "Retention is set to keep archived records forever; nothing deleted.",
      };
    }
    // Safeguards: only archived records, past retention, with NO bid and NO
    // contract. Anything with a bid or contract is part of the business
    // record and is never auto-deleted. Cascades clean up their documents,
    // quotes, sub pairings, and call cards.
    const deleted = await query<{ id: string; title: string | null }>(
      `delete from opportunities o
        where o.status='archived'
          and o.updated_at < now() - make_interval(days => $1)
          and not exists (select 1 from bids b where b.opportunity_id = o.id)
          and not exists (select 1 from contracts c where c.opportunity_id = o.id)
        returning o.id, o.title`,
      [rules.retention_days]
    );
    if (deleted.length > 0) {
      await logAgent({
        agent: "retention-sweep",
        action: "purge-archived",
        level: "info",
        message: `Permanently deleted ${deleted.length} archived opportunit${deleted.length === 1 ? "y" : "ies"} older than ${rules.retention_days} days with no bids or contracts.`,
        reasoning:
          "Retention policy (Settings → Automation rules). Records with bids or contracts are always kept.",
      });
    }
    return {
      ok: true,
      summary:
        deleted.length > 0
          ? `Purged ${deleted.length} archived record(s) past the ${rules.retention_days}-day retention.`
          : `No archived records past the ${rules.retention_days}-day retention.`,
    };
  },
};

export const logRetentionSweep: AgentDefinition = {
  name: "log-retention-sweep",
  label: "Log Retention Sweep",
  description:
    "Deletes agent log entries older than 90 days (KPI snapshots are kept) so the activity feed stays fast.",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    const res = await query<{ id: string }>(
      `delete from agent_logs
        where created_at < now() - interval '90 days'
          and not (agent = 'analytics-engine' and action = 'kpi-snapshot')
        returning id`
    );
    return { ok: true, summary: `Pruned ${res.length} log entr${res.length === 1 ? "y" : "ies"} older than 90 days.` };
  },
};

/**
 * Backlink outreach sweep: sends approved outreach that now has a contact email,
 * sends one polite follow-up when due, and matches inbound replies to backlink
 * outreach threads. Only ever touches APPROVED outreach — the human gate is
 * enforced upstream. Rule-only; no-ops cleanly when Gmail isn't connected.
 */
export const backlinkOutreachSweep: AgentDefinition = {
  name: "backlink-outreach-sweep",
  label: "Backlink Outreach Sweep",
  description: "Sends approved backlink outreach, follow-ups, and records replies.",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    const send = await sendPendingApproved(25);
    const followUp = await sendFollowUps(25);

    // Reply detection for backlink outreach threads.
    let repliesMatched = 0;
    if (await gmail.isConnected()) {
      const sinceSec = Math.floor(Date.now() / 1000) - 3600;
      const { replies, disabled } = await gmail.fetchReplies(sinceSec);
      if (!disabled) {
        for (const r of replies) {
          const fromEmail = (r.from.match(/<([^>]+)>/)?.[1] ?? r.from).toLowerCase().trim();
          const hit = await queryOne<{ id: string }>(
            `select o.id from backlink_outreach o
               join backlink_prospects p on p.id = o.prospect_id
              where (o.gmail_thread_id = $1 or lower(p.contact_email) = $2)
                and o.sent_at is not null and o.replied_at is null
              order by o.sent_at desc limit 1`,
            [r.threadId, fromEmail]
          );
          if (!hit) continue;
          repliesMatched++;
          await query(`update backlink_outreach set replied_at = now(), updated_at = now() where id = $1`, [
            hit.id,
          ]);
        }
      }
    }

    return {
      ok: true,
      summary: `Backlink outreach: ${send.sent} sent, ${followUp.sent} follow-ups, ${repliesMatched} replies.${
        send.errors ? ` ${send.errors} errors.` : ""
      }`,
      data: { ...send, followUps: followUp.sent, repliesMatched },
      humanActionRequired: repliesMatched > 0,
    };
  },
};

/**
 * Best-effort price spotting in a reply snippet: the largest plausible dollar
 * figure. Never auto-entered as a quote (a human confirms it on the call);
 * it only pre-fills the "their email mentioned $X" hint.
 */
export function extractMentionedPrice(text: string): number | null {
  const matches = [...text.matchAll(/\$\s?([\d][\d,]*(?:\.\d{1,2})?)/g)]
    .map((m) => Number(m[1].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n >= 100 && n <= 100_000_000);
  return matches.length ? Math.max(...matches) : null;
}

export const replyPoll: AgentDefinition = {
  name: "reply-poll",
  label: "Reply Poller",
  description:
    "Detects subcontractor email replies, updates the sub's status, triggers Call Prep, and notifies you about who replied and what changed.",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    if (!(await gmail.isConnected())) {
      return { ok: true, summary: "Gmail not connected, reply polling skipped." };
    }
    const sinceSec = Math.floor(Date.now() / 1000) - 3600; // last hour
    const { replies, disabled } = await gmail.fetchReplies(sinceSec);
    if (disabled) return { ok: true, summary: "Gmail disabled, reply polling skipped." };

    const enqueued: AgentResult["enqueued"] = [];
    const notifyLines: string[] = [];
    let matched = 0;
    for (const r of replies) {
      // Match reply to an outbound communication by thread id, else by sender email.
      const fromEmail = (r.from.match(/<([^>]+)>/)?.[1] ?? r.from).toLowerCase().trim();
      const comm = await queryOne<{
        id: string;
        subcontractor_id: string;
        opportunity_id: string;
        company_name: string;
        opportunity_title: string | null;
      }>(
        `select c.id, c.subcontractor_id, c.opportunity_id,
                s.company_name, o.title as opportunity_title
           from communications c
           join subcontractors s on s.id = c.subcontractor_id
           join opportunities o on o.id = c.opportunity_id
          where (c.gmail_thread_id = $1 or lower(s.email) = $2)
            and c.direction='outbound' and c.replied_at is null
          order by c.created_at desc limit 1`,
        [r.threadId, fromEmail]
      );
      if (!comm) continue;
      matched++;
      const mentionedPrice = extractMentionedPrice(r.snippet);
      await query(
        `insert into communications (subcontractor_id, opportunity_id, channel, direction, subject, body, gmail_thread_id, gmail_message_id, replied_at)
         values ($1,$2,'email','inbound',$3,$4,$5,$6, now())`,
        [comm.subcontractor_id, comm.opportunity_id, "Re: outreach", r.snippet, r.threadId, r.messageId]
      );
      await query(`update communications set replied_at = now() where id = $1`, [comm.id]);
      await query(
        `update opportunity_subs set outreach_state='responsive', responded_at=now()
          where opportunity_id=$1 and subcontractor_id=$2`,
        [comm.opportunity_id, comm.subcontractor_id]
      );
      enqueued.push({
        agent: "call-prep",
        payload: {
          opportunityId: comm.opportunity_id,
          subcontractorId: comm.subcontractor_id,
          ...(mentionedPrice != null ? { emailMentionedPrice: mentionedPrice } : {}),
        },
      });

      // Tell the operator exactly what happened and what changed.
      const priceNote =
        mentionedPrice != null
          ? ` Their email mentions $${mentionedPrice.toLocaleString()}, confirm it on the call.`
          : "";
      await logAgent({
        agent: "reply-poll",
        action: "reply-received",
        opportunityId: comm.opportunity_id,
        subcontractorId: comm.subcontractor_id,
        level: "success",
        message: `${comm.company_name} replied about "${comm.opportunity_title ?? "an opportunity"}". Marked responsive; their reply is saved on the record and a call card is being prepared for Today.${priceNote}`,
        reasoning: `Reply snippet: ${r.snippet.slice(0, 300)}`,
      });
      notifyLines.push(
        `<li><strong>${comm.company_name}</strong> replied about &ldquo;${comm.opportunity_title ?? "an opportunity"}&rdquo;.` +
          `${mentionedPrice != null ? ` Mentions <strong>$${mentionedPrice.toLocaleString()}</strong>.` : ""}` +
          ` Updated: marked responsive, reply saved, call card queued.` +
          `<br/><span style="color:#5D6561">&ldquo;${r.snippet.slice(0, 200)}&rdquo;</span></li>`
      );
    }

    // One notification email per poll (not per reply), best-effort: silently
    // skipped when Resend isn't configured; Today + the log still surface it.
    if (notifyLines.length > 0 && email.enabled() && config.resend.digestTo) {
      await email
        .send({
          to: config.resend.digestTo,
          subject: `BROSTCO: ${notifyLines.length} subcontractor repl${notifyLines.length === 1 ? "y" : "ies"} received`,
          html: `<p>Replies just came in. Each sub is marked responsive and has a call card on Today:</p><ul>${notifyLines.join("")}</ul><p>Open Today to start the calls.</p>`,
        })
        .catch(() => undefined);
    }

    return {
      ok: true,
      summary: `Polled replies: ${matched} matched; statuses updated, Call Prep triggered, operator notified.`,
      enqueued,
    };
  },
};
