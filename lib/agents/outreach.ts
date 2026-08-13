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
import { gatherTradeAttachments } from "../opportunity-attachments";
import { isCallable, isEmailable } from "../domain/sub-contactability";
import { buildOutreachPacket } from "../domain/outreach-packet";
import { outreachDisplayName } from "../domain/solicitation-completeness";
import {
  buildOutreachDetailsBlock,
  scrubInternalFailureCopy,
  shouldHoldMissingDocs,
  scopeTooThinAfterScrub,
  lineLooksLikeInternalFailure,
} from "../domain/outreach-email";
import {
  renderTemplate,
  formatDeadlineLabel,
  plainToHtml,
} from "../domain/template-render";
import type { AgentDefinition } from "./types";
import type { AgentResult, Opportunity, Subcontractor } from "../types";

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

    // Do not create dead-end draft emails for unreachable subs. Phone-only
    // firms go straight to Call Prep; zero-pathway firms are held for a human.
    if (!isEmailable(sub)) {
      if (isCallable(sub)) {
        return {
          ok: true,
          summary: `No verified email for ${sub.company_name}; queued a call instead.`,
          enqueued: [
            {
              agent: "call-prep",
              payload: {
                opportunityId,
                subcontractorId,
                trade,
                source: "outreach",
              },
              opts: {
                singletonKey: `callprep:${opportunityId}:${subcontractorId}`,
                singletonSeconds: 3600,
              },
            },
          ],
        };
      }
      await query(
        `update opportunity_subs
            set outreach_state = 'no_email'
          where opportunity_id = $1 and subcontractor_id = $2`,
        [opportunityId, subcontractorId]
      );
      await query(
        `update opportunities set human_action_required = true where id = $1`,
        [opportunityId]
      );
      return {
        ok: true,
        summary: `Held ${sub.company_name}: no verified email and no phone, automation cannot reach them.`,
        humanActionRequired: true,
      };
    }

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
    const deadlineLabel = formatDeadlineLabel(opp.deadline);
    const packet = buildOutreachPacket({
      trade,
      analysis,
      description: opp.description,
      locationState: opp.location_state,
      locationText: opp.location_text,
      deadlineLabel,
    });

    if (packet.tooThin) {
      await query(
        `update opportunities
            set human_action_required = true,
                risk_flags = (
                  select array(select distinct unnest(coalesce(risk_flags,'{}') || array['outreach_scope_too_thin']))
                )
          where id = $1`,
        [opportunityId]
      );
      await logAgent({
        agent: "outreach",
        action: "blocked",
        level: "warn",
        opportunityId,
        subcontractorId,
        message: `Refused to email ${sub.company_name}: trade scope is too thin or unspecified. Enrich the solicitation package and re-run analysis before outreach.`,
      });
      return {
        ok: true,
        summary: `Held outreach to ${sub.company_name}: scope too thin to send a usable quote request.`,
        humanActionRequired: true,
      };
    }

    // Rewrite SAM API URLs, then scrub solicitor contacts from every outbound string.
    const { sanitised: scopeRaw, count: scopeRedacted } = scrubGovtContacts(
      rewriteSamUrls(packet.scopeSummary)
    );
    const scopeSummary = scrubInternalFailureCopy(scopeRaw);

    if (scopeTooThinAfterScrub(scopeSummary)) {
      await query(
        `update opportunities
            set human_action_required = true,
                risk_flags = (
                  select array(select distinct unnest(coalesce(risk_flags,'{}') || array['outreach_scope_too_thin']))
                )
          where id = $1`,
        [opportunityId]
      );
      await logAgent({
        agent: "outreach",
        action: "blocked",
        level: "warn",
        opportunityId,
        subcontractorId,
        message: `Refused to email ${sub.company_name}: trade scope is too thin or unspecified. Enrich the solicitation package and re-run analysis before outreach.`,
      });
      return {
        ok: true,
        summary: `Held outreach to ${sub.company_name}: scope too thin to send a usable quote request.`,
        humanActionRequired: true,
      };
    }

    let questionsRedacted = 0;
    const questions = (analysis?.questions_for_subs ?? [])
      .map((q) => {
        const { sanitised, count } = scrubGovtContacts(String(q));
        questionsRedacted += count;
        return sanitised;
      })
      .filter((q) => q.trim() && !lineLooksLikeInternalFailure(q))
      .map((q) => `- ${q}`)
      .join("\n");

    // Every remaining solicitation-derived free-text value must be scrubbed
    // BEFORE it enters `vars`, not merely before it enters the details block:
    // templates are operator-editable and may reference {{opportunity_title}},
    // {{agency}} or {{trade}} directly. Scrubbing is a no-op on clean values,
    // so this costs nothing when there is no contact to remove.
    const { sanitised: titleClean, count: titleRedacted } = scrubGovtContacts(
      opp.title ?? ""
    );
    const { sanitised: agencyClean, count: agencyRedacted } = scrubGovtContacts(
      opp.agency ?? ""
    );
    // Recipient-facing copy only — `trade` itself still drives attachment
    // filtering and must keep its original value for matching.
    const { sanitised: tradeClean, count: tradeRedacted } = scrubGovtContacts(trade);

    const contactsRedacted =
      scopeRedacted + questionsRedacted + titleRedacted + agencyRedacted + tradeRedacted;
    const senderName = outreachDisplayName(profile);
    // Greeting uses first name of sub owner when available; never invent a last name.
    const subGreeting = (() => {
      const raw = (sub.owner_name ?? "").trim();
      if (!raw) return "there";
      return raw.split(/\s+/)[0] || "there";
    })();

    const vars: Record<string, string> = {
      owner_name: subGreeting,
      company_name: profile.legal_name,
      opportunity_title: titleClean || "an upcoming opportunity",
      location_state: opp.location_state ?? "",
      deadline: deadlineLabel,
      trade: tradeClean,
      scope_summary: scopeSummary,
      questions,
      // External display name only (first name / configured outreach name).
      sender_name: senderName,
      phone: profile.phone ?? "",
      solicitation_number: opp.solicitation_number ?? "",
      // Agency name is OK; never inject analysis.contacts / CO details.
      agency: agencyClean,
    };

    // Solicitation-derived values (scope_summary, questions, title, agency) were
    // already scrubbed on their way into `vars`. The assembled email is NEVER
    // scrubbed: after substitution the operator's own phone and email are
    // indistinguishable from the contracting officer's, so a pass here censors
    // Brost Co's own contact details out of Brost Co's own email.
    const subject = renderTemplate(tmpl.subject ?? "Partnership opportunity", vars);
    const plainBody = scrubInternalFailureCopy(renderTemplate(tmpl.body, vars));

    // Trade-filtered official docs (unaltered PDFs). Generated copy is scrubbed;
    // source PDFs are not rewritten.
    const gathered = await gatherTradeAttachments(opp, trade);
    if (shouldHoldMissingDocs(gathered.expected, gathered.files.length, gathered.links.length)) {
      await query(
        `update opportunities
            set human_action_required = true,
                risk_flags = (
                  select array(select distinct unnest(coalesce(risk_flags,'{}') || array['outreach_docs_missing']))
                )
          where id = $1`,
        [opportunityId]
      );
      await logAgent({
        agent: "outreach",
        action: "blocked",
        level: "warn",
        opportunityId,
        subcontractorId,
        message: `Refused to email ${sub.company_name}: solicitation documents were expected but none could be attached or linked.`,
      });
      return {
        ok: true,
        summary: `Held outreach to ${sub.company_name}: documents were expected but none could be included.`,
        humanActionRequired: true,
      };
    }

    await logAgent({
      agent: "outreach",
      action: "sanitise",
      level: "info",
      opportunityId,
      subcontractorId,
      message:
        `[outreach] scope sanitised (${contactsRedacted} contact(s) redacted), ` +
        `${gathered.files.length} file(s) attached` +
        (gathered.files.length
          ? ` [${gathered.files.map((f) => `${f.filename}:${f.mime ?? "?"}`).join("; ")}]`
          : "") +
        (gathered.links.length ? `, ${gathered.links.length} as links` : "") +
        `. Subject: "${subject}" | Body preview: "${plainBody.slice(0, 120).replace(/\n/g, " ")}…"`,
    });

    const details = buildOutreachDetailsBlock({
      title: titleClean || null,
      solicitationNumber: opp.solicitation_number,
      agency: agencyClean || null,
      deadlineLabel,
      trade: tradeClean,
      attachedNames: gathered.files.map((f) => f.filename),
      links: gathered.links,
    });
    const detailsPlain = details.plain;
    const detailsHtml = details.html;

    const fullPlain = plainBody + detailsPlain;
    const html = plainToHtml(plainBody) + detailsHtml;

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
        attachments: gathered.files,
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
          message: res.blocked
            ? `Held email to ${sub.company_name}, nothing was sent. ${res.error}`
            : `Gmail send failed: ${res.error}`,
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
          recipient_email, meta)
       values ($1,$2,'email','outbound',$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
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
        // The trade this email was about, so a reply's outcome lands on the
        // right trade line instead of every trade this sub was approached for
        // on the same solicitation.
        JSON.stringify(trade ? { trade } : {}),
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

    // Only claim "Contacting subs" when a message actually left the building.
    // Drafts / failed sends keep the prior stage and flag the operator instead.
    if (sent) {
      await query(`update opportunities set stage='outreach' where id=$1`, [opportunityId]);
    } else {
      await query(
        `update opportunities
           set human_action_required=true,
               risk_flags = (
                 select array_agg(distinct x)
                 from unnest(
                   coalesce(risk_flags, '{}') || array['outreach_send_failed']::text[]
                 ) as x
               )
         where id=$1`,
        [opportunityId]
      );
    }

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
