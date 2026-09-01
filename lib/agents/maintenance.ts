/**
 * Maintenance jobs, not part of the 13-agent roster, but the plumbing that
 * keeps time-based workflows moving:
 *   - outreach-followup : send the automated 48-hour follow-up (spec step 6)
 *   - review-expiry-sweep : auto-dismiss review-tier items after the timer (spec)
 *   - reply-poll : detect sub replies via Gmail, mark responsive, trigger Call Prep
 */
import { query, queryOne, transaction } from "../db";
import { recordUnmatched } from "../needs-matching";
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
 *
 * The fallback belongs to a genuinely empty list. It used to cover a failed
 * lookup too, so a database hiccup on this one statement meant every customer
 * was skipped and the sweep ran against the founding org alone, reporting
 * success. `orgsToSweep` keeps the two apart and logs the failure.
 */
async function activeOrgIds(): Promise<string[]> {
  const { orgs } = await orgsToSweep("maintenance");
  return orgs.length ? orgs.map((o) => o.id) : [LEGACY_ORG_ID];
}
import { listActiveOrganizations } from "../organizations";
import { orgsToSweep } from "./org-fanout";
import {
  applyOutcomeToSolicitation,
  recordReplyEvent,
  blockingGaps,
  OUTCOME_LABEL,
} from "../domain/reply-outcome";
import { requestClarification, describeGap } from "../domain/reply-clarify";
import { readsAsOptOut, suppressEmail } from "../domain/email-suppression";
import { looksLikeBounce, parseBounce, type BounceReport } from "../domain/email-delivery";
import { readReplyAttachments, combineReplyText } from "../domain/reply-attachments";
import { advanceIfQuotesComplete, closeIfSubsExhausted } from "../domain/advance-stage";
import { STALL_HOURS, STAGE_AGENT, STALL_REASONING } from "../domain/journey";
import { areCallsEnabled, getAutomationRules } from "../app-settings";
import { enqueue } from "../queue";
import { sendPendingApproved, sendFollowUps } from "../backlink-send";
import { getProfileJson } from "../ai/companyProfile";
import { outreachDisplayName } from "../domain/solicitation-completeness";
import {
  scrubInternalFailureCopy,
  renderOutreachBrief,
} from "../domain/outreach-email";
import { scrubGovtContacts, rewriteSamUrls } from "../integrations/scrub-contacts";
import { resolveOutreachVars } from "../domain/outreach-vars";
import { buildOutreachSections } from "../domain/outreach-sections";
import { gatherTradeAttachments } from "../opportunity-attachments";
import type { Opportunity } from "../types";
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
    /*
     * Deliberately not caught. An empty list here means no customers; a
     * failure means we could not find out who they are, and swallowing it
     * turned a stopped sweep into "0 processed", which is what a quiet night
     * looks like. Letting it throw hands it to the runner, which logs it at
     * error status and marks the run failed.
     */
    const orgs = await listActiveOrganizations();
    let sentTotal = 0;
    let dueTotal = 0;
    let lastCalls = 0;
    for (const org of orgs) {
      const res = await runWithOrg(org.id, () => followUpForOrg(org.id));
      sentTotal += res.sent;
      dueTotal += res.due;
      /*
       * The third message is gated twice, and both gates were missing.
       *
       * `final_nudge_enabled` is off by default: see the rule's own comment
       * for why this message cannot currently be turned on.
       *
       * `followup_max` is the second gate, and its absence was a plain
       * contradiction. followUpForOrg returns early at `followup_max <= 0`,
       * which is the operator having said "never chase". This call sat on the
       * next line, outside that check, so an account configured never to
       * follow up still sent a third email. The setting said one thing and the
       * product did another.
       */
      const nudgeRules = await runWithOrg(org.id, () => getAutomationRules());
      if (nudgeRules.final_nudge_enabled && nudgeRules.followup_max > 0) {
        lastCalls += await runWithOrg(org.id, () => lastCallForOrg(org.id)).catch(() => 0);
      }
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
        and coalesce(o.pursuit_state, 'active') = 'active'
        and o.stage not in ('dismissed', 'submitted', 'won', 'lost')
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
      // Re-checked at the provider boundary, not trusted from job start.
      opportunityId: row.opportunity_id,
      subcontractorId: row.subcontractor_id ?? undefined,
      trade: row.trade ?? null,
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

/**
 * Record a delivery failure against the message it belongs to.
 *
 * Correlation is tried strongest-first: the RFC822 Message-ID the DSN quotes
 * is exact, the Gmail thread is next, and the failed recipient address is the
 * fallback for reports that quote neither. Nothing is written when none of
 * them match, because marking the wrong outreach bounced would send an
 * operator chasing a contact who is perfectly reachable.
 *
 * A PERMANENT failure also suppresses the address. That is the point of
 * bounce handling: continuing to mail a dead address is what builds the
 * complaint rate that moves a whole sending domain into spam. A transient
 * failure (full mailbox, greylisting) never suppresses -- it would lose a
 * live subcontractor over one bad afternoon.
 */
async function recordBounce(input: {
  orgId: string;
  threadId: string;
  report: BounceReport;
}): Promise<void> {
  const { orgId, threadId, report } = input;
  const state = report.permanent ? "bounced" : "deferred";

  const updated = await query<{ id: string; recipient_email: string | null }>(
    `update communications
        set delivery_state = $2, delivery_detail = $3, delivery_updated_at = now()
      where id = (
        select c.id from communications c
         where c.org_id = $1
           and c.direction = 'outbound'
           and (
             ($4::text is not null and c.rfc822_message_id = $4)
             or ($5::text <> '' and c.gmail_thread_id = $5)
             or ($6::text is not null and lower(c.recipient_email) = $6)
           )
         order by
           -- exact Message-ID first, then thread, then address
           (case when $4::text is not null and c.rfc822_message_id = $4 then 0
                 when $5::text <> '' and c.gmail_thread_id = $5 then 1
                 else 2 end),
           c.created_at desc
         limit 1
      )
      returning id, recipient_email`,
    [
      orgId,
      state,
      report.reason,
      report.originalMessageId,
      threadId ?? "",
      report.recipient,
    ]
  ).catch((err) => {
    console.error(`[maintenance] bounce write failed: ${(err as Error).message}`);
    return [] as { id: string; recipient_email: string | null }[];
  });

  if (updated.length === 0) {
    // Say so rather than dropping it: an unmatched bounce still means mail is
    // failing somewhere, and silence here is how that stays invisible.
    console.warn(
      `[maintenance] unmatched bounce for org ${orgId} (${report.recipient ?? "unknown recipient"}): ${report.reason}`
    );
    return;
  }

  const address = report.recipient ?? updated[0].recipient_email;
  if (report.permanent && address) {
    await suppressEmail({
      orgId,
      email: address,
      reason: `Hard bounce: ${report.reason}`,
      source: "bounce",
    }).catch((err) =>
      console.error(`[maintenance] bounce suppression failed: ${(err as Error).message}`)
    );

    /*
     * A dead address is not a verified one.
     *
     * Suppression stopped us mailing it again, which protects the sending
     * domain, and there it stopped. The subcontractor kept its "Email
     * verified" badge on the roster and on its own record, because nothing in
     * bounce handling has ever touched the subcontractors table -- so the one
     * place an operator looks to decide "can I reach this firm" went on
     * saying yes about an address the receiving server had refused outright.
     */
    await query(
      `update subcontractors
          set email_verified = false
        where org_id = $1 and lower(email) = $2 and email_verified`,
      [orgId, address.toLowerCase()]
    ).catch((err) =>
      console.error(`[maintenance] bounce unverify failed: ${(err as Error).message}`)
    );

    /*
     * And the outreach it belonged to is not "contacted".
     *
     * outreach_state stayed at 'sent', which sits inside the CONTACTED set in
     * lib/domain/trade-coverage.ts, so a trade whose only subcontractor hard
     * bounced still read as covered. The bid then advanced on coverage that
     * did not exist. 'send_failed' is the state outreach itself already uses
     * when a send fails outright, and it is the truth here too.
     */
    await query(
      `update opportunity_subs os
          set outreach_state = 'send_failed'
         from subcontractors s
        where s.id = os.subcontractor_id
          and s.org_id = $1
          and lower(s.email) = $2
          -- Only rows that claim contact was MADE. 'pending' has not been sent
          -- yet and suppression already stops it, and a row that reached
          -- 'responsive' or 'quoted' has a human-written reply behind it that
          -- a later bounce on the same address must not erase.
          and os.outreach_state in ('sent','followed_up')`,
      [orgId, address.toLowerCase()]
    ).catch((err) =>
      console.error(`[maintenance] bounce coverage update failed: ${(err as Error).message}`)
    );
  }

  await logAgent({
    agent: "maintenance",
    action: "email-bounce",
    level: report.permanent ? "warn" : "info",
    message: report.permanent
      ? `Email to ${address ?? "a subcontractor"} bounced permanently and the address was suppressed. ${report.reason}`
      : `Email to ${address ?? "a subcontractor"} was delayed. ${report.reason}`,
  }).catch(() => {});
}

async function followUpForOrg(orgId: string): Promise<{ sent: number; due: number }> {
  // Template resolution is org-aware (own copy, else platform default) so a
  // follow-up never goes out with another tenant's wording.
  const { activeTemplate } = await import("../domain/template-store");
  const { getAutomationRules } = await import("../app-settings");
  const [tmpl, fallbackTmpl, profile, rules] = await Promise.all([
    activeTemplate("template_2_followup", orgId),
    activeTemplate("template_2_followup_new_thread", orgId),
    getProfileJson(),
    getAutomationRules(),
  ]);
  // Chasing switched off entirely. Markers already on file are left alone
  // rather than cleared: turning the rule back on should resume the queue it
  // was paused with, not start from an empty one.
  if (rules.followup_max <= 0) return { sent: 0, due: 0 };

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
    // Enough of the opportunity to rebuild a self-contained email if the
    // original thread turns out to be unusable.
    opp_title: string | null;
    agency: string | null;
    solicitation_number: string | null;
    location_text: string | null;
    description: string | null;
    solicitation_analysis: unknown;
    /** The quote date the recipient was actually given on the first email. */
    orig_quote_due_label: string | null;
    orig_quote_due_at: string | null;
  }>(
    `select c.id, c.subcontractor_id, c.opportunity_id, c.tracking_id,
            s.email, s.email_verified, s.owner_name as sub_owner_name,
            os.trade, o.location_state, o.deadline,
            c.subject as orig_subject, c.gmail_thread_id, c.rfc822_message_id,
            o.title as opp_title, o.agency, o.solicitation_number,
            o.location_text, o.description, o.solicitation_analysis,
            c.meta->>'quote_due_label' as orig_quote_due_label,
            c.meta->>'quote_due_at' as orig_quote_due_at
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
        and o.status = 'open'
        and coalesce(o.pursuit_state, 'active') = 'active'
        and o.stage not in ('dismissed', 'submitted', 'won', 'lost')
        /*
         * Has this firm answered us about this job AT ALL?
         *
         * replied_at above only says "nobody replied to THIS message". A
         * subcontractor who answered the follow-up rather than the original,
         * or who wrote in on a second thread, leaves the first row's
         * replied_at null forever -- so we chased people who had already
         * quoted. Any inbound message on the pair settles it, whichever of
         * our messages it was addressed to.
         */
        and not exists (
          select 1 from communications r
           where r.org_id = c.org_id
             and r.direction = 'inbound'
             and r.subcontractor_id = c.subcontractor_id
             and r.opportunity_id is not distinct from c.opportunity_id
        )
        /*
         * And has the pairing already reached an outcome? A sub marked
         * responsive, quoted, declined or closed out has been dealt with, and
         * nudging them after that reads as though nobody was listening.
         */
        and not exists (
          select 1 from opportunity_subs os2
           where os2.opportunity_id = c.opportunity_id
             and os2.subcontractor_id = c.subcontractor_id
             and os2.outreach_state in
                 ('responsive','quoted','responded','declined','not_a_fit','unavailable')
        )
      limit $2`,
    [orgId, rules.outreach_batch_limit]
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

    /*
     * Ask again, immediately before sending.
     *
     * The selection above ran once for up to fifty rows, and a quote can
     * arrive during the seconds it takes to work through them. Re-reading
     * here closes that window: the alternative is a "just following up, have
     * you had a chance to price this?" landing minutes after the price did,
     * which is the single most conspicuous way for software to look like it
     * is not paying attention. Two reads of the same fact are cheap; that
     * email cannot be recalled.
     */
    const answered = await queryOne<{ n: number }>(
      `select (
         (select count(*) from communications r
           where r.org_id = $1 and r.direction = 'inbound'
             and r.subcontractor_id = $2
             and r.opportunity_id is not distinct from $3)
       + (select count(*) from opportunity_subs os2
           where os2.opportunity_id = $3 and os2.subcontractor_id = $2
             and os2.outreach_state in
                 ('responsive','quoted','responded','declined','not_a_fit','unavailable'))
       )::int as n`,
      [orgId, row.subcontractor_id, row.opportunity_id]
    ).catch(() => null);
    if ((answered?.n ?? 0) > 0) continue;

    /*
     * Can this follow-up actually go INSIDE the original conversation?
     *
     * This is decided first, because it decides which email gets written.
     * Threading needs both halves: `threadId` groups it in OUR mailbox (what
     * the in-app conversation view reads), and `In-Reply-To` is what the
     * RECIPIENT's client threads on. Having only the first is the trap: the
     * conversation view looks perfect while the subcontractor receives an
     * unconnected email every time. That is the "follow-ups start new threads"
     * report, and it is invisible from our side.
     *
     * Recover a missing Message-ID rather than send without one.
     * rfc822_message_id is read back from Gmail after the original send, and
     * that read can fail: a grant issued before gmail.readonly was requested
     * cannot do it at all, and older rows predate the read entirely. So when
     * the column is empty and we know the thread, ask Gmail what our own last
     * message in it was, and write the answer back so the next follow-up needs
     * no repair.
     */
    let inReplyTo = row.rfc822_message_id ?? null;
    let references: string[] = [];
    if (row.gmail_thread_id) {
      const recovered = await gmail
        .threadMessageId(row.gmail_thread_id, orgId)
        .catch(() => ({ rfc822MessageId: null, references: [] as string[] }));
      references = recovered.references;
      if (!inReplyTo && recovered.rfc822MessageId) {
        inReplyTo = recovered.rfc822MessageId;
        await query(`update communications set rfc822_message_id = $2 where id = $1`, [
          row.id,
          inReplyTo,
        ]).catch(() => {});
      }
    }

    // Gmail also requires the subject to match the thread it is joining.
    const threadSubject = row.orig_subject?.trim()
      ? /^re:/i.test(row.orig_subject.trim())
        ? row.orig_subject.trim()
        : `Re: ${row.orig_subject.trim()}`
      : null;

    const canReplyInThread = Boolean(row.gmail_thread_id && inReplyTo && threadSubject);
    const threadGap = !row.gmail_thread_id
      ? "no Gmail thread was recorded for the original message"
      : !inReplyTo
        ? "the original message's RFC822 Message-ID could not be recovered, so the recipient's mail client would not attach the reply to the conversation"
        : !threadSubject
          ? "the original message had no subject to inherit"
          : "";

    /*
     * Everything the email might need, resolved the same way the first one
     * was. The follow-up used to build its own short vars map with
     * opportunity_title, agency, scope_summary and questions hard-coded to
     * empty strings, so any template referencing them silently lost the
     * sentence containing them.
     */
    const resolved = resolveOutreachVars({
      sub: { owner_name: row.sub_owner_name },
      opportunity: {
        title: row.opp_title,
        agency: row.agency,
        solicitation_number: row.solicitation_number,
        location_state: row.location_state,
        location_text: row.location_text,
        deadline: row.deadline,
      },
      analysis: (row.solicitation_analysis ?? undefined) as never,
      profile: profile ?? {},
      trade: row.trade,
      description: row.description,
    });

    const vars: Record<string, string> = Object.fromEntries(
      Object.entries(resolved.vars).map(([k, v]) => [
        k,
        scrubInternalFailureCopy(scrubGovtContacts(rewriteSamUrls(v)).sanitised),
      ])
    );

    /*
     * Repeat the date they were given, do not recompute one.
     *
     * The quote deadline is derived from a clock, and this runs 48 hours after
     * the first email. Recomputing it would move the date, and a chaser that
     * quietly brings the deadline forward reads as either a mistake or a
     * squeeze. The stored label is what the recipient has in writing.
     */
    if (row.orig_quote_due_label) vars.quote_due_date = row.orig_quote_due_label;

    const useFallback = !canReplyInThread;
    const chosen = useFallback ? (fallbackTmpl ?? tmpl) : tmpl;

    let subject: string;
    let html: string;
    let plain: string;
    let attachments: Awaited<ReturnType<typeof gatherTradeAttachments>>["files"] = [];
    let attachedNames: string[] = [];

    if (chosen) {
      const renderedSubject = renderTemplate(
        chosen.subject ?? "Re: our quote request",
        vars
      );
      const body = scrubInternalFailureCopy(renderTemplate(chosen.body, vars));

      if (useFallback) {
        /*
         * A new thread means the recipient has nothing above this email. It
         * has to stand entirely on its own: the same scope, the same
         * requirements, the same questions and the same document package the
         * first email carried. A short chaser referring to "the original
         * message below" when there is no message below is worse than not
         * following up at all.
         */
        const opp = await queryOne<Opportunity>(
          `select * from opportunities where id = $1`,
          [row.opportunity_id]
        ).catch(() => null);
        const gathered = opp
          ? await gatherTradeAttachments(opp, row.trade ?? "").catch(() => ({
              files: [],
              links: [],
              expected: false,
            }))
          : { files: [], links: [], expected: false };
        attachments = gathered.files;
        attachedNames = gathered.files.map((f: { filename: string }) => f.filename);

        const sections = buildOutreachSections({
          vars,
          scopeBoundary: resolved.scopeBoundary,
          attachedNames,
          links: gathered.links,
        });
        const details = renderOutreachBrief(sections);
        subject = renderedSubject || "Following up on our quote request";
        plain = body + details.plain;
        html = plainToHtml(body) + details.html;

        await logAgent({
          agent: "outreach-followup",
          action: "new-thread",
          level: "warn",
          opportunityId: row.opportunity_id,
          subcontractorId: row.subcontractor_id,
          message: `Followed up with a new email rather than a reply because ${threadGap}. The full scope and ${attachedNames.length} document(s) were sent again so the message stands on its own.`,
        });
      } else {
        subject = threadSubject!;
        plain = body;
        html = plainToHtml(body);
      }
    } else {
      // No template at all. Minimal, and never pretending to be a reply.
      const greeting = vars.owner_name || "there";
      subject = threadSubject ?? "Following up on our quote request";
      plain = `Hi ${greeting},\n\nJust following up on my previous email. Happy to answer any questions or set up a quick call.\n\n${vars.sender_name}`;
      html = plainToHtml(plain);
    }

    const res = await sendOutreachEmail({
      to: row.email,
      subject,
      html,
      trackingId: row.tracking_id ?? undefined,
      orgId,
      // Only claim the thread when we can actually join it. Passing a threadId
      // without an In-Reply-To groups the message in our mailbox and nowhere
      // else, which is precisely the failure that looks fine from here.
      threadId: canReplyInThread ? row.gmail_thread_id ?? undefined : undefined,
      inReplyTo: canReplyInThread ? inReplyTo ?? undefined : undefined,
      references: canReplyInThread ? references : [],
      attachments: attachments.length ? attachments : undefined,
      // Re-checked at the provider boundary: assembling this packet takes
      // long enough for an abort to land in between.
      opportunityId: row.opportunity_id,
      subcontractorId: row.subcontractor_id ?? undefined,
      trade: row.trade ?? null,
    });
    if (!res.disabled && !res.error) {
      /*
       * Does the rule allow another one after this?
       *
       * Follow-ups sent so far, counted from the record rather than tracked in
       * a column, because the record is what a subcontractor experienced. When
       * the count is still below the limit the NEW row carries the next marker,
       * which is how a second and third chase happen at all: the old code
       * consumed the marker and never wrote another, so "one follow-up" was
       * structural rather than chosen.
       */
      const priorRow = await queryOne<{ n: number }>(
        `select count(*)::int as n from communications
          where org_id = $1 and direction = 'outbound' and channel = 'email'
            and subcontractor_id = $2
            and opportunity_id is not distinct from $3
            and meta->>'kind' = 'followup'`,
        [orgId, row.subcontractor_id, row.opportunity_id]
      ).catch(() => null);
      // This send is not on the record yet, so it counts itself.
      const sentSoFar = (priorRow?.n ?? 0) + 1;
      const nextFollowUpAt =
        sentSoFar < rules.followup_max
          ? new Date(Date.now() + rules.followup_hours * 3_600_000).toISOString()
          : null;
      await query(
        // gmail_thread_id + rfc822_message_id are carried forward so a SECOND
        // follow-up chains onto this one rather than restarting the thread.
        `insert into communications (subcontractor_id, opportunity_id, channel, direction, subject, body, gmail_message_id, provider, meta, gmail_thread_id, rfc822_message_id, follow_up_at)
         values ($1,$2,'email','outbound',$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
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
          /*
           * Same reason the initial outreach stamps the trade: a reply to THIS
           * email must land its outcome on this trade line, not on every trade
           * the sub was approached for. `threaded` records which of the two
           * follow-ups this was, so "why did they get a second full email"
           * has an answer on the record rather than only in the log.
           */
          JSON.stringify({
            kind: "followup",
            ...(row.trade ? { trade: row.trade } : {}),
            threaded: canReplyInThread,
            ...(useFallback && threadGap ? { new_thread_reason: threadGap } : {}),
            ...(attachedNames.length ? { attachments: attachedNames } : {}),
            ...(row.orig_quote_due_at ? { quote_due_at: row.orig_quote_due_at } : {}),
            ...(row.orig_quote_due_label
              ? { quote_due_label: row.orig_quote_due_label }
              : {}),
          }),
          res.threadId ?? row.gmail_thread_id ?? null,
          // Fall back to what we just threaded under. If the read-back failed
          // again, the next follow-up would otherwise find another null and
          // repeat the recovery; keeping the parent here means the chain is
          // never empty, and threadMessageId() repairs it properly next time.
          res.rfc822MessageId ?? inReplyTo ?? null,
          nextFollowUpAt,
        ]
      );

      /*
       * Confirm, after the fact, that the reply actually joined the thread.
       *
       * Gmail can accept a send and still place it in a new conversation: a
       * threadId belonging to a different mailbox, a subject that no longer
       * matches, a thread that has since been deleted. Everything up to here
       * checked what we INTENDED to send. This checks what Gmail did with it,
       * which is the only claim worth making, and it is cheap because the
       * answer is already in the response.
       */
      if (canReplyInThread && res.threadId && res.threadId !== row.gmail_thread_id) {
        await logAgent({
          agent: "outreach-followup",
          action: "thread-broken",
          level: "warn",
          opportunityId: row.opportunity_id,
          subcontractorId: row.subcontractor_id,
          message:
            `The follow-up to ${row.email} was sent as a reply but Gmail placed it in a different conversation ` +
            `(asked for ${row.gmail_thread_id}, got ${res.threadId}). The subcontractor will have received it ` +
            `without the original scope above it. Check that the Gmail account still holds the original thread.`,
        });
      }

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
    } else if (res.disabled) {
      // The pursuit was paused, aborted, passed, or expired between the
      // due-list and the send. Leave the marker consumed so the next sweep
      // does not try again. Restoring it is how a closed job keeps emailing.
      await logAgent({
        agent: "outreach-followup",
        action: "send",
        level: "info",
        opportunityId: row.opportunity_id,
        subcontractorId: row.subcontractor_id,
        message: `Follow-up was not sent because this opportunity is no longer active. ${res.error ?? ""}`.trim(),
      });
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
    /*
     * Deliberately not caught. An empty list here means no customers; a
     * failure means we could not find out who they are, and swallowing it
     * turned a stopped sweep into "0 processed", which is what a quiet night
     * looks like. Letting it throw hands it to the runner, which logs it at
     * error status and marks the run failed.
     */
    const orgs = await listActiveOrganizations();
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
  description:
    "Warns before a review-tier opportunity expires, and dismisses it only if the account has turned automatic dismissal on.",
  worksWithoutClaude: true,
  /**
   * Two changes from the version that ran unconditionally.
   *
   * It is off unless the organization turns it on. The old sweep dismissed
   * every expired review item on every account: an opportunity left over a
   * weekend vanished from the board, and the only record was a log line nobody
   * reads until something has already gone wrong. An operator who has not
   * decided has not decided.
   *
   * And when it is on, it warns first. An item whose timer has passed but
   * which has never been warned is warned, not dismissed; the dismissal
   * happens on a later run. That costs one sweep interval and buys the
   * guarantee that nothing is removed without notice, which is what makes the
   * difference between an automatic action and a disappearance.
   */
  async handler(): Promise<AgentResult> {
    // Per organization: the UPDATE and its audit log both stay inside one
    // tenant. A single platform-wide statement would touch every tenant's
    // opportunities at once and log each auto-dismiss with no org, so the
    // customer whose opportunity vanished would never see why in their own
    // Automation Log.
    const orgs = await activeOrgIds();
    let warned = 0;
    let dismissed = 0;
    let heldForOperator = 0;
    for (const orgId of orgs) {
      const rules = await runWithOrg(orgId, () => getAutomationRules());

      /*
       * The warning goes out whether or not automatic dismissal is on.
       *
       * With it off the timer still means something: it is the account's own
       * measure of when a decision has gone stale, and telling somebody their
       * review window has closed is useful even when nothing will act on it.
       */
      const warnable = await runWithOrg(orgId, () =>
        query<{ id: string; title: string | null }>(
          `update opportunities
              set review_warned_at = now()
            where org_id = $1 and tier='review' and human_action_required=true
              and review_expires_at is not null
              and review_warned_at is null
              and review_expires_at <= now() + make_interval(hours => $2)
            returning id, title`,
          [orgId, rules.auto_dismiss_warn_hours]
        )
      );
      for (const o of warnable) {
        await runWithOrg(orgId, () =>
          logAgent({
            agent: "review-expiry-sweep",
            action: "expiry-warning",
            opportunityId: o.id,
            level: "warn",
            message: rules.auto_dismiss_review
              ? `"${o.title ?? o.id}" has not been decided and will be dismissed automatically when its timer passes.`
              : `"${o.title ?? o.id}" has passed its review window and is still waiting on a decision.`,
            reasoning:
              "Warned before any automatic action, so a record can never leave the board without notice.",
          })
        );
      }
      warned += warnable.length;

      if (!rules.auto_dismiss_review) {
        /*
         * Counted and reported rather than passed over in silence. An account
         * with forty expired review items is looking at a queue nobody is
         * working, and a sweep that says "0 dismissed" without saying why
         * reads as a healthy account.
         */
        const held = await runWithOrg(orgId, () =>
          queryOne<{ n: number }>(
            `select count(*)::int as n from opportunities
              where org_id = $1 and tier='review' and human_action_required=true
                and review_expires_at is not null and review_expires_at <= now()`,
            [orgId]
          )
        );
        heldForOperator += held?.n ?? 0;
        continue;
      }

      const expired = await runWithOrg(orgId, () =>
        query<{ id: string; title: string | null }>(
          `update opportunities
              set stage='dismissed', status='archived', human_action_required=false
            where org_id = $1 and tier='review' and human_action_required=true
              and review_expires_at is not null and review_expires_at <= now()
              -- Never on the same pass that warned. The warning has to have
              -- been out for at least one interval, or "we warned you" is
              -- something the log says and the operator never saw.
              and review_warned_at is not null and review_warned_at < now()
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
            message: `Auto-dismissed review-tier item "${o.title ?? o.id}" (timer expired, warning issued).`,
            reasoning:
              "The account has automatic dismissal switched on and this record was warned before the timer passed.",
          })
        );
      }
      dismissed += expired.length;
    }
    const parts = [`warned ${warned}`, `dismissed ${dismissed}`];
    if (heldForOperator > 0) {
      parts.push(`${heldForOperator} past their window and kept for a person to decide`);
    }
    return { ok: true, summary: `Review expiry: ${parts.join(", ")}.` };
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
    /*
     * Deliberately not caught. An empty list here means no customers; a
     * failure means we could not find out who they are, and swallowing it
     * turned a stopped sweep into "0 processed", which is what a quiet night
     * looks like. Letting it throw hands it to the runner, which logs it at
     * error status and marks the run failed.
     */
    const orgs = await listActiveOrganizations();
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
    /*
     * Deliberately not caught. An empty list here means no customers; a
     * failure means we could not find out who they are, and swallowing it
     * turned a stopped sweep into "0 processed", which is what a quiet night
     * looks like. Letting it throw hands it to the runner, which logs it at
     * error status and marks the run failed.
     */
    const orgs = await listActiveOrganizations();
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
              pursuit_state='aborted',
              pursuit_reason='expired',
              pursuit_changed_at=now(),
              risk_flags = (select array(select distinct unnest(coalesce(risk_flags,'{}') || array['expired'])))
        where org_id = $1
          and status='open'
          and stage not in ('submitted','won','lost')
          and deadline is not null and deadline < now()
          and not exists (
                select 1 from bids b
                 where b.opportunity_id = opportunities.id
                   and (
                     b.submitted_at is not null
                     or coalesce(b.submission_state, '') in
                        ('sending','sent','receipt_confirmed','accepted')
                   )
              )
        returning id, title, stage, deadline`,
      [orgId]
    );
    if (expired.length > 0) {
      const { stopOpportunityAutomation } = await import("../close-opportunity-work");
      await stopOpportunityAutomation(
        orgId,
        expired.map((o) => o.id),
        "expired"
      );
    }
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

/**
 * Accounts whose deletion grace period has run out.
 *
 * Separate from the retention sweep because it deletes a different thing for a
 * different reason: retention removes old archived records inside a live
 * account on that customer's own setting, this removes a whole account an
 * administrator decided to close. Sharing one agent would mean a customer
 * setting retention to nought could not tell which of the two it disabled.
 *
 * Each account is purged in its own try, so one that fails does not strand the
 * rest, and a failure leaves the schedule in place: the next run tries again
 * rather than silently giving up on a deletion somebody is expecting.
 */
export const accountDeletionSweep: AgentDefinition = {
  name: "account-deletion-sweep",
  label: "Account Deletion Sweep",
  description:
    "Permanently deletes accounts whose scheduled deletion date has passed. An administrator schedules a deletion, the account is suspended immediately, and this removes the data once the grace period runs out. Cancelling before then leaves everything untouched.",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    const { accountsDueForPurge, purgeOrganization } = await import("../admin/accounts");
    const { recordAdminAction } = await import("../admin/audit");
    const due = await accountsDueForPurge();
    if (due.length === 0) {
      return { ok: true, summary: "No account has reached the end of its deletion window." };
    }
    const gone: string[] = [];
    const failed: string[] = [];
    for (const org of due) {
      try {
        await purgeOrganization(org.id);
        // Written after the purge and outside it, so the record of the
        // deletion cannot be rolled back along with the deletion.
        await recordAdminAction({
          adminEmail: "account-deletion-sweep",
          action: "account_deleted",
          orgId: org.id,
          orgName: org.name,
          detail: { via: "scheduled deletion, grace period elapsed" },
        });
        gone.push(org.name);
      } catch (err) {
        failed.push(`${org.name} (${err instanceof Error ? err.message : String(err)})`);
      }
    }
    return {
      ok: failed.length === 0,
      summary: [
        gone.length ? `Deleted ${gone.length}: ${gone.join(", ")}.` : null,
        failed.length ? `Failed ${failed.length}: ${failed.join("; ")}. Still scheduled.` : null,
      ]
        .filter(Boolean)
        .join(" "),
    };
  },
};

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
    /*
     * Deliberately not caught. An empty list here means no customers; a
     * failure means we could not find out who they are, and swallowing it
     * turned a stopped sweep into "0 processed", which is what a quiet night
     * looks like. Letting it throw hands it to the runner, which logs it at
     * error status and marks the run failed.
     */
    const orgs = await listActiveOrganizations();
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
    /*
     * Deliberately not caught. An empty list here means no customers; a
     * failure means we could not find out who they are, and swallowing it
     * turned a stopped sweep into "0 processed", which is what a quiet night
     * looks like. Letting it throw hands it to the runner, which logs it at
     * error status and marks the run failed.
     */
    const orgs = await listActiveOrganizations();
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
        // `automation-status` classifies on status, not level, so an error
        // logged without it is counted as a healthy run.
        status: "error",
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

      /**
       * A bounce is not a reply, and must be caught before reply handling.
       *
       * Left to fall through, a delivery-status report gets matched to a
       * subcontractor by thread and read as though they had written back: a
       * dead address then marks the outreach responsive and quietly satisfies
       * trade coverage nobody actually has. Worse, the operator sees a
       * "reply" and waits for a quote that can never come.
       */
      if (looksLikeBounce({
        from: r.from,
        subject: r.subject,
        contentType: r.contentType,
        body: r.body || r.snippet,
      })) {
        await recordBounce({
          orgId,
          threadId: r.threadId,
          report: parseBounce(r.body || r.snippet),
        });
        continue;
      }

      /*
       * In-Reply-To first, then the rest of References, newest cited ancestor
       * first. This is what makes matching survive a mailbox that groups
       * threads differently from ours, or a subcontractor replying from a
       * different address than the one we wrote to.
       */
      const referenceIds = [
        ...(r.inReplyTo ? [r.inReplyTo] : []),
        ...[...r.references].reverse(),
      ].filter(Boolean);

      const { comm, strongMatch } = await matchInboundReply({
        orgId,
        threadId: r.threadId,
        referenceIds,
        fromEmail,
      });
      if (!comm) {
        /*
         * Unmatched, and no longer silent.
         *
         * `continue` on its own is how a real reply disappears without
         * leaving a trace: nothing is written, nothing is counted, and the
         * only evidence it ever arrived is in the mailbox nobody is reading
         * on purpose. Most unmatched mail here is genuinely ours to ignore --
         * newsletters, a colleague, an automated notice -- so this is not an
         * error. But when the sender IS a subcontractor on this roster, we
         * emailed a firm and they wrote back and we failed to place it, and
         * that is worth an operator's attention every time.
         */
        const known = await queryOne<{ id: string; company_name: string }>(
          `select id, company_name from subcontractors
            where org_id = $1 and lower(email) = $2 limit 1`,
          [orgId, fromEmail]
        ).catch(() => null);
        /*
         * Into the Needs matching inbox, not into a log line.
         *
         * The warning that used to be written here was better than silence
         * and still the wrong home: an agent log is a stream somebody reads
         * when the automation is misbehaving, not a queue of work. It scrolled
         * away, carried no body, and the only instruction it could give was
         * "go and look in the mailbox".
         *
         * Filed whether or not the sender is on the roster. A firm writing
         * from an address we have never seen is exactly the message most
         * likely to be lost, and it is the one the roster check misses.
         */
        const filed = await recordUnmatched({
          orgId,
          fromEmail,
          fromName: r.from,
          subject: r.subject,
          body: r.body || r.snippet,
          gmailThreadId: r.threadId,
          messageId: r.messageId,
          subcontractorId: known?.id ?? null,
        }).catch(() => null);
        if (filed && known) {
          // A log line as well, but only for a known subcontractor and only
          // because this one is worth interrupting somebody about. The message
          // itself is in the inbox either way.
          await logAgent({
            agent: "maintenance",
            action: "reply-unmatched",
            level: "warn",
            status: "skipped",
            subcontractorId: known.id,
            message:
              `${known.company_name} <${fromEmail}> replied and the message could not be matched to any outreach we sent ` +
              `(subject "${(r.subject || "(no subject)").slice(0, 120)}"). It is waiting in Needs matching.`,
          }).catch(() => {});
        }
        continue;
      }
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

      /**
       * "Take me off your list" has to actually take them off the list.
       *
       * Without this a request to stop was, at best, a decline on one
       * solicitation: the next opportunity matching their trade emailed them
       * again. Suppression is recorded before the rest of the capture so it
       * holds even if anything downstream fails, and matching is deliberately
       * narrow -- an ordinary "not interested in this one" is a decline, not
       * an opt-out, and they should still hear about the next job.
       */
      if (fromEmail && readsAsOptOut(replyText)) {
        await suppressEmail({
          orgId,
          email: fromEmail,
          reason: "Asked to be removed in an email reply.",
          source: "reply",
        }).catch((err) =>
          console.error(`[maintenance] suppression write failed: ${(err as Error).message}`)
        );
      }
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
        // Capture re-checks for a bounce itself rather than trusting the
        // check above, so it needs the same evidence that check had.
        subject: r.subject,
        contentType: r.contentType,
        // The envelope, so the stored reply is the message and not a précis.
        fromAddress: r.from,
        toAddresses: r.to,
        ccAddresses: r.cc,
        sentAt: r.date,
        rfc822MessageId: r.rfc822MessageId,
        attachmentNames: (r.attachments ?? []).map((a) => a.filename),
        unreadableAttachments: docs.unreadable,
      });
      // Capture's own bounce guard caught what the check above missed. It
      // wrote nothing; record the delivery failure here instead, exactly as
      // the earlier branch would have.
      if (result.bounce) {
        await recordBounce({
          orgId,
          threadId: r.threadId,
          report: parseBounce(r.body || r.snippet),
        });
        continue;
      }
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
          const applied = await applyOutcomeToSolicitation({
            opportunityId: comm.opportunity_id,
            subcontractorId: subId,
            trade: comm.trade ?? null,
            outcome: decision.outcome,
          });
          /*
           * The reply was confident and still could not be applied, because
           * this firm is paired to several trades on this bid and the message
           * named none of them.
           *
           * A refusal that is not surfaced is the same as the old behaviour
           * with extra steps: the reply reads as handled, nothing changed, and
           * nobody knows. Raising it here is what turns "we could not tell
           * which trade" into somebody deciding.
           */
          if (!applied.applied && applied.refused === "ambiguous_trade") {
            reviewCount++;
            await query(
              `update subcontractor_reply_events
                  set needs_review = true, review_reason = $3
                where opportunity_id = $1 and subcontractor_id = $2
                  and reviewed_at is null`,
              [
                comm.opportunity_id,
                subId,
                `They are on this bid for ${applied.candidateTrades.join(", ")} and their reply did not say which. ` +
                  "Nothing was changed. Pick the trade this answer is about.",
              ]
            ).catch(() => {});
            await logAgent({
              agent: "reply-poll",
              action: "reply-trade-ambiguous",
              opportunityId: comm.opportunity_id,
              subcontractorId: subId,
              level: "warn",
              status: "skipped",
              message:
                `A reply could not be applied: this firm is on the bid for ${applied.candidateTrades.join(", ")} ` +
                "and the message named no trade. Marking every one of them would claim coverage nobody committed to.",
            }).catch(() => {});
          }
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
              /*
               * Seventy-two hours since we LAST wrote, not since we first did.
               *
               * Asking whether SOME outbound is older than 72h is satisfied by
               * the original outreach, which is always the oldest message in the
               * conversation. The follow-up goes out at 48 hours, so this
               * declared "No response" 24 hours after the follow-up while
               * claiming to wait 72 -- and a subcontractor who answers on the
               * third day, which is entirely normal, found themselves already
               * written off. Inverting it measures the wait from the most
               * recent thing we sent, which is what the sentence in the
               * agent's own description says.
               */
              and not exists (
                    select 1 from communications c
                     where c.opportunity_id = os.opportunity_id
                       and c.subcontractor_id = os.subcontractor_id
                       and c.channel = 'email'
                       and c.direction = 'outbound'
                       and c.created_at > now() - interval '72 hours'
                  )
              and exists (
                    select 1 from communications c
                     where c.opportunity_id = os.opportunity_id
                       and c.subcontractor_id = os.subcontractor_id
                       and c.channel = 'email'
                       and c.direction = 'outbound'
                  )
              /*
               * And nothing inbound on the pairing, whichever of our messages
               * it answered. outreach_state and responded_at are both things
               * WE maintain; an actual email from them is the fact. If one
               * exists, "no response" is simply false, and saying it puts a
               * live bidder in the dismissed column.
               */
              and not exists (
                    select 1 from communications r
                     where r.opportunity_id = os.opportunity_id
                       and r.subcontractor_id = os.subcontractor_id
                       and r.direction = 'inbound'
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
    /*
     * Deliberately not caught. An empty list here means no customers; a
     * failure means we could not find out who they are, and swallowing it
     * turned a stopped sweep into "0 processed", which is what a quiet night
     * looks like. Letting it throw hands it to the runner, which logs it at
     * error status and marks the run failed.
     */
    const orgs = await listActiveOrganizations();
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
