/**
 * OUTREACH, triggered when a sub clears verification.
 * Renders the active outreach template (Template 1) with the opportunity, sub,
 * and profile context, sends it from the real Gmail account with open/click
 * tracking, records the communication with a 48h follow-up timestamp, and moves
 * the opportunity into the outreach stage. If Gmail is not connected, the email
 * is still stored as a draft and flagged for a human to send. The worker's
 * scheduler handles the 48h follow-up by scanning communications.follow_up_at;
 * reply handling is done by the reply-poller (which enqueues Call Prep).
 */
import { randomUUID } from "node:crypto";
import { query, queryOne } from "../db";
import { getProfileJson } from "../ai/companyProfile";
import { logAgent } from "../logger";
import { gmail } from "../integrations/gmail";
import type { AgentDefinition } from "./types";
import type { AgentResult, Opportunity, Subcontractor } from "../types";

/** Simple {{var}} replacement. Unknown vars are left blank. */
function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) =>
    key in vars ? vars[key] : ""
  );
}

/** Format an ISO/date string for humans; falls back to the raw value. */
function formatDeadline(deadline: string | null): string {
  if (!deadline) return "the stated deadline";
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return deadline;
  return d.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function stripHtmlText(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

export const outreach: AgentDefinition = {
  name: "outreach",
  label: "Outreach",
  description:
    "Renders + sends the Template 1 outreach email to a verified sub (with tracking), records the communication, and sets a 48h follow-up.",
  worksWithoutClaude: true, // templated send; no Claude needed
  async handler(ctx): Promise<AgentResult> {
    const opportunityId = ctx.payload.opportunityId as string;
    const subcontractorId = ctx.payload.subcontractorId as string;
    const trade = (ctx.payload.trade as string | undefined) ?? "";
    if (!opportunityId || !subcontractorId)
      return { ok: false, summary: "missing opportunityId or subcontractorId in payload" };

    const sub = await queryOne<Subcontractor>(
      `select * from subcontractors where id = $1`,
      [subcontractorId]
    );
    if (!sub) return { ok: false, summary: `subcontractor ${subcontractorId} not found` };

    const opp = await queryOne<Opportunity>(
      `select * from opportunities where id = $1`,
      [opportunityId]
    );
    if (!opp) return { ok: false, summary: `opportunity ${opportunityId} not found` };

    const profile = await getProfileJson();
    if (!profile) return { ok: false, summary: "no active Company Profile" };

    const tmpl = await queryOne<{ subject: string | null; body: string }>(
      `select subject, body from templates
       where slug='template_1_outreach' and is_active=true
       order by version desc limit 1`
    );
    if (!tmpl) return { ok: false, summary: "no active template_1_outreach template" };

    const analysis = opp.solicitation_analysis;
    const scopeSummary = (analysis?.scope_plain_language ?? opp.description ?? "").slice(0, 400);
    const questions = (analysis?.questions_for_subs ?? [])
      .map((q) => `- ${q}`)
      .join("\n");

    const vars: Record<string, string> = {
      owner_name: sub.owner_name || "there",
      company_name: profile.legal_name,
      opportunity_title: opp.title ?? "an upcoming opportunity",
      location_state: opp.location_state ?? "",
      deadline: formatDeadline(opp.deadline),
      trade,
      scope_summary: scopeSummary,
      questions,
      sender_name: profile.legal_name,
    };

    const subject = render(tmpl.subject ?? "Partnership opportunity", vars);
    const plainBody = render(tmpl.body, vars);
    const html = plainBody.replace(/\n/g, "<br>");

    const trackingId = randomUUID();
    const followUpAt = new Date(Date.now() + 48 * 3_600_000).toISOString();

    let messageId: string | null = null;
    let threadId: string | null = null;
    let outreachState = "pending";
    let humanAction = false;
    let sent = false;

    if (sub.email && sub.email_verified) {
      const res = await gmail.send({
        to: sub.email,
        subject,
        html,
        text: plainBody,
        trackingId,
      });
      if (res.disabled) {
        humanAction = true;
        await logAgent({
          agent: "outreach",
          action: "send",
          level: "warn",
          status: "skipped",
          opportunityId,
          subcontractorId,
          message: "Gmail not connected, outreach stored as draft for manual send.",
        });
      } else if (res.error) {
        humanAction = true;
        await logAgent({
          agent: "outreach",
          action: "send",
          level: "error",
          status: "error",
          opportunityId,
          subcontractorId,
          message: `Gmail send failed: ${res.error}`,
        });
      } else {
        sent = true;
        outreachState = "sent";
        messageId = res.messageId ?? null;
        threadId = res.threadId ?? null;
      }
    } else {
      // No verified email, record a draft and require a human.
      humanAction = true;
    }

    await query(
      `insert into communications
         (subcontractor_id, opportunity_id, channel, direction, subject, body,
          gmail_message_id, gmail_thread_id, tracking_id, follow_up_at)
       values ($1,$2,'email','outbound',$3,$4,$5,$6,$7,$8)`,
      [
        subcontractorId,
        opportunityId,
        subject,
        stripHtmlText(plainBody),
        messageId,
        threadId,
        trackingId,
        followUpAt,
      ]
    );

    await query(
      `update opportunity_subs set outreach_state=$3
       where opportunity_id=$1 and subcontractor_id=$2
         and ($4::text = '' or coalesce(trade,'') = $4)`,
      [opportunityId, subcontractorId, outreachState, trade]
    );

    if (sent) {
      await query(`update subcontractors set last_contacted=now() where id=$1`, [
        subcontractorId,
      ]);
    }

    await query(`update opportunities set stage='outreach' where id=$1`, [opportunityId]);

    // Every sub we actually email becomes a call card so the operator can follow
    // up by phone; not everyone replies to email. A later reply upgrades this
    // same card from a cold follow-up to a warm one (see call-prep).
    const enqueued: AgentResult["enqueued"] = sent
      ? [
          {
            agent: "call-prep",
            payload: { opportunityId, subcontractorId, trade, source: "outreach" },
          },
        ]
      : [];

    const summary = sent
      ? `Sent outreach to ${sub.company_name} <${sub.email}>; 48h follow-up scheduled, call card queued.`
      : `Outreach to ${sub.company_name} stored as draft (${
          sub.email ? "Gmail unavailable" : "no verified email"
        }); needs manual send.`;

    return {
      ok: true,
      summary,
      reasoning: `Rendered template_1_outreach with ${
        Object.keys(vars).length
      } vars; tracking_id=${trackingId}; follow_up_at=${followUpAt}.`,
      data: { sent, outreachState, trackingId, messageId },
      humanActionRequired: humanAction,
      enqueued,
    };
  },
};
