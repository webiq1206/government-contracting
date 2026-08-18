/**
 * Suggested replies to subcontractor emails.
 *
 * A sub writes back with questions ("what's the square footage?", "when does
 * this start?", "is prevailing wage on this one?") and the operator has to sit
 * down and answer each one from the solicitation. This drafts that answer.
 *
 * Three things shape the design:
 *
 * 1. It runs ONLY when the operator asks. Most replies never need a written
 *    answer, and generating one for every inbound message would spend money on
 *    mail nobody was going to write back to.
 *
 * 2. It does not re-read the email. The reply extractor already parsed the
 *    inbound message into intent, price, scope, exclusions, and open questions,
 *    and that structured result is stored. Re-parsing the raw text with a
 *    second model call would cost twice and could disagree with the extraction
 *    the rest of the app is acting on.
 *
 * 3. It answers questions but never commits. The operator asked for a helpful
 *    reply, not a hedge that says "let me get back to you" to everything a sub
 *    asks. So the draft may state facts from the solicitation, and may confirm
 *    a number the sub themselves quoted, but it must never name a price of our
 *    own, promise a schedule, or suggest the sub has won the work. Those are
 *    the operator's to give, and a model that gives one away in a friendly
 *    sentence has made a commitment on the company's behalf.
 *
 * Nothing here sends. The draft lands in the reply box the operator already
 * uses, and a person presses Send.
 */
import { query, queryOne } from "../db";
import { complete, ClaudeNotConfiguredError } from "../ai/claude";
import { config } from "../config";
import { logAgent } from "../logger";
import { getProfileJson } from "../ai/companyProfile";
import { scrubGovtContacts, rewriteSamUrls } from "../integrations/scrub-contacts";
import { buildOutreachPacket } from "./outreach-packet";
import { outreachDisplayName } from "./solicitation-completeness";
import { formatDeadlineLabel } from "./template-render";
import type { ExtractedReply } from "../ai/reply-extract";

/** A draft as the UI needs it. `body` is what belongs in the reply box. */
export interface ReplyDraft {
  communicationId: string;
  /** Operator's edit when they have made one, otherwise what was generated. */
  body: string;
  generatedBody: string;
  /** Rules the draft appears to break. Shown next to it, never a hard block. */
  warnings: string[];
  edited: boolean;
  generatedAt: string;
  /**
   * Revision of the stored text. The browser counts up from this, and an edit
   * only lands if it is newer than what is stored, so a slow write cannot
   * overwrite a fast one.
   */
  rev: number;
}

interface DraftRow {
  communication_id: string;
  generated_body: string;
  edited_body: string | null;
  warnings: string[] | null;
  generated_at: Date | string;
  rev: number | string;
}

function toDraft(row: DraftRow): ReplyDraft {
  const edited = row.edited_body != null;
  return {
    communicationId: row.communication_id,
    body: edited ? (row.edited_body as string) : row.generated_body,
    generatedBody: row.generated_body,
    warnings: row.warnings ?? [],
    edited,
    generatedAt: new Date(row.generated_at).toISOString(),
    // bigint arrives as a string from pg.
    rev: Number(row.rev ?? 0),
  };
}

/**
 * Every kept draft for a sub, keyed by the message it answers, so a page can
 * render existing drafts without a round trip per thread.
 */
export async function draftsForSubcontractor(
  subcontractorId: string,
  orgId: string | null
): Promise<Record<string, ReplyDraft>> {
  const rows = await query<DraftRow>(
    `select d.communication_id, d.generated_body, d.edited_body, d.warnings,
            d.generated_at, d.rev
       from reply_drafts d
       join communications c on c.id = d.communication_id
      where d.subcontractor_id = $1
        and ($2::uuid is null or d.org_id is null or d.org_id = $2::uuid)
        -- Only drafts for a message that is still the last word in its thread.
        -- Sending discards the draft, but a discard can fail, and a leftover
        -- row must not come back looking like unsent work one click from
        -- being mailed to the sub a second time. This makes that impossible
        -- rather than unlikely: once we have replied, the draft is unreadable.
        and not exists (
          select 1 from communications n
           where n.subcontractor_id = c.subcontractor_id
             and coalesce(n.gmail_thread_id, 'opp:' || coalesce(n.opportunity_id::text,'none'))
                 = coalesce(c.gmail_thread_id, 'opp:' || coalesce(c.opportunity_id::text,'none'))
             and n.created_at > c.created_at
        )`,
    [subcontractorId, orgId]
  );
  const out: Record<string, ReplyDraft> = {};
  for (const r of rows) out[r.communication_id] = toDraft(r);
  return out;
}

/**
 * Persist the operator's edit so navigating away does not throw away work they
 * have already put into the box.
 *
 * Each edit carries the revision it produces, and an older revision can never
 * replace a newer one. Ordering has to be decided here rather than by queueing
 * the requests in the browser, because the edit most worth keeping is the one
 * typed just before the page closes, and that one has to be fired off outside
 * any queue: there is no page left to wait on. A write that lost the race is
 * simply dropped.
 *
 * Returns "missing" when the draft is not theirs or does not exist, which the
 * route turns into a 404 rather than creating a row: an edit to a draft that
 * was never generated is a bug, not a new draft.
 */
export async function saveDraftEdit(input: {
  communicationId: string;
  orgId: string | null;
  body: string;
  rev: number;
}): Promise<"saved" | "stale" | "missing"> {
  const rows = await query<{ id: string }>(
    `update reply_drafts
        set edited_body = $3, rev = $4, updated_at = now()
      where communication_id = $1
        and ($2::uuid is null or org_id is null or org_id = $2::uuid)
        and rev < $4
      returning id`,
    [input.communicationId, input.orgId, input.body, input.rev]
  );
  if (rows.length > 0) return "saved";

  // Nothing updated: either the row is gone, or this write arrived after a
  // newer one. Those mean very different things to the caller.
  const exists = await queryOne<{ id: string }>(
    `select id from reply_drafts
      where communication_id = $1
        and ($2::uuid is null or org_id is null or org_id = $2::uuid)`,
    [input.communicationId, input.orgId]
  );
  return exists ? "stale" : "missing";
}

/**
 * Throw away any draft belonging to a thread, called from the send path once
 * the reply has actually gone out.
 *
 * This lives on the server, in the same request that sent the mail, rather
 * than as a tidy-up call from the browser. A discard the client fires and
 * forgets is a discard that does not happen when the tab is closed or the
 * network drops on the way, and the cost of it not happening is the sent text
 * reappearing on the next page load looking like unsent work, one click away
 * from being sent to the sub a second time.
 *
 * Scoped to the thread rather than one message id: whatever we were drafting
 * in this conversation has now been superseded by an actual reply.
 */
export async function discardDraftsForThread(input: {
  subcontractorId: string;
  threadId: string | null;
  opportunityId: string | null;
  orgId: string | null;
}): Promise<void> {
  await query(
    `delete from reply_drafts d
      using communications c
      where d.communication_id = c.id
        and c.subcontractor_id = $1
        and coalesce(c.gmail_thread_id, 'opp:' || coalesce(c.opportunity_id::text,'none'))
            = coalesce($2, 'opp:' || coalesce($3::text,'none'))
        and ($4::uuid is null or d.org_id is null or d.org_id = $4::uuid)`,
    [input.subcontractorId, input.threadId, input.opportunityId, input.orgId]
  );
}

// ---------------------------------------------------------------------------
// Output checks
// ---------------------------------------------------------------------------

/**
 * A price we did not get from the sub. Any dollar figure in the draft that is
 * not one the sub themselves put on the table is a number the model invented,
 * and a number in an email reads as an offer.
 */
const MONEY_RE = /\$\s?\d+(?:,\d{3})*(?:\.\d{1,2})?/g;

/**
 * A price written without a dollar sign. "45 an hour" and "12,500 dollars" are
 * offers too, and the sign is the easiest part to leave off. Bare numbers with
 * no unit are left alone: square footage and counts are facts, not prices.
 */
const RATE_RE =
  /\b(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:dollars|bucks|per\s+hour|an\s+hour|\/\s?hr|per\s+day|a\s+day|per\s+square\s+foot|per\s+sf|\/\s?sf)\b/gi;

/** Language that hands the sub the job. */
const AWARD_RE =
  /\b(?:you(?:'ve| have)?\s+(?:been\s+)?(?:awarded|selected|won)|you\s+have\s+the\s+(?:job|work|contract)|we(?:'re| are|'ll| will)\s+(?:award|going with|selecting|choosing)|we\s+(?:accept|plan to (?:use|go with)|intend to use|want to use)\b|your\s+(?:bid|quote|price|proposal)\s+is\s+(?:accepted|approved)|award(?:ing)?\s+(?:you|this|the\s+(?:job|work|contract))|the\s+(?:job|work|contract)\s+is\s+yours|consider\s+yourself\s+(?:awarded|selected))/i;

/** Language that promises when work happens. */
const SCHEDULE_RE =
  /\b(?:we(?:'ll| will)\s+(?:start|begin|mobilize|break ground|have you (?:on|out))|you(?:'ll| will|'re| are)\s+(?:starting|scheduled|mobilizing|on site)|you\s+can\s+(?:start|begin|mobilize)\s+(?:on|the|in|by|\w+day)|plan\s+on\s+(?:starting|mobilizing)|work\s+(?:will\s+)?(?:starts?|begins?)\s+on|guarantee\w*\s+(?:a\s+)?(?:start|completion|schedule))/i;

/** Numbers the sub gave us, in every shape they might be written back. */
function allowedMoney(extracted: ExtractedReply | null): Set<string> {
  const allowed = new Set<string>();
  for (const n of [
    extracted?.quoteAmount,
    extracted?.laborCost,
    extracted?.materialCost,
  ]) {
    if (typeof n !== "number" || !Number.isFinite(n)) continue;
    const plain = String(Math.round(n));
    allowed.add(plain);
    allowed.add(Math.round(n).toLocaleString("en-US"));
    allowed.add(n.toFixed(2));
    allowed.add(Math.round(n).toLocaleString("en-US") + ".00");
  }
  return allowed;
}

export function checkDraftCommitments(
  body: string,
  extracted: ExtractedReply | null
): string[] {
  const warnings: string[] = [];
  const allowed = allowedMoney(extracted);

  const signed = (body.match(MONEY_RE) ?? []).map((m) =>
    m.replace(/^\$\s?/, "").trim()
  );
  const unsigned = Array.from(body.matchAll(RATE_RE)).map((m) => m[1].trim());
  const invented = [...signed, ...unsigned].filter((m) => !allowed.has(m));
  if (invented.length) {
    warnings.push(
      `This draft names a price we did not get from them (${invented
        .slice(0, 3)
        .map((m) => "$" + m)
        .join(", ")}). Check it before sending.`
    );
  }
  if (AWARD_RE.test(body)) {
    warnings.push(
      "This draft reads like it awards them the work. Only you can do that."
    );
  }
  if (SCHEDULE_RE.test(body)) {
    warnings.push(
      "This draft commits to a schedule. Confirm the dates are ones you can hold."
    );
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Context + prompt
// ---------------------------------------------------------------------------

interface DraftContextRow {
  id: string;
  body: string | null;
  subject: string | null;
  created_at: Date;
  gmail_message_id: string | null;
  gmail_thread_id: string | null;
  subcontractor_id: string | null;
  opportunity_id: string | null;
  org_id: string | null;
  company_name: string | null;
  owner_name: string | null;
  opp_title: string | null;
  agency: string | null;
  deadline: Date | null;
  solicitation_number: string | null;
  location_state: string | null;
  location_text: string | null;
  description: string | null;
  solicitation_analysis: Record<string, unknown> | null;
  trade: string | null;
}

/**
 * Everything bound for the prompt goes through here, not just the project
 * facts. A contracting officer's name and number can arrive in the sub's own
 * message (they forward the solicitation back at us all the time), in an
 * earlier turn of the thread, or inside a field the extractor lifted out of
 * that text. A model that has been shown the number can put it in the draft,
 * and the output check is patterns, not a guarantee. So the cheapest place to
 * be sure is to never show it in the first place.
 */
function clean(text: string | null | undefined): string {
  const t = (text ?? "").replace(/\r/g, "").trim();
  return t ? scrubGovtContacts(rewriteSamUrls(t)).sanitised : "";
}

/** Scrub, then trim to something worth paying to send. */
function clip(text: string | null | undefined, max: number): string {
  const t = clean(text);
  return t.length > max ? t.slice(0, max) + "\n[...]" : t;
}

function describeExtraction(e: ExtractedReply | null): string {
  if (!e) return "No structured read of this message is on file.";
  const lines: string[] = [`- What they want: ${clean(e.intent)}`];
  if (e.isQuote && e.quoteAmount != null)
    lines.push(`- They quoted: $${e.quoteAmount.toLocaleString("en-US")}`);
  if (e.scopeSummary) lines.push(`- They are pricing: ${clean(e.scopeSummary)}`);
  if (e.exclusions?.length)
    lines.push(`- They exclude: ${e.exclusions.map(clean).filter(Boolean).join("; ")}`);
  if (e.qualifications?.length)
    lines.push(
      `- Conditions they attached: ${e.qualifications.map(clean).filter(Boolean).join("; ")}`
    );
  if (e.canPerform === false && e.capabilityNotes)
    lines.push(`- They say they cannot do it because: ${clean(e.capabilityNotes)}`);
  if (e.leadTimeDays != null)
    lines.push(`- Lead time they stated: ${e.leadTimeDays} days`);
  if (e.availabilityNotes)
    lines.push(`- Availability: ${clean(e.availabilityNotes)}`);
  if (e.missingFields?.length)
    lines.push(
      `- Still unanswered by them: ${e.missingFields.map(clean).filter(Boolean).join(", ")}`
    );
  return lines.join("\n");
}

export function buildReplyDraftPrompt(input: {
  senderName: string;
  subCompany: string | null;
  subFirstName: string | null;
  theirMessage: string;
  priorMessages: { direction: string; body: string }[];
  extracted: ExtractedReply | null;
  projectFacts: string;
}): string {
  const history = input.priorMessages.length
    ? input.priorMessages
        .map(
          (m) =>
            `${m.direction === "inbound" ? "THEM" : "US"}: ${clip(m.body, 700)}`
        )
        .join("\n\n")
    : "(no earlier messages on file)";

  const sender = input.senderName.trim() || "the general contractor";
  return `You are writing a reply on behalf of ${sender}, who runs a general contracting firm, to ${
    input.subCompany ?? "a subcontractor"
  } who just emailed back about a job we invited them to quote.

WHAT THEY SENT
${clip(input.theirMessage, 2000)}

WHAT WE ALREADY UNDERSTOOD FROM IT
${describeExtraction(input.extracted)}

EARLIER IN THIS CONVERSATION
${history}

WHAT WE KNOW ABOUT THE PROJECT
${input.projectFacts}

YOUR JOB
Answer the questions they actually asked, using the project facts above. Being
useful is the point: if they asked about square footage, the site, the trade
scope, the due date, or the agency, and the answer is in the facts above, give
it to them plainly.

HARD RULES, these override being helpful:
- Never state a price, a rate, a budget, or a dollar figure of our own. You may
  repeat back a number THEY quoted, nothing else.
- Never promise a start date, a completion date, a duration, or any schedule.
  You may repeat a deadline that is listed in the project facts.
- Never say or imply they have the job, are selected, are the only bidder, or
  are likely to be awarded. We are collecting quotes.
- Never invent a fact. If they asked something the project facts do not answer,
  say plainly that you will confirm and come back to them on that specific
  point.
- Never include a phone number, an email address, or the name of anyone at the
  government agency.

HOW IT SHOULD READ
- Like a busy contractor typed it on his phone: direct, warm, no filler.
- Open by addressing them${input.subFirstName ? ` as ${input.subFirstName}` : ""}, then get to the point. Do not
  restate their email back to them.
- Under 130 words. Short paragraphs. No bullet lists unless you are answering
  three or more separate questions.
- No marketing voice, no "I hope this email finds you well", no "please do not
  hesitate", no "we are excited".
- Plain text only. No markdown, no subject line, no placeholders in brackets.
- Sign off with just: ${input.senderName.trim() || "a plain closing line, no name"}

Write only the body of the email.`;
}

/** Facts a sub is likely to ask about, scrubbed of government contacts. */
function buildProjectFacts(row: DraftContextRow): string {
  const analysis = (row.solicitation_analysis ?? null) as
    | Parameters<typeof buildOutreachPacket>[0]["analysis"]
    | null;
  const deadlineLabel = row.deadline
    ? formatDeadlineLabel(new Date(row.deadline).toISOString())
    : null;
  const packet = buildOutreachPacket({
    trade: row.trade,
    analysis,
    description: row.description,
    locationState: row.location_state,
    locationText: row.location_text,
    deadlineLabel,
  });

  const facts: string[] = [];
  const push = (label: string, value: string | null | undefined) => {
    const v = clean(value);
    if (v) facts.push(`- ${label}: ${v}`);
  };

  push("Project", row.opp_title);
  push("Agency", row.agency);
  push("Solicitation number", row.solicitation_number);
  push("Location", row.location_text || row.location_state);
  push("Their trade on this job", row.trade);
  if (deadlineLabel) facts.push(`- Quotes are due back to us by: ${deadlineLabel}`);
  if (!packet.tooThin) push("Scope of their work", packet.scopeSummary);

  return facts.length
    ? facts.join("\n")
    : "(we have very little on file for this job)";
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export type DraftFailure =
  | "not-found"
  | "not-inbound"
  | "no-content"
  | "superseded"
  | "not-configured";

export async function generateReplyDraft(input: {
  communicationId: string;
  orgId: string | null;
}): Promise<
  | { ok: true; draft: ReplyDraft }
  | { ok: false; reason: DraftFailure; message: string }
> {
  const started = Date.now();
  const row = await queryOne<DraftContextRow>(
    `select c.id, c.body, c.subject, c.created_at, c.gmail_message_id,
            c.gmail_thread_id, c.subcontractor_id, c.opportunity_id, c.org_id,
            c.direction,
            s.company_name, s.owner_name,
            o.title as opp_title, o.agency, o.deadline, o.solicitation_number,
            o.location_state, o.location_text, o.description,
            o.solicitation_analysis,
            os.trade
       from communications c
       left join subcontractors s on s.id = c.subcontractor_id
       left join opportunities o on o.id = c.opportunity_id
       left join opportunity_subs os
              on os.opportunity_id = c.opportunity_id
             and os.subcontractor_id = c.subcontractor_id
      where c.id = $1
        and c.direction = 'inbound'
        and ($2::uuid is null or c.org_id is null or c.org_id = $2::uuid)`,
    [input.communicationId, input.orgId]
  );

  if (!row)
    return {
      ok: false,
      reason: "not-found",
      message: "That message is not one we can reply to.",
    };

  const theirMessage = clip(row.body, 4000);
  if (!theirMessage)
    return {
      ok: false,
      reason: "no-content",
      message: "That message has no text to reply to.",
    };

  // Only the newest message in a thread can be replied to. The composer
  // already hides the button once we have answered, but that is a UI rule and
  // this endpoint takes a message id from the browser: without the same check
  // here, a stale tab or a hand-made request could generate an answer to a
  // question settled days ago, and store it as the thread's live draft.
  const newer = await queryOne<{ id: string }>(
    `select id
       from communications
      where subcontractor_id = $1
        and coalesce(gmail_thread_id, 'opp:' || coalesce(opportunity_id::text,'none'))
            = coalesce($2, 'opp:' || coalesce($3::text,'none'))
        and created_at > $4
        and ($5::uuid is null or org_id is null or org_id = $5::uuid)
      limit 1`,
    [
      row.subcontractor_id,
      row.gmail_thread_id,
      row.opportunity_id,
      row.created_at,
      input.orgId,
    ]
  );
  if (newer)
    return {
      ok: false,
      reason: "superseded",
      message: "There is a newer message in this thread. Reload to see it.",
    };

  // The extractor has already read this message. Prefer its structured result
  // over asking a second model to re-read the same words.
  const event = row.gmail_message_id
    ? await queryOne<{ extracted: ExtractedReply | null }>(
        `select extracted from subcontractor_reply_events
          where gmail_message_id = $1
            and ($2::uuid is null or org_id is null or org_id = $2::uuid)`,
        [row.gmail_message_id, input.orgId]
      )
    : null;
  const extracted =
    event?.extracted && Object.keys(event.extracted).length
      ? (event.extracted as ExtractedReply)
      : null;

  // Earlier turns, oldest first, excluding the message being answered. Scoped
  // to the tenant like the target message: a thread id is not a secret, and a
  // legacy row shared across orgs must not be quoted into someone else's
  // prompt just because it hangs off the same subcontractor.
  const prior = await query<{ direction: string; body: string | null }>(
    `select direction, body
       from communications
      where subcontractor_id = $1
        and coalesce(gmail_thread_id, 'opp:' || coalesce(opportunity_id::text,'none'))
            = coalesce($2, 'opp:' || coalesce($3::text,'none'))
        and id <> $4
        and ($5::uuid is null or org_id is null or org_id = $5::uuid)
      order by created_at desc
      limit 4`,
    [
      row.subcontractor_id,
      row.gmail_thread_id,
      row.opportunity_id,
      row.id,
      input.orgId,
    ]
  );

  const profile = await getProfileJson();
  const senderName = outreachDisplayName({
    outreach_display_name: (profile as { outreach_display_name?: string } | null)
      ?.outreach_display_name,
    owner_name: (profile as { owner_name?: string } | null)?.owner_name,
    legal_name: (profile as { legal_name?: string } | null)?.legal_name,
  });
  const subFirstName = (row.owner_name ?? "").trim().split(/\s+/)[0] || null;

  const prompt = buildReplyDraftPrompt({
    senderName,
    subCompany: row.company_name,
    subFirstName,
    theirMessage,
    priorMessages: prior
      .reverse()
      .map((m) => ({ direction: m.direction, body: m.body ?? "" }))
      .filter((m) => m.body.trim()),
    extracted,
    projectFacts: buildProjectFacts(row),
  });

  let text: string;
  let usage: unknown;
  try {
    const res = await complete(prompt, { maxTokens: 700 });
    text = res.text;
    usage = res.usage;
  } catch (err) {
    if (err instanceof ClaudeNotConfiguredError) {
      return {
        ok: false,
        reason: "not-configured",
        message:
          "Drafting is not available because no Claude API key is configured.",
      };
    }
    throw err;
  }

  // Scrub the generated text, never a rendered email: this is model output on
  // its way into a box, so removing a contracting officer's number here cannot
  // strip our own contact details the way scrubbing an assembled email would.
  let body = scrubGovtContacts(text.trim()).sanitised.trim();
  let warnings = checkDraftCommitments(body, extracted);

  // One retry when it broke a hard rule. Models usually comply once the
  // specific violation is named, and a second attempt is cheaper than handing
  // the operator something they have to rewrite.
  if (warnings.length) {
    try {
      const retry = await complete(
        `${prompt}\n\nA previous attempt was rejected for these reasons:\n${warnings
          .map((w) => `- ${w}`)
          .join(
            "\n"
          )}\nWrite it again without doing any of that. Do not mention this note.`,
        { maxTokens: 700 }
      );
      const retryBody = scrubGovtContacts(retry.text.trim()).sanitised.trim();
      const retryWarnings = checkDraftCommitments(retryBody, extracted);
      if (retryBody && retryWarnings.length < warnings.length) {
        body = retryBody;
        warnings = retryWarnings;
      }
      usage = [usage, retry.usage];
    } catch (err) {
      if (!(err instanceof ClaudeNotConfiguredError)) throw err;
    }
  }

  if (!body)
    return {
      ok: false,
      reason: "no-content",
      message: "The draft came back empty. Try again.",
    };

  const saved = await queryOne<DraftRow>(
    `insert into reply_drafts
       (org_id, communication_id, subcontractor_id, opportunity_id,
        generated_body, warnings, model)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (communication_id) do update
       set generated_body = excluded.generated_body,
           warnings = excluded.warnings,
           model = excluded.model,
           -- Regenerating is an explicit "give me a different one", so the
           -- operator's earlier edit is not what they are asking to keep.
           edited_body = null,
           -- A rewrite is itself a new revision, and the counter only ever
           -- goes up. Resetting it here would be the one hole in the ordering
           -- rule: an autosave already on the wire when the rewrite lands
           -- carries a revision from the previous draft, and against a
           -- counter that had gone back to zero it would look newer and
           -- quietly restore the text the operator just replaced.
           rev = reply_drafts.rev + 1,
           generated_at = now(),
           updated_at = now()
     returning communication_id, generated_body, edited_body, warnings,
               generated_at, rev`,
    [
      row.org_id,
      row.id,
      row.subcontractor_id,
      row.opportunity_id,
      body,
      warnings,
      config.claude.model,
    ]
  );

  await logAgent({
    agent: "reply-draft",
    action: "draft",
    opportunityId: row.opportunity_id,
    subcontractorId: row.subcontractor_id,
    message: `Drafted a reply to ${row.company_name ?? "a subcontractor"}.`,
    reasoning: warnings.length
      ? `Draft flagged: ${warnings.join(" ")}`
      : "Draft passed the price, schedule, and award checks.",
    durationMs: Date.now() - started,
    claudeUsage: usage,
  });

  return { ok: true, draft: toDraft(saved as DraftRow) };
}
