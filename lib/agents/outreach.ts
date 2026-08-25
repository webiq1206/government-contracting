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
import {
  assessAttachmentPackage,
  describePackageProblems,
} from "../domain/attachment-package";
import { isCallable, isEmailable } from "../domain/sub-contactability";
import { buildOutreachSections } from "../domain/outreach-sections";
import {
  resolveOutreachVars,
  varSpec,
  OUTREACH_VAR_SAMPLES,
} from "../domain/outreach-vars";
import {
  validateOutboundEmail,
  describeProblems,
} from "../domain/outreach-validation";
import {
  renderOutreachBrief,
  scrubInternalFailureCopy,
  lineLooksLikeInternalFailure,
} from "../domain/outreach-email";
import { renderTemplate, plainToHtml } from "../domain/template-render";
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

    // Documents first: the brief lists them, and the completeness check has to
    // know whether any arrived before it can decide the email is sendable.
    // Trade-filtered official docs (unaltered PDFs). Generated copy is
    // scrubbed; source PDFs are not rewritten.
    const gathered = await gatherTradeAttachments(opp, trade);

    /*
     * Is what we gathered actually usable?
     *
     * The gatherer finds files and fits them under the size limit; it has no
     * opinion on whether they open. An empty download, an HTML error page
     * stored under a document's name, or a password-protected PDF all attach
     * cleanly and all arrive useless, and the email looks complete either way.
     */
    const pkg = assessAttachmentPackage({
      files: gathered.files,
      links: gathered.links,
      expected: gathered.expected,
      undelivered: gathered.undelivered,
    });
    for (const soft of pkg.problems.filter((p) => !p.blocking)) {
      await logAgent({
        agent: "outreach",
        action: "gap",
        level: "info",
        opportunityId,
        subcontractorId,
        message: soft.message,
      });
    }
    if (!pkg.ok) {
      const why = describePackageProblems(pkg.problems);
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
        message: `Refused to email ${sub.company_name}: the document package is not usable. ${why}`,
        reasoning: pkg.problems.filter((p) => p.blocking).map((p) => p.kind).join(", "),
      });
      return {
        ok: true,
        summary: `Held outreach to ${sub.company_name}: ${why}`,
        humanActionRequired: true,
        data: { attachmentProblems: pkg.problems.filter((p) => p.blocking).map((p) => p.kind) },
      };
    }

    /**
     * Every variable this email needs, resolved in one place.
     *
     * One assembly, one verdict. The old path built a paragraph, checked it
     * for thinness, gathered documents, then checked those separately, so
     * "can this email do its job" was answered in two places and neither
     * looked at project name, location or bid date at all. It also had no
     * concept of a quote deadline distinct from the bid deadline, which is the
     * single most consequential thing this email says.
     */
    const resolved = resolveOutreachVars({
      sub,
      opportunity: opp,
      analysis: analysis ?? undefined,
      profile,
      trade,
      description: opp.description,
    });

    if (resolved.missingRequired.length) {
      const why = `The email is missing ${resolved.missingRequired
        .map((k) => varSpec(k)?.label ?? k)
        .join(", ")}.`;
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
        reasoning: `Missing: ${resolved.missingRequired.join(", ")}.`,
      });
      return {
        ok: true,
        summary: `Held outreach to ${sub.company_name}: ${why}`,
        humanActionRequired: true,
        data: { missing: resolved.missingRequired },
      };
    }

    // Gaps that do not stop a send are still worth a line in the log, so an
    // operator can see why a quote came back as a rough number.
    for (const gap of resolved.warnings) {
      await logAgent({
        agent: "outreach",
        action: "gap",
        level: "info",
        opportunityId,
        subcontractorId,
        message: gap,
      });
    }

    /**
     * Scrub every recipient-facing value before it becomes an email.
     *
     * Done on the RESOLVED VARIABLES rather than on the finished text. SAM API
     * URLs are rewritten to the public ones and contracting-officer details are
     * removed, so a subcontractor never emails the agency directly. It has to
     * happen here, not after substitution: once the template is rendered, the
     * operator's own phone number is indistinguishable from the contracting
     * officer's, and a pass over the assembled email censors Brost Co's contact
     * details out of Brost Co's own message.
     *
     * Note `trade` is scrubbed for display only. The original value still
     * drives attachment filtering and must keep its exact spelling.
     */
    let contactsRedacted = 0;
    const scrubValue = (value: string): string => {
      const { sanitised, count } = scrubGovtContacts(rewriteSamUrls(value));
      contactsRedacted += count;
      return scrubInternalFailureCopy(sanitised);
    };

    const vars: Record<string, string> = Object.fromEntries(
      Object.entries(resolved.vars).map(([key, value]) => [key, scrubValue(value)])
    );

    /*
     * The scope is the email's reason to exist. If scrubbing took it, there is
     * nothing left to ask a price for, and a cheerful note with no scope in it
     * is worse than no note at all.
     */
    if (!vars.scope_summary.trim() || !vars.trade_scope_requirements.trim()) {
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

    /*
     * The sections appended beneath the operator's introduction: project,
     * scope, requirements, questions, what to send back, and the document
     * list. Built from the scrubbed variables so the two halves of the email
     * can never disagree about a date or a scope.
     */
    const sections = buildOutreachSections({
      vars,
      scopeBoundary: scrubValue(resolved.scopeBoundary),
      attachedNames: gathered.files.map((f) => f.filename),
      links: gathered.links,
      pricingScheduleRequired: resolved.requirements.subRequirements.some((r) =>
        /pricing schedule|quote format/i.test(r.text)
      ),
    });

    // Every value was scrubbed on its way into `vars` above. The assembled
    // email is never scrubbed again, for the reason given there.
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

    const details = renderOutreachBrief(sections);
    const fullPlain = plainBody + details.plain;
    const html = plainToHtml(plainBody) + details.html;

    /*
     * The last gate, on the finished text rather than on intentions.
     *
     * Everything above works with values and structures; this reads what the
     * subcontractor will actually read. A token that survived substitution, a
     * leaked "undefined", the editor's sample solicitation number, a quote
     * deadline that is not before the bid deadline, or a document-bearing
     * solicitation with nothing attached all stop the send here. Each of those
     * produces an email that reads perfectly well, which is exactly why a
     * human reviewing the copy would not catch them.
     */
    const sendProblems = validateOutboundEmail({
      subject,
      body: fullPlain,
      vars,
      missingRequired: resolved.missingRequired,
      attachedNames: gathered.files.map((f) => f.filename),
      linkNames: gathered.links.map((l) => l.name),
      documentsExpected: gathered.expected,
      quoteDueAt: resolved.quote.at,
      deadlineAt: opp.deadline,
      sampleValues: OUTREACH_VAR_SAMPLES,
    });
    if (sendProblems.length) {
      const why = describeProblems(sendProblems);
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
        message: `Refused to email ${sub.company_name}: the assembled email did not pass its final check. ${why}`,
        reasoning: sendProblems.map((p) => p.kind).join(", "),
      });
      return {
        ok: true,
        summary: `Held outreach to ${sub.company_name}: ${why}`,
        humanActionRequired: true,
        data: { problems: sendProblems.map((p) => p.kind) },
      };
    }

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
          recipient_email, meta, rfc822_message_id, delivery_state)
       values ($1,$2,'email','outbound',$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)`,
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
        /*
         * Everything the follow-up needs to reconstruct this conversation
         * without guessing.
         *
         * The trade is here so a reply's outcome lands on the right trade line
         * rather than on every trade this sub was approached for on the same
         * solicitation. The rest is the identifier set the 48-hour follow-up
         * reads: which mailbox this went out from, the exact quote deadline
         * the recipient was given (so the chaser repeats it rather than
         * recomputing a different one from a clock that has since moved), and
         * the attachment manifest, so a fallback into a new thread can send
         * the same package rather than a shorter one.
         */
        JSON.stringify({
          ...(trade ? { trade } : {}),
          ...(resolved.quote.at ? { quote_due_at: resolved.quote.at } : {}),
          ...(vars.quote_due_date ? { quote_due_label: vars.quote_due_date } : {}),
          ...(profile.outreach_email ? { sender_email: profile.outreach_email } : {}),
          attachments: gathered.files.map((f) => f.filename),
          ...(gathered.links.length
            ? { document_links: gathered.links.map((l) => ({ name: l.name, url: l.url })) }
            : {}),
        }),
        // The real Message-ID header, so the 48h follow-up can thread under
        // this exact email in the subcontractor's own mail client.
        rfc822MessageId,
        // A draft or a failed send is NOT "sent". Recording it as sent is what
        // let an outreach that never left the building look identical on
        // screen to one that did.
        sent ? "sent" : "failed",
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
