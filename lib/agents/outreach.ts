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
import { sendOutreachEmail } from "../integrations/email-transport";
import { scrubGovtContacts, rewriteSamUrls } from "../integrations/scrub-contacts";
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
    // Rewrite raw api.sam.gov notice URLs to the public sam.gov/opp/{id}/view
    // equivalent before any further processing so they're clickable for subs.
    const rawScopeSummary = rewriteSamUrls(
      (analysis?.scope_plain_language ?? opp.description ?? "").slice(0, 400)
    );

    // Scrub government contact info (CO phone numbers and email addresses) from
    // every solicitation-derived string before it reaches the sub. This prevents
    // subs from contacting the contracting officer directly and pricing toward the
    // contract ceiling. Apply at the outbound boundary so nothing leaks through
    // any template variable, including AI-generated scope questions which are
    // derived from raw solicitation text and may reproduce CO contact data.
    const { sanitised: scopeSummary, count: scopeRedacted } =
      scrubGovtContacts(rawScopeSummary);

    let questionsRedacted = 0;
    const questions = (analysis?.questions_for_subs ?? [])
      .map((q) => {
        const { sanitised, count } = scrubGovtContacts(String(q));
        questionsRedacted += count;
        return `- ${sanitised}`;
      })
      .join("\n");

    const contactsRedacted = scopeRedacted + questionsRedacted;

    const vars: Record<string, string> = {
      owner_name: sub.owner_name || "there",
      company_name: profile.legal_name,
      opportunity_title: opp.title ?? "an upcoming opportunity",
      location_state: opp.location_state ?? "",
      deadline: formatDeadline(opp.deadline),
      trade,
      scope_summary: scopeSummary,
      questions,
      // Use the operator's personal name (owner_name) so the greeting reads
      // "I'm Jared with BROSTCO Holdings" — not the company name twice.
      sender_name: profile.owner_name || profile.legal_name,
      phone: profile.phone ?? "",
      solicitation_number: opp.solicitation_number ?? "",
      agency: opp.agency ?? "",
    };

    const subject = render(tmpl.subject ?? "Partnership opportunity", vars);
    const plainBody = render(tmpl.body, vars);

    // Government solicitation documents are NOT attached to automated outreach
    // emails. Raw SOW/RFQ files often include the contracting officer's phone
    // and email, which would let subs bypass BROSTCO or anchor their price to
    // the contract ceiling. The plain-text scope extract above (already
    // sanitised) gives the sub what they need to quote. Files remain stored
    // internally for the operator's reference. Count them for the audit log.
    const withheldDocs = await query<{ count: string }>(
      `select count(*)::text as count from documents
        where opportunity_id = $1 and kind in ('solicitation','sow')`,
      [opp.id]
    ).then((r) => parseInt(r[0]?.count ?? "0", 10)).catch(() => 0);

    await logAgent({
      agent: "outreach",
      action: "sanitise",
      level: "info",
      opportunityId,
      subcontractorId,
      message:
        `[outreach] scope sanitised (${contactsRedacted} contact(s) redacted), ` +
        `0 files attached (${withheldDocs} govt doc(s) withheld). ` +
        `Subject: "${subject}" | Body preview: "${plainBody.slice(0, 120).replace(/\n/g, " ")}…"`,
    });

    // Pricing-relevant details block — reference info only, no document links.
    const detailLines = [
      opp.title ? `Project: ${opp.title}` : "",
      opp.solicitation_number ? `Solicitation #: ${opp.solicitation_number}` : "",
      opp.agency ? `Agency: ${opp.agency}` : "",
      opp.deadline ? `Bid deadline: ${formatDeadline(opp.deadline)}` : "",
    ].filter(Boolean);
    const detailsPlain =
      (detailLines.length ? `\n\n---\n${detailLines.join("\n")}` : "") +
      `\n\nPlease reply to this email with your price for the ${trade || "described"} scope (include payment terms and any exclusions).`;
    const detailsHtml =
      (detailLines.length
        ? `<div style="border-top:2px solid #B28F5D;margin-top:16px;padding-top:12px"><p style="color:#242424">${detailLines.map((l) => l.replace(/&/g, "&amp;").replace(/</g, "&lt;")).join("<br/>")}</p></div>`
        : "") +
      `<p><strong>Please reply to this email with your price</strong> for the ${trade || "described"} scope (include payment terms and any exclusions).</p>`;

    const fullPlain = plainBody + detailsPlain;
    const html = plainBody.replace(/\n/g, "<br>") + detailsHtml;

    const trackingId = randomUUID();
    const followUpAt = new Date(Date.now() + 48 * 3_600_000).toISOString();

    let messageId: string | null = null;
    let threadId: string | null = null;
    let provider: string | null = null;
    let outreachState = "pending";
    let humanAction = false;
    let sent = false;

    if (sub.email && sub.email_verified) {
      const res = await sendOutreachEmail({
        to: sub.email,
        subject,
        html,
        text: fullPlain,
        trackingId,
        attachments: [], // govt docs withheld — see sanitise log above
      });
      if (res.disabled) {
        humanAction = true;
        outreachState = "draft";
        await logAgent({
          agent: "outreach",
          action: "send",
          level: "warn",
          status: "skipped",
          opportunityId,
          subcontractorId,
          message:
            "No email transport available (connect Gmail or configure Resend); outreach stored as draft for manual send.",
        });
      } else if (res.error) {
        humanAction = true;
        outreachState = "send_failed";
        await logAgent({
          agent: "outreach",
          action: "send",
          level: "error",
          status: "error",
          opportunityId,
          subcontractorId,
          message: `${res.provider === "resend" ? "Resend" : "Gmail"} send failed: ${res.error}`,
        });
      } else {
        sent = true;
        outreachState = "sent";
        provider = res.provider;
        messageId = res.messageId ?? null;
        threadId = res.threadId ?? null;
      }
    } else {
      // No verified email, record a draft and require a human.
      humanAction = true;
      outreachState = sub.email ? "email_unverified" : "no_email";
    }

    await query(
      `insert into communications
         (subcontractor_id, opportunity_id, channel, direction, subject, body,
          gmail_message_id, gmail_thread_id, tracking_id, follow_up_at, provider,
          recipient_email)
       values ($1,$2,'email','outbound',$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        subcontractorId,
        opportunityId,
        subject,
        stripHtmlText(fullPlain),
        messageId,
        threadId,
        trackingId,
        // Only schedule the automated 48h follow-up when the initial message
        // actually went out — following up on a draft/failed send would email
        // "following up on my note below" about a note that was never sent.
        sent ? followUpAt : null,
        provider,
        // Capture exact address used — sub record may be updated later.
        sub.email ?? null,
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
          sub.email ? "no email transport available" : "no verified email"
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
