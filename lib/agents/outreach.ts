/**
 * OUTREACH, triggered when a sub clears verification.
 * Renders the active outreach template (Template 1) with the opportunity, sub,
 * and profile context, sends it from the real Gmail account with open/click
 * tracking, records the communication with a 48h follow-up timestamp, and moves
 * the opportunity into the outreach stage. If Gmail is not connected, the email
 * is still stored as a draft and flagged for a human to send. The worker's
 * scheduler handles the 48h follow-up by scanning communications.follow_up_at;
 * reply handling is done by the reply-poller (which enqueues Call Prep).
 *
 * When the account has turned calling off, the send is identical and no call
 * card is queued: the opportunity advances straight to collecting quotes,
 * since a sent email is the whole of the work at this step.
 */
import { randomUUID } from "node:crypto";
import { query, queryOne } from "../db";
import { getProfileJson } from "../ai/companyProfile";
import { logAgent } from "../logger";
import { areCallsEnabled } from "../app-settings";
import { advancePastCallStep } from "../domain/advance-stage";
import { sendOutreachEmail } from "../integrations/email-transport";
import { scrubGovtContacts, rewriteSamUrls } from "../integrations/scrub-contacts";
import { gatherTradeAttachments } from "../opportunity-attachments";
import { isCallable, isEmailable } from "../domain/sub-contactability";
import { buildOutreachBrief, describeMissing } from "../domain/outreach-brief";
import { outreachDisplayName } from "../domain/solicitation-completeness";
import {
  renderOutreachBrief,
  scrubInternalFailureCopy,
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

    const callsEnabled = await areCallsEnabled();

    // Do not create dead-end draft emails for unreachable subs. Phone-only
    // firms go straight to Call Prep (or are left out entirely when calling is
    // off); zero-pathway firms are held for a human.
    if (!isEmailable(sub)) {
      if (isCallable(sub) && !callsEnabled) {
        // Reachable by phone only, on an email-only account. There is no work
        // to hand anyone: recorded on the pairing and in the log, without a
        // call task and without flagging the opportunity, so the rest of the
        // trade's outreach carries on untouched.
        await query(
          `update opportunity_subs
              set outreach_state = 'no_email'
            where opportunity_id = $1 and subcontractor_id = $2`,
          [opportunityId, subcontractorId]
        );
        await logAgent({
          agent: "outreach",
          action: "skip-phone-only",
          level: "info",
          opportunityId,
          subcontractorId,
          message: `${sub.company_name} has a phone number but no verified email, and calling is turned off, so they were left out of this solicitation.`,
        });
        return {
          ok: true,
          summary: `Skipped ${sub.company_name}: phone-only, and calling is turned off.`,
        };
      }
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

    // Org-aware: this tenant's own copy if they saved one, else the platform
    // default. Never another tenant's edit.
    const { activeTemplate } = await import("../domain/template-store");
    const { tryResolveTenantOrgId } = await import("../tenant");
    const tmpl = await activeTemplate("template_1_outreach", await tryResolveTenantOrgId());
    if (!tmpl) return { ok: false, summary: "no active template_1_outreach template" };

    const analysis = opp.solicitation_analysis;
    const deadlineLabel = formatDeadlineLabel(opp.deadline);

    // Documents first: the brief lists them, and the completeness check has to
    // know whether any arrived before it can decide the email is sendable.
    // Trade-filtered official docs (unaltered PDFs). Generated copy is
    // scrubbed; source PDFs are not rewritten.
    const gathered = await gatherTradeAttachments(opp, trade);

    /**
     * Everything the subcontractor needs, as sections, plus what is missing.
     *
     * One assembly, one verdict. The old path built a paragraph, checked it
     * for thinness, gathered documents, then checked those separately, so
     * "can this email do its job" was answered in two places and neither
     * looked at project name, location or bid date at all.
     */
    const brief = buildOutreachBrief({
      trade,
      analysis,
      description: opp.description,
      title: opp.title,
      agency: opp.agency,
      solicitationNumber: opp.solicitation_number,
      locationState: opp.location_state,
      locationText: opp.location_text,
      deadlineLabel,
      attachedNames: gathered.files.map((f) => f.filename),
      links: gathered.links,
      documentsExpected: gathered.expected,
    });

    if (!brief.ready) {
      const why = describeMissing(brief.missing);
      await query(
        `update opportunities
            set human_action_required = true,
                risk_flags = (
                  select array(select distinct unnest(coalesce(risk_flags,'{}') || array['outreach_incomplete']))
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
        message: `Refused to email ${sub.company_name}: the quote request would be incomplete. ${why}`,
        reasoning: `Missing: ${brief.missing.filter((m) => m.blocking).map((m) => m.key).join(", ")}.`,
      });
      return {
        ok: true,
        summary: `Held outreach to ${sub.company_name}: ${why}`,
        humanActionRequired: true,
        data: { missing: brief.missing.filter((m) => m.blocking).map((m) => m.key) },
      };
    }

    // Non-blocking gaps are still worth a line in the log, so an operator can
    // see why a quote came back as a rough number.
    for (const soft of brief.missing.filter((m) => !m.blocking)) {
      await logAgent({
        agent: "outreach",
        action: "gap",
        level: "info",
        opportunityId,
        subcontractorId,
        message: soft.detail,
      });
    }

    /**
     * Scrub every recipient-facing line of the brief.
     *
     * SAM API URLs are rewritten to the public ones, solicitor contacts are
     * removed so a subcontractor never emails the contracting officer, and any
     * line that reads as an internal failure is dropped rather than sent.
     */
    let contactsRedacted = 0;
    const briefSections = brief.sections
      .map((section) => ({
        heading: section.heading,
        items: section.items
          .map((item) => {
            const { sanitised, count } = scrubGovtContacts(rewriteSamUrls(item));
            contactsRedacted += count;
            return scrubInternalFailureCopy(sanitised);
          })
          .filter((item) => item.trim() && !lineLooksLikeInternalFailure(item)),
      }))
      .filter((section) => section.items.length > 0);

    // The scope section is the email's reason to exist; losing it to scrubbing
    // means the send is no longer worth making.
    const scopeSection = briefSections.find((x) => x.heading === "Scope we need priced");
    if (!scopeSection) {
      await query(
        `update opportunities
            set human_action_required = true,
                risk_flags = (
                  select array(select distinct unnest(coalesce(risk_flags,'{}') || array['outreach_incomplete']))
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
        message: `Refused to email ${sub.company_name}: nothing usable was left of the scope after scrubbing.`,
      });
      return {
        ok: true,
        summary: `Held outreach to ${sub.company_name}: no usable scope after scrubbing.`,
        humanActionRequired: true,
      };
    }

    // {{scope_summary}} still resolves, for templates that reference it: the
    // scope lines as sentences rather than the old everything-blob.
    const scopeSummary = scopeSection.items.join(" ");

    // {{questions}} resolves to nothing now: those questions are a section of
    // the brief. Rendering them in the body too was the same list twice.
    const questions = "";

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

    contactsRedacted += titleRedacted + agencyRedacted + tradeRedacted;
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

    const details = renderOutreachBrief(briefSections);
    const detailsPlain = details.plain;
    const detailsHtml = details.html;

    const fullPlain = plainBody + detailsPlain;
    const html = plainToHtml(plainBody) + detailsHtml;

    // Idempotency guard. pg-boss delivers at-least-once: a job whose handler
    // sent the email but crashed before acking is redelivered, and a duplicate
    // enqueue can slip past the singleton window. Either way, re-sending means
    // a real subcontractor gets the same quote request twice. If an outbound
    // email already exists for THIS opportunity+sub+trade, the send already
    // happened, so skip it and report success rather than mailing again.
    // `provider is not null` is the "actually sent" signal: a draft or a
    // failed send stores a communications row with a null provider, and the
    // outreach-recovery sweep legitimately re-runs outreach to send those, so
    // this guard must NOT block them — only a genuine prior send.
    const priorSend = await queryOne<{ id: string }>(
      `select id from communications
        where opportunity_id = $1 and subcontractor_id = $2
          and channel = 'email' and direction = 'outbound'
          and provider is not null
          and coalesce(meta->>'trade', '') = $3
          and coalesce(meta->>'kind', '') not in ('decline_thank_you', 'final_nudge')
        limit 1`,
      [opportunityId, subcontractorId, trade ?? ""]
    ).catch(() => null);
    if (priorSend) {
      await logAgent({
        agent: "outreach",
        action: "skip-duplicate",
        level: "info",
        opportunityId,
        subcontractorId,
        message: `${sub.company_name} was already emailed for ${trade || "this work"}; skipping a duplicate send (job redelivered or re-enqueued).`,
      });
      return {
        ok: true,
        summary: `Already contacted ${sub.company_name} for ${trade || "this work"}; no duplicate email sent.`,
      };
    }

    const trackingId = randomUUID();
    const followUpAt = new Date(Date.now() + 48 * 3_600_000).toISOString();

    let messageId: string | null = null;
    let threadId: string | null = null;
    // RFC822 Message-ID (not Gmail's API id): what In-Reply-To needs later.
    let rfc822MessageId: string | null = null;
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
        rfc822MessageId = res.rfc822MessageId ?? null;
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
          recipient_email, meta, rfc822_message_id)
       values ($1,$2,'email','outbound',$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`,
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
        // The real Message-ID header, so the 48h follow-up can thread under
        // this exact email in the subcontractor's own mail client.
        rfc822MessageId,
      ]
    );

    // Exactly this trade's row. The old predicate fell open on an empty
    // trade and stamped EVERY trade line for the pair, so one failed send
    // could overwrite a sibling trade's successful "sent", and a stamp on
    // never-emailed trades made them read as approached-and-dead.
    await query(
      `update opportunity_subs set outreach_state=$3
       where opportunity_id=$1 and subcontractor_id=$2
         and coalesce(trade,'') = $4`,
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
    //
    // With calling off there is no card and nothing to wait for: the email step
    // is complete, so the opportunity advances to collecting quotes on the same
    // beat it would otherwise have entered the call queue. The 48h follow-up is
    // unaffected, it runs off communications.follow_up_at, not the stage.
    const enqueued: AgentResult["enqueued"] =
      sent && callsEnabled
        ? [
            {
              agent: "call-prep",
              payload: { opportunityId, subcontractorId, trade, source: "outreach" },
            },
          ]
        : [];
    if (sent && !callsEnabled) {
      await advancePastCallStep(opportunityId, {
        agent: "outreach",
        reason: `Emailed ${sub.company_name}. Calling is turned off, so this moved straight to collecting quotes; their reply is captured automatically.`,
      });
    }

    const summary = sent
      ? `Sent outreach to ${sub.company_name} <${sub.email}>; 48h follow-up scheduled, ${
          callsEnabled ? "call card queued" : "calling is off so no call card was created"
        }.`
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
