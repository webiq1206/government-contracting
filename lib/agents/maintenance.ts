/**
 * Maintenance jobs, not part of the 13-agent roster, but the plumbing that
 * keeps time-based workflows moving:
 *   - outreach-followup : send the automated 48-hour follow-up (spec step 6)
 *   - review-expiry-sweep : auto-dismiss review-tier items after the timer (spec)
 *   - reply-poll : detect sub replies via Gmail, mark responsive, trigger Call Prep
 */
import { query, queryOne, transaction } from "../db";
import { gmail } from "../integrations/gmail";
import { sendOutreachEmail } from "../integrations/email-transport";
import { captureReply, matchInboundReply } from "../reply-capture";
import { sms } from "../integrations/twilio";
import { systemMail } from "../integrations/system-mail";
import { config } from "../config";
import { logAgent } from "../logger";
import { runWithOrg, LEGACY_ORG_ID } from "../tenant-context";

/**
 * Active organization ids for a cron sweep that must run per tenant. Falls
 * back to the founding org so a pre-migration single-tenant install still
 * sweeps. Every unscoped sweep uses this so no statement spans tenants.
 */
async function activeOrgIds(): Promise<string[]> {
  const orgs = await listActiveOrganizations().catch(() => []);
  return orgs.length ? orgs.map((o) => o.id) : [LEGACY_ORG_ID];
}
import { listActiveOrganizations } from "../organizations";
import {
  applyOutcomeToSolicitation,
  recordReplyEvent,
  blockingGaps,
  OUTCOME_LABEL,
} from "../domain/reply-outcome";
import { requestClarification, describeGap } from "../domain/reply-clarify";
import { readReplyAttachments, combineReplyText } from "../domain/reply-attachments";
import { advanceIfQuotesComplete, closeIfSubsExhausted } from "../domain/advance-stage";
import { STALL_HOURS, STAGE_AGENT, STALL_REASONING } from "../domain/journey";
import { areCallsEnabled, getAutomationRules } from "../app-settings";
import { enqueue } from "../queue";
import { sendPendingApproved, sendFollowUps } from "../backlink-send";
import { getProfileJson } from "../ai/companyProfile";
import { outreachDisplayName } from "../domain/solicitation-completeness";
import { scrubInternalFailureCopy } from "../domain/outreach-email";
import { scrubGovtContacts } from "../integrations/scrub-contacts";
import {
  renderTemplate,
  formatDeadlineLabel,
  plainToHtml,
} from "../domain/template-render";
import type { AgentDefinition } from "./types";
import type { AgentResult } from "../types";

export const outreachFollowup: AgentDefinition = {
  name: "outreach-followup",
  label: "Outreach Follow-up",
  description: "Sends the automated 48-hour follow-up to non-responsive subcontractors.",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    /**
     * One sweep per organization.
     *
     * This is a cron with no payload, so nothing set a tenant context and the
     * due list was selected across every org while the template, profile, and
     * mailbox were resolved once, from the founding org. A customer's
     * follow-up therefore went out through our inbox, over our name and
     * phone number, against our trial quota. Resolve the organizations, then
     * do each one's sweep inside its own context.
     */
    const orgs = await listActiveOrganizations().catch(() => []);
    let sentTotal = 0;
    let dueTotal = 0;
    let lastCalls = 0;
    for (const org of orgs) {
      const res = await runWithOrg(org.id, () => followUpForOrg(org.id));
      sentTotal += res.sent;
      dueTotal += res.due;
      lastCalls += await runWithOrg(org.id, () => lastCallForOrg(org.id)).catch(() => 0);
    }
    return {
      ok: true,
      summary: `Sent ${sentTotal} follow-up(s) of ${dueTotal} due${
        lastCalls > 0 ? `, plus ${lastCalls} last-call nudge(s) before bid deadlines` : ""
      }.`,
    };
  },
};

/**
 * The deadline-driven LAST follow-up.
 *
 * The 48-hour follow-up is polite persistence; this one is honesty about
 * time. When the bid is due within four days and a trade is still unpriced,
 * every sub who was approached for it and went quiet gets one final, short
 * note saying when the door closes. One per sub per solicitation, ever:
 * the dedupe is a communications row with meta.kind = 'final_nudge', so
 * re-runs and restarts cannot turn a nudge into nagging.
 *
 * This exists because "waiting on quotes" used to end in silence: one
 * follow-up, then the unresponsive mark, then nothing until the operator
 * noticed the deadline themselves.
 */
async function lastCallForOrg(orgId: string): Promise<number> {
  const due = await query<{
    opportunity_id: string;
    subcontractor_id: string;
    trade: string | null;
    email: string | null;
    owner_name: string | null;
    deadline: string | null;
  }>(
    `select os.opportunity_id, os.subcontractor_id, os.trade,
            s.email, s.owner_name, o.deadline
       from opportunity_subs os
       join opportunities o on o.id = os.opportunity_id
       join subcontractors s on s.id = os.subcontractor_id
      where o.org_id = $1
        and o.status = 'open'
        and o.deadline is not null
        and o.deadline > now()
        and o.deadline <= now() + interval '4 days'
        and os.outreach_state in ('followed_up', 'unresponsive')
        and s.email is not null and s.email_verified
        -- the trade is still unpriced; a priced trade needs no more chasing
        and not exists (
              select 1 from quotes q
               where q.opportunity_id = os.opportunity_id
                 and coalesce(q.trade, '') = coalesce(os.trade, '')
                 and q.quote_amount is not null
            )
        -- one last call per sub per solicitation, ever
        and not exists (
              select 1 from communications c
               where c.opportunity_id = os.opportunity_id
                 and c.subcontractor_id = os.subcontractor_id
                 and c.direction = 'outbound'
                 and c.meta->>'kind' = 'final_nudge'
            )
      limit 25`,
    [orgId]
  ).catch(() => []);
  if (due.length === 0) return 0;

  const profile = await getProfileJson().catch(() => null);
  const senderName = profile ? outreachDisplayName(profile) : "";
  let sent = 0;

  for (const row of due) {
    const first = (row.owner_name ?? "").trim().split(/\s+/)[0] || "there";
    const tradeClean = scrubGovtContacts(row.trade ?? "").sanitised.trim();
    const when = formatDeadlineLabel(row.deadline);
    const subject = tradeClean
      ? `Last call: ${tradeClean} pricing needed by ${when}`
      : `Last call: pricing needed by ${when}`;
    const lines = [
      `Hi ${first},`,
      "",
      `Quick heads up: we finalize our numbers on ${when}, so today is the last day I can take ${
        tradeClean ? `a ${tradeClean} price` : "a price"
      } for the job I emailed you about.`,
      "",
      "If you can still quote it, just reply with your number. If not, no problem at all, a quick \"we'll pass\" lets me close the file.",
      "",
      "Thanks either way,",
      ...(senderName ? [senderName] : []),
    ];
    const text = lines.join("\n");
    const res = await sendOutreachEmail({
      to: row.email!,
      subject,
      html: plainToHtml(text),
      text,
      orgId,
    });
    if (res.disabled || res.error) {
      // This is the one chance to get a price before the deadline; a silent
      // skip here means the bid goes out short a trade with no explanation.
      await query(
        `update opportunities set human_action_required = true where id = $1`,
        [row.opportunity_id]
      );
      await logAgent({
        agent: "outreach-followup",
        action: "last-call",
        level: "error",
        status: "error",
        opportunityId: row.opportunity_id,
        subcontractorId: row.subcontractor_id,
        message: `The last-call nudge before the bid deadline could not be sent (${res.error ?? "no transport available"}). Their price is still missing; reach them another way or price without them.`,
      });
      continue;
    }
    sent++;
    await query(
      `insert into communications
         (subcontractor_id, opportunity_id, channel, direction, subject, body,
          gmail_message_id, provider, recipient_email, meta)
       values ($1,$2,'email','outbound',$3,$4,$5,$6,$7,$8::jsonb)`,
      [
        row.subcontractor_id,
        row.opportunity_id,
        subject,
        text,
        res.messageId ?? null,
        res.provider,
        row.email,
        JSON.stringify({ kind: "final_nudge", trade: row.trade ?? null }),
      ]
    );
    await logAgent({
      agent: "outreach-followup",
      action: "last-call",
      opportunityId: row.opportunity_id,
      subcontractorId: row.subcontractor_id,
      level: "info",
      message: `Bid deadline is ${when} and their ${tradeClean || "trade"} price is still out, so they got one final nudge. No further emails will be sent for this solicitation.`,
    });
  }
  return sent;
}

async function followUpForOrg(orgId: string): Promise<{ sent: number; due: number }> {
  // Template resolution is org-aware (own copy, else platform default) so a
  // follow-up never goes out with another tenant's wording.
  const { activeTemplate } = await import("../domain/template-store");
  const [tmpl, profile] = await Promise.all([
    activeTemplate("template_2_followup", orgId),
    getProfileJson(),
  ]);

  const due = await query<{
    id: string;
    subcontractor_id: string;
    opportunity_id: string;
    tracking_id: string | null;
    email: string | null;
    email_verified: boolean;
    sub_owner_name: string | null;
    // trade comes from opportunity_subs (not opportunities); LATERAL picks the
    // most-recently-added trade for this sub/opp pair when multiple exist.
    trade: string | null;
    location_state: string | null;
    deadline: string | null;
    // Threading: what the follow-up must attach itself to.
    orig_subject: string | null;
    gmail_thread_id: string | null;
    rfc822_message_id: string | null;
  }>(
    `select c.id, c.subcontractor_id, c.opportunity_id, c.tracking_id,
            s.email, s.email_verified, s.owner_name as sub_owner_name,
            os.trade, o.location_state, o.deadline,
            c.subject as orig_subject, c.gmail_thread_id, c.rfc822_message_id
       from communications c
       join subcontractors s on s.id = c.subcontractor_id
       left join opportunities o on o.id = c.opportunity_id
       left join lateral (
         select trade from opportunity_subs
         where opportunity_id = c.opportunity_id
           and subcontractor_id = c.subcontractor_id
         order by created_at desc
         limit 1
       ) os on true
      where c.org_id = $1
        and c.channel='email' and c.direction='outbound'
        and c.follow_up_at is not null and c.follow_up_at <= now()
        and c.replied_at is null
      limit 50`,
    [orgId]
  );

  const senderName = profile ? outreachDisplayName(profile) : "";
  const companyName = profile?.legal_name ?? "";
  const phone = profile?.phone ?? "";

  let sent = 0;
  for (const row of due) {
    // Consume the follow-up marker up front so a crash mid-loop cannot spam;
    // it is RESTORED below when the send fails with a retryable error.
    await query(`update communications set follow_up_at = null where id = $1`, [row.id]);
    if (!row.email || !row.email_verified) continue;

    // Build the sub greeting the same way the initial outreach agent does.
    const ownerFirst = (() => {
      const raw = (row.sub_owner_name ?? "").trim();
      if (!raw) return "there";
      return raw.split(/\s+/)[0] || "there";
    })();

    let subject: string;
    let html: string;

    if (tmpl) {
      const vars: Record<string, string> = {
        owner_name: ownerFirst,
        sender_name: senderName,
        company_name: companyName,
        phone,
        // Solicitation-derived, and reachable from an operator-edited
        // template via {{trade}} — scrub on the way in, never after render.
        trade: scrubGovtContacts(row.trade ?? "").sanitised,
        location_state: row.location_state ?? "",
        deadline: formatDeadlineLabel(row.deadline),
        // Tokens rarely used in the follow-up but available for custom templates.
        opportunity_title: "",
        solicitation_number: "",
        agency: "",
        scope_summary: "",
        questions: "",
      };
      // Never scrub the assembled email — it would censor the operator's own
      // phone number. The follow-up carries no solicitation-derived text.
      const rawSubject = renderTemplate(tmpl.subject ?? "Re: our quote request", vars);
      const rawBody = scrubInternalFailureCopy(renderTemplate(tmpl.body, vars));
      subject = rawSubject || "Re: our quote request";
      html = plainToHtml(rawBody);
    } else {
      // Fallback: template not found — use a minimal safe copy.
      subject = "Following up on our quote request";
      html = `<p>Hi ${ownerFirst},</p><p>Just following up on my previous email. Happy to answer any questions or set up a quick call.</p><p>${senderName}</p>`;
    }

    // Named rather than inferred: this decides whose mailbox sends, whose
    // identity is on the From line, and whose quota is charged.
    /**
     * A follow-up belongs ON the original thread, not beside it.
     *
     * Sent standalone, it reached the subcontractor as a fresh, context-free
     * email: none of the scope, the deadline or the attachments they were
     * being asked to price sat above it, and it reads far more like cold mail
     * than the third message in a conversation -- which costs replies and
     * inbox placement both.
     *
     * Threading needs both halves. `threadId` groups it in OUR mailbox (what
     * the in-app conversation view reads); `In-Reply-To` is what the
     * RECIPIENT's client threads on, and Gmail additionally requires the
     * subject to match the thread it is joining, so when we have a thread the
     * original subject wins over the template's.
     */
    const threadSubject = row.orig_subject?.trim()
      ? /^re:/i.test(row.orig_subject.trim())
        ? row.orig_subject.trim()
        : `Re: ${row.orig_subject.trim()}`
      : null;
    if (row.gmail_thread_id && threadSubject) subject = threadSubject;

    const res = await sendOutreachEmail({
      to: row.email,
      subject,
      html,
      trackingId: row.tracking_id ?? undefined,
      orgId,
      threadId: row.gmail_thread_id ?? undefined,
      inReplyTo: row.rfc822_message_id ?? undefined,
    });
    if (!res.disabled && !res.error) {
      await query(
        // gmail_thread_id + rfc822_message_id are carried forward so a SECOND
        // follow-up chains onto this one rather than restarting the thread.
        `insert into communications (subcontractor_id, opportunity_id, channel, direction, subject, body, gmail_message_id, provider, meta, gmail_thread_id, rfc822_message_id)
         values ($1,$2,'email','outbound',$3,$4,$5,$6,$7::jsonb,$8,$9)`,
        [
          row.subcontractor_id,
          row.opportunity_id,
          subject,
          html,
          res.messageId ?? null,
          res.provider,
          // Same reason the initial outreach stamps it: a reply to THIS email
          // must land its outcome on this trade line, not on every trade the
          // sub was approached for.
          JSON.stringify(row.trade ? { kind: "followup", trade: row.trade } : { kind: "followup" }),
          res.threadId ?? row.gmail_thread_id ?? null,
          res.rfc822MessageId ?? null,
        ]
      );
      // Reflect the follow-up on the pairing + roster so Today / opp / sub
      // UIs show "Followed up" instead of permanently "Email sent".
      await query(
        `update opportunity_subs
            set outreach_state = 'followed_up'
          where opportunity_id = $1 and subcontractor_id = $2
            and outreach_state in ('sent', 'draft', 'email_unverified')`,
        [row.opportunity_id, row.subcontractor_id]
      );
      await query(`update subcontractors set last_contacted = now() where id = $1`, [
        row.subcontractor_id,
      ]);
      sent++;
    } else if (res.blocked) {
      // Content was refused; a retry would refuse the same content, so the
      // marker stays consumed and a human is flagged instead.
      if (row.opportunity_id) {
        await query(
          `update opportunities set human_action_required = true where id = $1`,
          [row.opportunity_id]
        );
      }
      await logAgent({
        agent: "outreach-followup",
        action: "send",
        level: "error",
        status: "error",
        opportunityId: row.opportunity_id,
        subcontractorId: row.subcontractor_id,
        message: `Held follow-up email, nothing was sent. ${res.error}`,
      });
    } else {
      // Transport failure (Gmail error or no transport). This branch used to
      // fall through silently AFTER the marker was consumed, which quietly
      // deleted the follow-up: the sub was later marked unresponsive as if
      // they had ignored an email that never went out. Restore the marker so
      // the next sweep retries, and say what happened.
      await query(
        `update communications set follow_up_at = now() + interval '15 minutes' where id = $1`,
        [row.id]
      );
      await logAgent({
        agent: "outreach-followup",
        action: "send",
        level: "error",
        status: "error",
        opportunityId: row.opportunity_id,
        subcontractorId: row.subcontractor_id,
        message: `Follow-up email could not be sent (${res.error ?? "no transport available"}). It will be retried on the next sweep.`,
      });
    }
  }
  return { sent, due: due.length };
}

/**
 * OUTREACH RECOVERY, every 30 minutes.
 *
 * An initial outreach email that could not send (no inbox connected, a
 * revoked Google grant, a transient Gmail failure) is stored as a draft or
 * marked send_failed, the opportunity is flagged, and there it sat: nothing
 * ever retried it, so fixing the inbox fixed the future while the backlog
 * stayed silent forever.
 *
 * This sweep is the other half of the fix. Once the organization's inbox is
 * back, every stuck pairing on a still-open opportunity is re-enqueued
 * through the normal outreach agent, which rebuilds the email from scratch
 * (fresh attachments, current template, current profile) and re-runs every
 * completeness and safety check. Singleton keys make re-runs within the
 * window harmless.
 *
 * Deliberately does NOT touch email_unverified or no_email: those are not
 * transport failures, and retrying them would loop.
 */
export const outreachRecoverySweep: AgentDefinition = {
  name: "outreach-recovery-sweep",
  label: "Outreach Recovery",
  description:
    "Re-sends initial outreach that failed or was stored as a draft, once the organization's inbox is connected again.",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    const orgs = await listActiveOrganizations().catch(() => []);
    const enqueued: AgentResult["enqueued"] = [];
    let recovered = 0;
    let waiting = 0;

    for (const org of orgs) {
      await runWithOrg(org.id, async () => {
        const stuck = await query<{
          opportunity_id: string;
          subcontractor_id: string;
          trade: string | null;
          outreach_state: string;
        }>(
          `select os.opportunity_id, os.subcontractor_id, os.trade, os.outreach_state
             from opportunity_subs os
             join opportunities o on o.id = os.opportunity_id
            where o.org_id = $1 and o.status = 'open'
              and os.outreach_state in ('draft', 'send_failed')
            order by os.created_at asc
            limit 25`,
          [org.id]
        ).catch(() => []);
        if (stuck.length === 0) return;

        // Only retry when a send can actually succeed now. Retrying into a
        // still-broken transport would mint one more draft row per sweep.
        if (!(await gmail.isConnected(org.id))) {
          waiting += stuck.length;
          return;
        }

        for (const row of stuck) {
          recovered++;
          enqueued.push({
            agent: "outreach",
            payload: {
              opportunityId: row.opportunity_id,
              subcontractorId: row.subcontractor_id,
              trade: row.trade ?? "",
            },
            opts: {
              singletonKey: `outreach-recover:${row.opportunity_id}:${row.subcontractor_id}:${row.trade ?? ""}`,
              singletonSeconds: 6 * 3600,
            },
          });
        }
        await logAgent({
          agent: "outreach-recovery-sweep",
          action: "recover",
          level: "info",
          message: `The inbox is connected again, so ${stuck.length} outreach email(s) that never went out are being re-sent through the normal outreach checks.`,
        });
      });
    }

    return {
      ok: true,
      summary:
        recovered > 0
          ? `Re-queued ${recovered} stuck outreach email(s) now that sending works again.`
          : waiting > 0
            ? `${waiting} outreach email(s) still waiting for an inbox connection.`
            : "No stuck outreach emails.",
      enqueued,
    };
  },
};

export const reviewExpirySweep: AgentDefinition = {

  name: "review-expiry-sweep",
  label: "Review Expiry Sweep",
  description: "Auto-dismisses review-tier opportunities not actioned within the timer.",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    // Per organization: the UPDATE and its audit log both stay inside one
    // tenant. A single platform-wide statement would touch every tenant's
    // opportunities at once and log each auto-dismiss with no org, so the
    // customer whose opportunity vanished would never see why in their own
    // Automation Log.
    const orgs = await activeOrgIds();
    let total = 0;
    for (const orgId of orgs) {
      const expired = await runWithOrg(orgId, () =>
        query<{ id: string; title: string | null }>(
          `update opportunities
              set stage='dismissed', status='archived', human_action_required=false
            where org_id = $1 and tier='review' and human_action_required=true
              and review_expires_at is not null and review_expires_at <= now()
            returning id, title`,
          [orgId]
        )
      );
      for (const o of expired) {
        await runWithOrg(orgId, () =>
          logAgent({
            agent: "review-expiry-sweep",
            action: "auto-dismiss",
            opportunityId: o.id,
            level: "info",
            message: `Auto-dismissed review-tier item "${o.title ?? o.id}" (timer expired).`,
            reasoning: "Review-tier opportunities auto-dismiss if not actioned within the configured window.",
          })
        );
      }
      total += expired.length;
    }
    return { ok: true, summary: `Auto-dismissed ${total} expired review item(s).` };
  },
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
    // Per organization, so no single statement flags or rescues across
    // tenants and every audit-log line lands in the owning tenant's log.
    let rescued = 0;
    const stalled: { id: string; title: string | null; stage: string; hours: number; orgId: string }[] = [];
    for (const sweepOrgId of await activeOrgIds()) {
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
        const rescuable = await runWithOrg(sweepOrgId, () =>
          query<{ id: string; title: string | null }>(
          `update opportunities
              set risk_flags = coalesce(risk_flags, '{}') || array[$3::text]
            where org_id = $4 and status = 'open' and human_action_required = false
              and stage = $1
              and updated_at < now() - make_interval(hours => $2)
              and not ($3 = any(coalesce(risk_flags, '{}')))
              ${bidGuard}
            returning id, title`,
          [stage, hours, retryMarker, sweepOrgId]
        ));
        for (const o of rescuable) {
          // The strike-1 marker was already written by the UPDATE above. If
          // the enqueue fails, that marker is a lie (no retry is running), so
          // roll it back and say so; otherwise the record would skip straight
          // to strike 2, or sit forever, while the log claimed recovery ran.
          let queued = true;
          await enqueue(agent, { opportunityId: o.id, trigger: "rescue" }).catch(async (e) => {
            queued = false;
            await query(
              `update opportunities
                  set risk_flags = array_remove(coalesce(risk_flags,'{}'), $2)
                where id = $1`,
              [o.id, retryMarker]
            ).catch(() => {});
            await runWithOrg(sweepOrgId, () =>
              logAgent({
                agent: "stalled-pipeline-sweep",
                action: "auto-retry",
                opportunityId: o.id,
                level: "error",
                status: "error",
                message: `Could not queue the automatic retry for "${o.title ?? o.id}" (${(e as Error).message}). It stays marked stuck and will be retried on the next sweep.`,
              })
            );
          });
          if (!queued) continue;
          rescued++;
          await runWithOrg(sweepOrgId, () =>
            logAgent({
              agent: "stalled-pipeline-sweep",
              action: "auto-retry",
              opportunityId: o.id,
              level: "info",
              message: `"${o.title ?? o.id}" sat in ${stage.replace(/_/g, " ")} past its ${hours}h window; re-running ${agent} automatically. You'll only be asked to step in if this retry doesn't move it.`,
            })
          );
        }
      }

      // Strike 2: still stuck after a rescue (or no agent to rescue with) ->
      // the operator's judgment is genuinely needed.
      const rows = await runWithOrg(sweepOrgId, () =>
        query<{ id: string; title: string | null; stage: string }>(
        `update opportunities
            set human_action_required = true,
                risk_flags = coalesce(risk_flags, '{}') || array['stalled_' || stage]
          where org_id = $5 and status = 'open' and human_action_required = false
            and stage = $1
            and updated_at < now() - make_interval(hours => $2)
            and ($3::text is null or $4 = any(coalesce(risk_flags, '{}')))
            ${bidGuard}
          returning id, title, stage`,
        [stage, hours, agent ?? null, `auto_retried_${stage}`, sweepOrgId]
      ));
      stalled.push(...rows.map((r) => ({ ...r, hours, orgId: sweepOrgId })));
    }
    }
    for (const o of stalled) {
      await runWithOrg(o.orgId, () =>
        logAgent({
          agent: "stalled-pipeline-sweep",
          action: "flag-stalled",
          opportunityId: o.id,
          level: "warn",
          message: `Flagged stalled opportunity "${o.title ?? o.id}" (no progress in ${o.stage.replace(/_/g, " ")} for over ${o.hours}h, automatic retry did not move it).`,
          reasoning: STALL_REASONING[o.stage] ?? "No progress beyond the stage's expected window.",
        })
      );
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
    // Per organization. The old single statement flagged every tenant's
    // opportunities at once and, worse, sms.alert resolves the alert NUMBER
    // from the ambient org, so every tenant's opportunity TITLES were texted
    // to the founding org's phone. Each org's flag, log, and SMS now stay
    // inside that org.
    const orgs = await activeOrgIds();
    let flagged = 0;
    for (const orgId of orgs) {
    // Flag once per opportunity: the deadline_soon risk flag excludes it from
    // the next sweep so the operator isn't re-alerted every 6 hours.
    const urgent = await runWithOrg(orgId, () =>
      query<{ id: string; title: string | null; deadline: string; stage: string }>(
      `update opportunities
          set human_action_required = true,
              risk_flags = coalesce(risk_flags, '{}') || array['deadline_soon']
        where org_id = $1 and status = 'open'
          and stage in ('analysis','sub_research','outreach','call_queue','quote_entry','bid_building')
          and deadline is not null
          and deadline > now()
          and deadline <= now() + interval '48 hours'
          and not ('deadline_soon' = any(coalesce(risk_flags, '{}')))
        returning id, title, deadline, stage`,
      [orgId]
    ));
    flagged += urgent.length;
    for (const o of urgent) {
      const hoursLeft = Math.max(
        0,
        (new Date(o.deadline).getTime() - Date.now()) / 3_600_000
      ).toFixed(0);
      const msg = `Bid due in ${hoursLeft}h: "${o.title ?? o.id}" is still in ${o.stage.replace(/_/g, " ")}. Submit or dismiss before the deadline.`;
      await runWithOrg(orgId, () =>
        logAgent({
          agent: "deadline-monitor",
          action: "deadline-warning",
          opportunityId: o.id,
          level: "warn",
          message: msg,
        })
      );
      // Best-effort SMS to THIS org's configured number; skipped when unset.
      await runWithOrg(orgId, () => sms.alert(msg)).catch(() => undefined);
    }
    }
    return {
      ok: true,
      summary: `Deadline check: ${flagged} opportunit${flagged === 1 ? "y" : "ies"} due within 48h flagged.`,
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
    //
    // Swept per organization, and with a 200 limit per org rather than 200
    // across the platform: unscoped, one tenant with a large backlog took the
    // whole budget and the customers behind it were never recovered at all.
    // Nothing about the org travels with the job (the queue carries only the
    // payload), so the scoring engine derives it from the opportunity.
    const orgs = await listActiveOrganizations().catch(() => []);
    const unscored: { id: string; title: string | null }[] = [];
    for (const org of orgs) {
      const rows = await query<{ id: string; title: string | null }>(
        `select id, title from opportunities
          where org_id = $1
            and status='open' and stage in ('monitoring','scoring')
            and score is null
            and created_at < now() - interval '20 minutes'
          order by created_at asc
          limit 200`,
        [org.id]
      );
      unscored.push(...rows);
    }
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
    const orgs = await listActiveOrganizations().catch(() => []);
    let archived = 0;
    let deleted = 0;
    for (const org of orgs) {
      const res = await runWithOrg(org.id, () => expireForOrg(org.id));
      archived += res.archived;
      deleted += res.deleted;
    }
    return {
      ok: true,
      summary:
        `Archived ${archived} expired opportunit${archived === 1 ? "y" : "ies"}` +
        (deleted > 0 ? `; deleted ${deleted} unworkable notice(s).` : "."),
    };
  },
};

/**
 * One organization's expiry pass.
 *
 * Per org rather than platform-wide because this sweep deletes. The archive
 * step reaches the same rows either way, but the junk delete does not: run
 * unscoped it removes another customer's records under this run's log line,
 * with no org on the audit entry that would let them see it happened.
 */
async function expireForOrg(orgId: string): Promise<{ archived: number; deleted: number }> {
  {
    // A passed deadline with no submitted bid means the record can never be
    // won; it leaves the active pipeline (status=archived) so lists stay
    // clean, but keeps its stage and full history for reference. Submitted /
    // won / lost records are untouched — the agency decides those timelines.
    const expired = await query<{ id: string; title: string | null; stage: string; deadline: string }>(
      `update opportunities
          set status='archived', human_action_required=false,
              risk_flags = (select array(select distinct unnest(coalesce(risk_flags,'{}') || array['expired'])))
        where org_id = $1
          and status='open'
          and stage not in ('submitted','won','lost')
          and deadline is not null and deadline < now()
        returning id, title, stage, deadline`,
      [orgId]
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
    // --- Delete unworkable junk outright. ---
    // A notice that is past due (or was auto-passed for insufficient lead
    // time) and that NOBODY ever touched is pure noise: it has no bid, no
    // contract, no quote, no call card, no communication, no note, and no
    // pending human action. Keeping thousands of those forever just buries
    // the real records. Anything with a shred of actual work attached is
    // archived instead, never deleted, because that is business history.
    //
    // The WHERE clause is passed into purgeOpportunitiesWithBlobs so it is
    // re-evaluated atomically inside the DELETE — any bid, quote, or message
    // added after candidate selection prevents that row from being deleted.
    const JUNK_WHERE = `
      (
        (o.deadline is not null and o.deadline < now())
        or 'below_min_lead_time' = any(coalesce(o.risk_flags, '{}'))
        or 'deadline_too_soon'   = any(coalesce(o.risk_flags, '{}'))
      )
      and o.stage in ('monitoring','scoring','dismissed')
      and o.human_action_required = false
      and coalesce(o.notes, '') = ''
      and not exists (select 1 from bids b           where b.opportunity_id  = o.id)
      and not exists (select 1 from contracts c      where c.opportunity_id  = o.id)
      and not exists (select 1 from quotes q         where q.opportunity_id  = o.id)
      and not exists (select 1 from communications m where m.opportunity_id  = o.id)
      and not exists (select 1 from call_cards cc    where cc.opportunity_id = o.id)`;

    let deletedCount = 0;
    const junkResult = await purgeOpportunitiesWithBlobs(orgId, JUNK_WHERE, []);
    deletedCount = junkResult.deleted;
    if (deletedCount > 0) {
      await logAgent({
        agent: "expired-opportunity-sweep",
        action: "delete-unworkable",
        level: "info",
        message:
          `Deleted ${deletedCount} unworkable notice(s) (past deadline or below min lead time, ` +
          `never worked); ${junkResult.blobsDeleted} orphaned file blob(s) freed.`,
        reasoning:
          "Keeps the database and search clean. Anything with real work attached is archived instead, never deleted.",
      });
    }

    return { archived: expired.length, deleted: deletedCount };
  }
}

// ---------------------------------------------------------------------------
// Shared helper: transactional opportunity + orphaned blob deletion
// ---------------------------------------------------------------------------

type PurgeResult = { deleted: number; blobsDeleted: number; bytesFreed: number };

/**
 * Atomically purge opportunities that satisfy `whereSql` and clean up their
 * file blobs — all inside a single database transaction:
 *
 *  1. Snapshot document storage paths for matching opportunities, locking the
 *     opportunity rows (`FOR UPDATE OF o`) to serialise concurrent sweeps.
 *  2. DELETE opportunities WHERE the **full** eligibility predicate is
 *     re-evaluated at delete time. Under PostgreSQL's default READ COMMITTED
 *     isolation each DML statement takes a fresh snapshot, so any bid, quote,
 *     or other guard row inserted after step 1 will be visible here and will
 *     prevent that opportunity from being deleted — closing the race.
 *  3. Delete file_blobs whose path is not referenced by any remaining document
 *     (shared-path safe: if another opportunity's document still points to the
 *     same path the blob is kept).
 *
 * The organization is a separate argument rather than something each caller
 * writes into its own `whereSql`, because this function deletes: a caller that
 * forgets the filter erases another customer's records, and there is nothing
 * to recover them from. Having it here means the filter cannot be forgotten.
 *
 * @param orgId     The only organization whose records this call may touch.
 * @param whereSql  Full WHERE clause body (no "WHERE" keyword) referencing
 *                  the opportunity alias "o". Uses $2, $3, … for params;
 *                  $1 is the organization.
 * @param params    Positional parameters matching `whereSql`, starting at $2.
 */
async function purgeOpportunitiesWithBlobs(
  orgId: string,
  whereSql: string,
  params: unknown[]
): Promise<PurgeResult> {
  const args = [orgId, ...params];
  return transaction(async (client) => {
    // 1. Lock candidate opportunity rows to serialise concurrent sweeps.
    //    FOR UPDATE requires no DISTINCT, so we lock by ID then get paths
    //    separately. Under PostgreSQL READ COMMITTED the DELETE in step 3
    //    takes its own snapshot, re-evaluating all predicates — any bid or
    //    quote inserted after this lock is acquired will be visible there.
    const lockRows = await client.query<{ id: string }>(
      `select o.id from opportunities o
        where o.org_id = $1 and (${whereSql}) for update of o`,
      args
    );
    const candidateIds = lockRows.rows.map((r) => r.id);

    if (candidateIds.length === 0) {
      return { deleted: 0, blobsDeleted: 0, bytesFreed: 0 };
    }

    // 2. Snapshot document storage paths for those IDs before cascade removes them.
    const pathRows = await client.query<{ storage_path: string }>(
      `select distinct d.storage_path
         from documents d
        where d.org_id = $2
          and d.opportunity_id = any($1)
          and d.storage_path is not null`,
      [candidateIds, orgId]
    );
    const candidatePaths = pathRows.rows.map((r) => r.storage_path);

    // 3. Delete with the full predicate re-evaluated at this statement's
    //    snapshot so any concurrent bid/quote insertion prevents deletion of
    //    that row. No id-filter needed: the FOR UPDATE lock in step 1 prevents
    //    concurrent sweeps from selecting the same rows; the predicate already
    //    carries all safety guards and any new violation (bid added after lock)
    //    is visible to this statement's fresh snapshot.
    const delRows = await client.query<{ id: string }>(
      `delete from opportunities o
        where o.org_id = $1 and (${whereSql}) returning o.id`,
      args
    );
    const deleted = delRows.rowCount ?? 0;

    // 3. Delete orphaned blobs — only those with no remaining document reference.
    //    Cascade already removed our doc rows; paths still referenced by other
    //    documents belong to surviving records and must not be touched.
    //
    //    The reference check is deliberately NOT scoped to this org, and must
    //    stay that way: blob paths are content-addressed and shared, so an org
    //    filter here would delete bytes another customer's document still
    //    points at, leaving them with a document that cannot be opened.
    let blobsDeleted = 0;
    let bytesFreed = 0;
    if (candidatePaths.length > 0) {
      const bytesRow = await client.query<{ total: string }>(
        `select coalesce(sum(octet_length(bytes)), 0)::text as total
           from file_blobs
          where path = any($1)
            and not exists (
              select 1 from documents d2 where d2.storage_path = file_blobs.path
            )`,
        [candidatePaths]
      );
      bytesFreed = parseInt(bytesRow.rows[0]?.total ?? "0", 10);

      const blobDel = await client.query(
        `delete from file_blobs
          where path = any($1)
            and not exists (
              select 1 from documents d2 where d2.storage_path = file_blobs.path
            )`,
        [candidatePaths]
      );
      blobsDeleted = blobDel.rowCount ?? 0;
    }

    return { deleted, blobsDeleted, bytesFreed };
  });
}

export const retentionSweep: AgentDefinition = {
  name: "retention-sweep",
  label: "Retention Sweep",
  description:
    "Permanently deletes archived opportunities past the configured retention period (default 30 days), only when they have no bids, contracts, or sub quotes. Also deletes orphaned file_blobs for those documents. Set retention to 0 in Settings to keep records forever.",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    /**
     * Retention is a per-organization setting, so the sweep has to be one too.
     *
     * getAutomationRules() reads app_settings under the current tenant, and
     * this cron set none: every org's archived records were purged on the
     * FOUNDING org's window. A customer who set retention to 0, meaning keep
     * my records forever, had them deleted on our schedule instead, and
     * deletion here is permanent.
     */
    const orgs = await listActiveOrganizations().catch(() => []);
    const summaries: string[] = [];
    for (const org of orgs) {
      const line = await runWithOrg(org.id, () => purgeRetentionForOrg(org.id));
      if (line) summaries.push(line);
    }
    return {
      ok: true,
      summary: summaries.length
        ? summaries.join(" | ")
        : "No archived records past any organization's retention window.",
    };
  },
};

/** One organization's retention purge, on that organization's own window. */
async function purgeRetentionForOrg(orgId: string): Promise<string | null> {
  const rules = await getAutomationRules();
  if (rules.retention_days <= 0) return null;

  // Eligibility: archived, past the retention window, no bids/contracts/quotes.
  // The WHERE clause is passed into purgeOpportunitiesWithBlobs so it is
  // re-evaluated atomically inside the DELETE — preventing a bid or quote
  // inserted after candidate selection from being silently cascaded away.
  // $1 is the organization, so the window starts at $2.
  const RETENTION_WHERE = `
      o.status = 'archived'
      and coalesce(o.deadline, o.updated_at::date)::timestamptz
          < now() - make_interval(days => $2)
      and not exists (select 1 from bids      b where b.opportunity_id = o.id)
      and not exists (select 1 from contracts c where c.opportunity_id = o.id)
      and not exists (select 1 from quotes    q where q.opportunity_id = o.id)`;

  const { deleted, blobsDeleted, bytesFreed } = await purgeOpportunitiesWithBlobs(
    orgId,
    RETENTION_WHERE,
    [rules.retention_days]
  );

  if (deleted === 0) return null;

  const mbFreed = (bytesFreed / 1024 / 1024).toFixed(2);
  const summary =
    `Purged ${deleted} archived opportunit${deleted === 1 ? "y" : "ies"} ` +
    `(${rules.retention_days}-day window); ` +
    `${blobsDeleted} file blob(s) deleted, ${mbFreed} MB freed.`;

  await logAgent({
    agent: "retention-sweep",
    action: "purge-archived",
    level: "info",
    message: summary,
    reasoning:
      "Retention policy (Settings → Automation rules, default 30 days). " +
      "Records with bids, contracts, or sub quotes are always kept regardless of age. " +
      "File blobs are only deleted when no other document references the same path.",
  });

  return summary;
}

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
    // Prospects, drafts and the mailbox all belong to one customer, so this
    // sweep runs once per organization. Platform-wide it sent every tenant's
    // approved outreach from the founding org's inbox and matched replies
    // against every tenant's prospects at once.
    const orgs = await listActiveOrganizations().catch(() => []);
    let sent = 0;
    let followUps = 0;
    let errors = 0;
    let repliesMatched = 0;
    for (const org of orgs) {
      const res = await runWithOrg(org.id, () => backlinkSweepForOrg(org.id));
      sent += res.sent;
      followUps += res.followUps;
      errors += res.errors;
      repliesMatched += res.repliesMatched;
    }

    return {
      ok: true,
      summary: `Backlink outreach: ${sent} sent, ${followUps} follow-ups, ${repliesMatched} replies.${
        errors ? ` ${errors} errors.` : ""
      }`,
      data: { sent, followUps, errors, repliesMatched },
      humanActionRequired: repliesMatched > 0,
    };
  },
};

async function backlinkSweepForOrg(orgId: string): Promise<{
  sent: number;
  followUps: number;
  errors: number;
  repliesMatched: number;
}> {
  const send = await sendPendingApproved(orgId, 25);
  const followUp = await sendFollowUps(orgId, 25);

  // Reply detection for backlink outreach threads.
  let repliesMatched = 0;
  if (await gmail.isConnected(orgId)) {
    const sinceSec = Math.floor(Date.now() / 1000) - 3600;
    const { replies, disabled, error } = await gmail.fetchReplies(sinceSec, orgId);
    if (error) {
      await logAgent({
        agent: "backlink-outreach-sweep",
        action: "poll-failed",
        level: "error",
        message: `Could not read the inbox for backlink replies: ${error}`,
      });
    }
    if (!disabled && !error) {
      for (const r of replies) {
        const fromEmail = (r.from.match(/<([^>]+)>/)?.[1] ?? r.from).toLowerCase().trim();
        // Scoped for the same reason inbound subcontractor replies are: a
        // contact address is not unique to a tenant, so an unscoped match
        // marks another customer's outreach as answered.
        const hit = await queryOne<{ id: string }>(
          `select o.id from backlink_outreach o
             join backlink_prospects p on p.id = o.prospect_id
            where o.org_id = $3
              and (o.gmail_thread_id = $1 or lower(p.contact_email) = $2)
              and o.sent_at is not null and o.replied_at is null
            order by o.sent_at desc limit 1`,
          [r.threadId, fromEmail, orgId]
        );
        if (!hit) continue;
        repliesMatched++;
        await query(`update backlink_outreach set replied_at = now(), updated_at = now() where id = $1`, [
          hit.id,
        ]);
      }
    }
  }

  return { sent: send.sent, followUps: followUp.sent, errors: send.errors, repliesMatched };
}

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
    // Each tenant has their own inbox. Poll every connected one inside its own
    // org context: a single shared poll would read one customer's mailbox and
    // attribute the replies to whoever happened to be the ambient tenant.
    const orgs = await query<{ org_id: string }>(
      `select org_id from integration_tokens
        where provider = 'gmail' and status <> 'revoked'`
    ).catch(() => []);
    if (orgs.length === 0) {
      return { ok: true, summary: "No inbox connected, reply polling skipped." };
    }

    const results: AgentResult[] = [];
    for (const { org_id } of orgs) {
      // One tenant's failure must not stop the rest from being polled.
      try {
        results.push(await runWithOrg(org_id, () => pollRepliesForOrg(org_id)));
      } catch (err) {
        results.push({
          ok: false,
          summary: `Reply poll failed for one account: ${(err as Error).message}`,
        });
      }
    }

    const enqueued = results.flatMap((r) => r.enqueued ?? []);
    const failed = results.filter((r) => !r.ok).length;
    return {
      ok: failed === 0,
      summary: `Polled ${orgs.length} connected inbox${orgs.length === 1 ? "" : "es"}. ${results
        .map((r) => r.summary)
        .join(" ")}`,
      enqueued,
      humanActionRequired: results.some((r) => r.humanActionRequired),
    };
  },
};

/** Poll one tenant's inbox. Runs inside that tenant's org context. */
async function pollRepliesForOrg(orgId: string): Promise<AgentResult> {
    if (!(await gmail.isConnected(orgId))) {
      return { ok: true, summary: "Inbox not connected, skipped." };
    }
    // Read once per sweep: with calling off, a reply is captured and priced
    // exactly as it is today, it just never produces a call card.
    const callsEnabled = await areCallsEnabled();
    const sinceSec = Math.floor(Date.now() / 1000) - 3600; // last hour
    const { replies, disabled, error } = await gmail.fetchReplies(sinceSec, orgId);
    if (disabled) return { ok: true, summary: "Inbox unavailable, skipped." };
    if (error) {
      // The poll FAILED. Zero replies from a failed poll must never read as
      // "nobody wrote back": quotes pile up unread in the real inbox while
      // every solicitation waits on them.
      await logAgent({
        agent: "reply-poll",
        action: "poll-failed",
        level: "error",
        status: "error",
        message: `Could not read the inbox for replies: ${error}. If this repeats, the Google connection needs to be reconnected in Settings, then Integrations.`,
      });
      return { ok: false, summary: `Inbox poll failed: ${error}` };
    }

    const enqueued: AgentResult["enqueued"] = [];
    const notifyLines: string[] = [];
    let matched = 0;
    let reviewCount = 0;
    const touchedOpportunities = new Set<string>();
    const opportunityTitles = new Map<string, string>();
    for (const r of replies) {
      // Match reply to an outbound communication by thread id (reliable), else
      // by sender email (weaker: an unrelated email from a known sub would also
      // match, so email-matched replies never auto-save quotes).
      const fromEmail = (r.from.match(/<([^>]+)>/)?.[1] ?? r.from).toLowerCase().trim();
      const { comm, strongMatch } = await matchInboundReply({
        orgId,
        threadId: r.threadId,
        fromEmail,
      });
      if (!comm) continue;
      matched++;
      if (comm.opportunity_id) {
        touchedOpportunities.add(comm.opportunity_id);
        if (comm.opportunity_title) {
          opportunityTitles.set(comm.opportunity_id, comm.opportunity_title);
        }
      }

      // Many subs attach the quote and write "see attached". Read the
      // documents first so extraction sees the numbers, not just the note.
      const docs = await readReplyAttachments({
        messageId: r.messageId,
        attachments: r.attachments ?? [],
        orgId,
      });
      const replyText = combineReplyText(r.body || r.snippet, docs.text);
      // Shared capture pipeline: resolves/creates the sub, records the reply,
      // marks responsive, and auto-saves the quote only under the safety rules
      // (strong correlation + sender ownership + AI-confirmed price + no
      // existing quote).
      const result = await captureReply({
        orgId,
        comm,
        strongMatch,
        fromEmail,
        replyText,
        threadId: r.threadId,
        messageId: r.messageId,
        unreadableAttachments: docs.unreadable,
      });
      // Already captured (e.g. by the Resend inbound webhook or a previous
      // poll of the sliding window): skip notifications and re-enqueues.
      if (result.duplicate) continue;
      const {
        subId,
        companyName,
        extracted,
        decision,
        quoteSaved,
        quoteSkippedExisting,
        declined,
        thankYouSent,
      } = result;
      const mentionedPrice = extracted.quoteAmount ?? extractMentionedPrice(replyText);

      // The same verdict capture acted on, not a second opinion formed after
      // the writes. Recomputing it here is how the two drifted apart: this
      // said "nothing was changed automatically" while capture had already
      // saved a quote on a reading it did not trust.
      const gaps = blockingGaps(extracted, decision.outcome);
      if (subId) {
        // History is written either way. A reply we did not act on is exactly
        // the one a human most needs to be able to read back.
        await recordReplyEvent({
          orgId,
          subcontractorId: subId,
          opportunityId: comm.opportunity_id ?? null,
          trade: comm.trade ?? null,
          extracted,
          originalMessage: replyText,
          gmailMessageId: r.messageId,
          gmailThreadId: r.threadId,
          needsReview: decision.needsReview || gaps.length > 0,
          reviewReason:
            decision.reviewReason ??
            (gaps.length > 0
              ? `Still needed before this can move forward: ${gaps.join(", ")}.`
              : null),
        });
        if (decision.needsReview || gaps.length > 0) reviewCount++;
        // Only a confident, self-consistent reading changes the record. An
        // "unavailable" or "not a fit" mark lands on this solicitation alone,
        // so the sub is still offered the next job.
        if (decision.act && comm.opportunity_id) {
          await applyOutcomeToSolicitation({
            opportunityId: comm.opportunity_id,
            subcontractorId: subId,
            trade: comm.trade ?? null,
            outcome: decision.outcome,
          });
        }
      }

      if (docs.unreadable.length > 0) {
        await logAgent({
          agent: "reply-poll",
          action: "attachment-unreadable",
          opportunityId: comm.opportunity_id,
          subcontractorId: subId ?? undefined,
          level: "warn",
          message: `${companyName ?? fromEmail} attached ${docs.unreadable.join(", ")}, which could not be read (it may be a scan). Open the email and check it yourself.`,
        });
      }

      if (decision.needsReview) {
        notifyLines.push(
          `<li><strong>${companyName ?? fromEmail}</strong> replied about &ldquo;${comm.opportunity_title ?? "an opportunity"}&rdquo;,` +
            ` but nothing was changed automatically. ${decision.reviewReason}` +
            `<br/><span style="color:#6B6560">&ldquo;${r.snippet.slice(0, 200)}&rdquo;</span></li>`
        );
        await logAgent({
          agent: "reply-poll",
          action: "reply-needs-review",
          opportunityId: comm.opportunity_id,
          subcontractorId: subId ?? undefined,
          level: "warn",
          message: `${companyName ?? fromEmail} replied about "${comm.opportunity_title ?? "an opportunity"}", flagged for you to read. ${decision.reviewReason}`,
          reasoning: `Confidence ${extracted.confidence}. Reply excerpt: ${replyText.slice(0, 300)}`,
        });
        continue;
      }

      // Understood, acted on, but incomplete: ask them for the gap instead of
      // parking the solicitation until somebody notices.
      let clarified = false;
      if (decision.act && gaps.length > 0 && subId && comm.opportunity_id) {
        const clarify = await requestClarification({
          opportunityId: comm.opportunity_id,
          subcontractorId: subId,
          toEmail: comm.sub_email ?? fromEmail,
          companyName: companyName ?? null,
          opportunityTitle: comm.opportunity_title,
          trade: comm.trade ?? null,
          gaps,
          outcome: decision.outcome,
          threadId: r.threadId,
          inReplyToMessageId: r.messageId,
          orgId,
        });
        clarified = clarify.sent;
        if (clarify.sent) {
          await logAgent({
            agent: "reply-poll",
            action: "clarification-sent",
            opportunityId: comm.opportunity_id,
            subcontractorId: subId,
            level: "info",
            message: `Asked ${companyName ?? fromEmail} for ${gaps.map(describeGap).join(", ")} before this can move forward.`,
          });
        }
      }

      if (subId && !declined && callsEnabled) {
        enqueued.push({
          agent: "call-prep",
          payload: {
            opportunityId: comm.opportunity_id,
            subcontractorId: subId,
            ...(mentionedPrice != null ? { emailMentionedPrice: mentionedPrice } : {}),
          },
        });
      }

      if (declined) {
        // closeOutDeclinedSub already wrote the reply-declined agent log.
        notifyLines.push(
          `<li><strong>${companyName ?? fromEmail}</strong> declined / cannot fulfill &ldquo;${comm.opportunity_title ?? "an opportunity"}&rdquo;.` +
            ` Closed out on this solicitation${thankYouSent ? "; thank-you sent" : ""}.` +
            `<br/><span style="color:#6B6560">&ldquo;${r.snippet.slice(0, 200)}&rdquo;</span></li>`
        );
        continue;
      }

      // Tell the operator exactly what happened and what changed. The wording
      // never points at a call the account has turned off.
      const confirmWhere = callsEnabled ? "confirm it on the call" : "confirm it on the record";
      const priceNote = quoteSaved
        ? ` Their quote of $${extracted.quoteAmount!.toLocaleString()} was saved to the record; ${confirmWhere}.`
        : quoteSkippedExisting
          ? ` Their email quotes $${extracted.quoteAmount!.toLocaleString()}, but a quote already exists for this sub on this job, review and update it manually if needed.`
          : mentionedPrice != null
            ? ` Their email mentions $${mentionedPrice.toLocaleString()}, ${confirmWhere}.`
            : "";
      await logAgent({
        agent: "reply-poll",
        action: "reply-received",
        opportunityId: comm.opportunity_id,
        subcontractorId: subId ?? undefined,
        level: "success",
        message: `${companyName ?? fromEmail} replied about "${comm.opportunity_title ?? "an opportunity"}". Marked responsive; their reply is saved on the record${
          callsEnabled ? " and a call card is being prepared for Today" : ""
        }.${priceNote}`,
        reasoning: `Reply excerpt: ${replyText.slice(0, 300)}`,
      });
      notifyLines.push(
        `<li><strong>${companyName ?? fromEmail}</strong> replied about &ldquo;${comm.opportunity_title ?? "an opportunity"}&rdquo;.` +
          `${
            quoteSaved
              ? ` Quote <strong>$${extracted.quoteAmount!.toLocaleString()}</strong> saved automatically.`
              : quoteSkippedExisting
                ? ` Quotes <strong>$${extracted.quoteAmount!.toLocaleString()}</strong>, but an existing quote is on file, review manually.`
                : mentionedPrice != null
                  ? ` Mentions <strong>$${mentionedPrice.toLocaleString()}</strong>.`
                  : ""
          }` +
          ` Updated: marked ${OUTCOME_LABEL[decision.outcome].toLowerCase()}, reply saved${
            callsEnabled ? ", call card queued" : ""
          }.` +
          `${clarified ? ` We asked them for ${gaps.map(describeGap).join(", ")}.` : ""}` +
          `<br/><span style="color:#6B6560">&ldquo;${r.snippet.slice(0, 200)}&rdquo;</span></li>`
      );
    }

    // Once every reply in this batch is recorded, see whether any of the
    // solicitations they touched are now fully priced. Done per opportunity
    // rather than per reply so two replies in the same batch cannot race.
    for (const opportunityId of touchedOpportunities) {
      const res = await advanceIfQuotesComplete(opportunityId).catch(() => null);
      if (res?.advanced && res.enqueue) {
        enqueued.push(res.enqueue);
        notifyLines.push(
          `<li>All trades are now priced on &ldquo;${opportunityTitles.get(opportunityId) ?? "a solicitation"}&rdquo;. Moved to Bid Building automatically.</li>`
        );
        continue;
      }
      // Not complete. If that is because everyone said no, escalate: source
      // more subs once, and close with the reasoning when that too is spent.
      const exhaustion = await closeIfSubsExhausted(opportunityId).catch(() => null);
      if (exhaustion?.action === "resourced" && exhaustion.enqueue) {
        enqueued.push(exhaustion.enqueue);
        notifyLines.push(
          `<li>Every sub approached for &ldquo;${opportunityTitles.get(opportunityId) ?? "a solicitation"}&rdquo; has declined. Searching for more candidates automatically.</li>`
        );
      } else if (exhaustion?.action === "closed") {
        notifyLines.push(
          `<li>&ldquo;${opportunityTitles.get(opportunityId) ?? "A solicitation"}&rdquo; was closed: no subcontractor can perform the work, even after a second search. The record says why.</li>`
        );
      }
    }

    // One notification email per poll (not per reply), best-effort: silently
    // skipped when the platform inbox isn't connected; Today + the log still
    // surface it either way. Gated to the founding org, because digestTo is a
    // single platform address (DIGEST_EMAIL_TO): sending it for every tenant
    // put every customer's subcontractor names, opportunity titles, and quote
    // amounts in the founding org's inbox. Each tenant still sees its replies
    // on Today and in its own Automation Log.
    if (
      orgId === LEGACY_ORG_ID &&
      notifyLines.length > 0 &&
      config.systemMail.digestTo &&
      (await systemMail.enabled())
    ) {
      await systemMail
        .send({
          to: config.systemMail.digestTo,
          subject: `BROST CO: ${notifyLines.length} subcontractor repl${notifyLines.length === 1 ? "y" : "ies"} received`,
          html: `<div style="font-family:Inter,Helvetica,Arial,sans-serif;color:#242424"><p>Replies just came in. Each sub is marked responsive and has a call card on Today:</p><ul>${notifyLines.join("")}</ul><p>Open Today to start the calls.</p><div style="width:48px;height:2px;background:#B28F5D;margin-top:16px"></div></div>`,
          text: `Replies just came in. Each sub is marked responsive and has a call card on Today. Open Today to start the calls.`,
        })
        .catch(() => undefined);
    }

    return {
      ok: true,
      summary: `${matched} matched.`,
      enqueued,
      humanActionRequired: reviewCount > 0,
    };
}

/**
 * Contact Recheck Sweep — re-runs Sub Verify for subs that still have no
 * email so contacts get discovered as soon as discovery inputs exist
 * (Hunter key added, Google Maps key added, or a website saved manually).
 * Batched small to respect Hunter/Maps API quotas; skips entirely when no
 * discovery path is configured (nothing would change).
 */
/**
 * After the automated follow-up email, if a sub still has not replied (and has
 * no quote) for 72 hours, mark the pairing unresponsive so Today / Coverage
 * show "No response" instead of forever "Followed up".
 */
export const unresponsiveSweep: AgentDefinition = {
  name: "unresponsive-sweep",
  label: "Unresponsive Sweep",
  description:
    "Marks opportunity×sub pairings as unresponsive when follow-up email got no reply within 72 hours and no quote was entered.",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    // Per organization via the join to opportunities, so no tenant's pairings
    // are marked by a statement scanning another tenant's rows.
    const rows: { id: string; opportunity_id: string }[] = [];
    for (const orgId of await activeOrgIds()) {
      const marked = await runWithOrg(orgId, () =>
        query<{ id: string; opportunity_id: string }>(
          `update opportunity_subs os
              set outreach_state = 'unresponsive'
             from opportunities o
            where o.id = os.opportunity_id
              and o.org_id = $1
              and os.outreach_state = 'followed_up'
              and os.responded_at is null
              and not exists (
                    select 1 from quotes q
                     where q.opportunity_id = os.opportunity_id
                       and q.subcontractor_id = os.subcontractor_id
                       and q.quote_amount is not null
                       and q.quote_amount > 0
                  )
              and exists (
                    select 1 from communications c
                     where c.opportunity_id = os.opportunity_id
                       and c.subcontractor_id = os.subcontractor_id
                       and c.channel = 'email'
                       and c.direction = 'outbound'
                       and c.created_at <= now() - interval '72 hours'
                  )
            returning os.id, os.opportunity_id`,
          [orgId]
        )
      );
      rows.push(...marked);
    }

    // Going unresponsive can be the last answer outstanding: with every other
    // sub already negative, this solicitation is now exhausted and should be
    // re-sourced or closed rather than waiting forever.
    const enqueued: AgentResult["enqueued"] = [];
    const touched = new Set(rows.map((r) => r.opportunity_id));
    for (const opportunityId of touched) {
      const exhaustion = await closeIfSubsExhausted(opportunityId).catch(() => null);
      if (exhaustion?.action === "resourced" && exhaustion.enqueue) {
        enqueued.push(exhaustion.enqueue);
      }
    }
    return {
      ok: true,
      summary: `Marked ${rows.length} pairing(s) unresponsive after follow-up with no reply.`,
      enqueued,
    };
  },
};

export const contactRecheckSweep: AgentDefinition = {
  name: "contact-recheck-sweep",
  label: "Contact Recheck Sweep",
  description:
    "Re-runs Sub Verify for subcontractors with no email on file, so contacts are discovered once Hunter/Google Maps keys or websites become available.",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    // Clear historical call cards that can never be dialed so Today / Call
    // Queue stay actionable.
    const orgs = await listActiveOrganizations().catch(() => []);
    // Per organization: this used to run once unscoped and skip uncallable
    // call cards across every tenant in a single statement.
    const cleared: { id: string }[] = [];
    for (const org of orgs) {
      const skipped = await runWithOrg(org.id, () =>
        query<{ id: string }>(
          `update call_cards cc
              set status = 'skipped',
                  response_json = coalesce(cc.response_json, '{}'::jsonb)
                    || jsonb_build_object('skip_reason', 'no_phone')
            from subcontractors s
           where s.id = cc.subcontractor_id
             and cc.org_id = $1
             and cc.status = 'pending'
             and nullif(btrim(coalesce(s.phone, '')), '') is null
           returning cc.id`,
          [org.id]
        )
      );
      cleared.push(...skipped);
    }

    // No gate on keys or an existing website: website discovery is now
    // key-free (web-search finder + own-site scrape), so every sub without an
    // email has a viable discovery path.
    // Subs missing email OR phone that are attached to an open opportunity.
    // Bounded retry: never checked first, then rechecks no sooner than every
    // 7 days. Small batch per run: full verify hits external APIs.
    //
    // The batch is 20 per organization, not 20 for the platform. Unscoped, the
    // order-by handed the whole batch to whichever tenant had the oldest
    // unchecked subs, so every other customer's subs went unverified run after
    // run, and the verify jobs it queued were for subs it had no business
    // reading.
    const rows: { subcontractor_id: string; opportunity_id: string; trade: string }[] = [];
    for (const org of orgs) {
      const orgRows = await query<{
        subcontractor_id: string;
        opportunity_id: string;
        trade: string;
      }>(
        `select distinct on (s.id) os.subcontractor_id, os.opportunity_id, os.trade
           from subcontractors s
           join opportunity_subs os on os.subcontractor_id = s.id
           join opportunities o on o.id = os.opportunity_id and o.status = 'open'
          where s.org_id = $1
            and s.blacklisted = false
            and (
              nullif(btrim(coalesce(s.email, '')), '') is null
              or nullif(btrim(coalesce(s.phone, '')), '') is null
            )
            and (s.contact_checked_at is null or s.contact_checked_at < now() - interval '7 days')
          order by s.id, s.contact_checked_at asc nulls first
          limit 20`,
        [org.id]
      );
      rows.push(...orgRows);
    }
    if (rows.length === 0) {
      return {
        ok: true,
        summary: `Contact recheck: no subs due for discovery.${
          cleared.length ? ` Cleared ${cleared.length} uncallable call card(s).` : ""
        }`,
      };
    }
    const enqueued: AgentResult["enqueued"] = rows.map((r) => ({
      agent: "sub-verify",
      payload: {
        opportunityId: r.opportunity_id,
        subcontractorId: r.subcontractor_id,
        trade: r.trade,
      },
      opts: {
        singletonKey: `verify:${r.opportunity_id}:${r.subcontractor_id}:${r.trade}`,
        singletonSeconds: 3600,
      },
    }));
    return {
      ok: true,
      summary: `Contact recheck: enqueued Sub Verify for ${rows.length} sub(s) missing email/phone.${
        cleared.length ? ` Cleared ${cleared.length} uncallable call card(s).` : ""
      }`,
      enqueued,
    };
  },
};
