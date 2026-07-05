/**
 * Maintenance jobs — not part of the 13-agent roster, but the plumbing that
 * keeps time-based workflows moving:
 *   - outreach-followup : send the automated 48-hour follow-up (spec step 6)
 *   - review-expiry-sweep : auto-dismiss review-tier items after the timer (spec)
 *   - reply-poll : detect sub replies via Gmail, mark responsive, trigger Call Prep
 */
import { query, queryOne } from "../db";
import { gmail } from "../integrations/gmail";
import { logAgent } from "../logger";
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
      const html = `<p>Just following up on my note below — happy to answer any questions or set up a quick call.</p><hr/>${(row.body ?? "").replace(/\n/g, "<br/>")}`;
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

export const stalledPipelineSweep: AgentDefinition = {
  name: "stalled-pipeline-sweep",
  label: "Stalled Pipeline Sweep",
  description:
    "Flags opportunities stuck mid-pipeline (no sub responded, or every candidate failed verification) for human review so they can't silently die.",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    // Opportunities that entered sub research or outreach and made no forward
    // progress within the grace window (well past the 48h follow-up cycle) get
    // surfaced to the operator instead of stalling with no human_action flag.
    // Runs once per opp: flipping human_action_required=true excludes it next run.
    const stalled = await query<{ id: string; title: string | null; stage: string }>(
      `update opportunities
          set human_action_required = true,
              risk_flags = coalesce(risk_flags, '{}') || array['stalled_' || stage]
        where status = 'open' and human_action_required = false
          and stage in ('sub_research', 'outreach')
          and updated_at < now() - interval '4 days'
        returning id, title, stage`
    );
    for (const o of stalled) {
      await logAgent({
        agent: "stalled-pipeline-sweep",
        action: "flag-stalled",
        opportunityId: o.id,
        level: "warn",
        message: `Flagged stalled opportunity "${o.title ?? o.id}" (no progress in ${o.stage} for 4 days).`,
        reasoning:
          o.stage === "outreach"
            ? "No subcontractor replied after outreach + follow-up. Needs operator attention (call subs directly or dismiss)."
            : "No subcontractor cleared verification for this opportunity. Needs operator attention (add subs or dismiss).",
      });
    }
    return { ok: true, summary: `Flagged ${stalled.length} stalled opportunit${stalled.length === 1 ? "y" : "ies"} for review.` };
  },
};

export const replyPoll: AgentDefinition = {
  name: "reply-poll",
  label: "Reply Poller",
  description: "Detects subcontractor email replies and triggers Call Prep.",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    if (!(await gmail.isConnected())) {
      return { ok: true, summary: "Gmail not connected — reply polling skipped." };
    }
    const sinceSec = Math.floor(Date.now() / 1000) - 3600; // last hour
    const { replies, disabled } = await gmail.fetchReplies(sinceSec);
    if (disabled) return { ok: true, summary: "Gmail disabled — reply polling skipped." };

    const enqueued: AgentResult["enqueued"] = [];
    let matched = 0;
    for (const r of replies) {
      // Match reply to an outbound communication by thread id, else by sender email.
      const fromEmail = (r.from.match(/<([^>]+)>/)?.[1] ?? r.from).toLowerCase().trim();
      const comm = await queryOne<{ id: string; subcontractor_id: string; opportunity_id: string }>(
        `select c.id, c.subcontractor_id, c.opportunity_id
           from communications c
           join subcontractors s on s.id = c.subcontractor_id
          where (c.gmail_thread_id = $1 or lower(s.email) = $2)
            and c.direction='outbound' and c.replied_at is null
          order by c.created_at desc limit 1`,
        [r.threadId, fromEmail]
      );
      if (!comm) continue;
      matched++;
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
        payload: { opportunityId: comm.opportunity_id, subcontractorId: comm.subcontractor_id },
      });
    }
    return {
      ok: true,
      summary: `Polled replies: ${matched} matched, triggered Call Prep for each.`,
      enqueued,
    };
  },
};
