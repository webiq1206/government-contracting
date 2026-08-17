/**
 * CALL PREP, triggered when a sub replies to outreach.
 * Assembles a one-screen call card for the operator: everything worth knowing
 * about the sub, plus a Claude-generated call script and question list tailored
 * to the draft SOW. A project-history collection question is always appended
 * when the sub has no project history on file. The card is upserted into
 * call_cards, the sub is marked responsive, and the opportunity moves into the
 * call_queue with a human-action flag so the operator picks up the call.
 *
 * Does nothing at all when the account has turned calling off: it advances the
 * opportunity past the call stage instead, so an email-only workflow never
 * accumulates call work it will not do.
 */
import { z } from "zod";
import { query, queryOne } from "../db";
import { getProfileJson } from "../ai/companyProfile";
import { completeJson, ClaudeNotConfiguredError } from "../ai/claude";
import { logAgent } from "../logger";
import { areCallsEnabled } from "../app-settings";
import { isCallable } from "../domain/sub-contactability";
import { advancePastCallStep } from "../domain/advance-stage";
import { CALLS_DISABLED_REASON } from "../domain/call-step";
import { resolveSubWork } from "../domain/sub-work";
import { coerceQuestions, type CallQuestion } from "../domain/call-guide";
import type { AgentDefinition } from "./types";
import type { AgentResult, Opportunity, Subcontractor } from "../types";

/**
 * Typed questions, not sentences.
 *
 * Claude used to return an array of strings, which meant every job-specific
 * answer landed in one shared textarea while the operator was mid-sentence on
 * a phone call. Asking for the answer type alongside the question lets the
 * workspace render a Yes/No pair, a dollar field or a date picker, so the
 * answer is one tap instead of a paragraph.
 */
const QuestionSchema = z.object({
  ask: z.string(),
  type: z
    .enum(["yes_no", "choice", "money", "number", "date", "short_text", "notes"])
    .default("short_text"),
  options: z.array(z.string()).optional(),
});

const CallPlanSchema = z.object({
  call_script: z.string(),
  questions: z.array(QuestionSchema).max(6).default([]),
});

const PROJECT_HISTORY_QUESTION =
  "Can you share 2-3 recent projects (name, scope, approximate value, client type, year) we could reference for past-performance?";

export const callPrep: AgentDefinition = {
  name: "call-prep",
  label: "Call Prep",
  description:
    "Builds a one-screen call card with a SOW-tailored script + questions for a responsive sub, and queues it for the operator.",
  worksWithoutClaude: true, // degrades to a static script if Claude is off
  async handler(ctx): Promise<AgentResult> {
    const opportunityId = ctx.payload.opportunityId as string;
    const subcontractorId = ctx.payload.subcontractorId as string;
    // 'reply'    = the sub responded (warm).
    // 'outreach' = we emailed them and want a call card so we can follow up by
    //              phone whether or not they ever reply.
    const source = ctx.payload.source === "outreach" ? "outreach" : "reply";
    const replied = source === "reply";
    if (!opportunityId || !subcontractorId)
      return { ok: false, summary: "missing opportunityId or subcontractorId in payload" };

    // The one place a call card is ever written, so the preference is enforced
    // here as well as at every enqueue site: a job queued before the operator
    // turned calling off must not produce a card when it finally runs.
    if (!(await areCallsEnabled())) {
      const advanced = await advancePastCallStep(opportunityId, {
        agent: "call-prep",
        reason: `${CALLS_DISABLED_REASON} This opportunity moved on to collecting quotes.`,
      });
      return {
        ok: true,
        summary: advanced
          ? "Calling is off; skipped the call card and moved this on to collecting quotes."
          : "Calling is off; skipped the call card.",
        reasoning: CALLS_DISABLED_REASON,
        data: { callsEnabled: false, advanced },
        humanActionRequired: false,
      };
    }

    const sub = await queryOne<Subcontractor>(
      `select * from subcontractors where id = $1`,
      [subcontractorId]
    );
    if (!sub) return { ok: false, summary: `subcontractor ${subcontractorId} not found` };

    // Never put an uncallable card on Today / Call Queue — there is nothing
    // the operator can do until a phone number exists. Re-run verify instead.
    if (!isCallable(sub)) {
      await query(
        `update opportunity_subs
            set outreach_state = coalesce(nullif(outreach_state, ''), 'no_email')
          where opportunity_id = $1 and subcontractor_id = $2`,
        [opportunityId, subcontractorId]
      );
      await query(
        `update opportunities set human_action_required = true where id = $1`,
        [opportunityId]
      );
      await logAgent({
        agent: "call-prep",
        action: "skip-no-phone",
        level: "warn",
        opportunityId,
        subcontractorId,
        message: `Skipped call card for ${sub.company_name}: no phone on file. Automation cannot dial them.`,
      });
      return {
        ok: true,
        summary: `No call card for ${sub.company_name}: missing phone number.`,
        humanActionRequired: true,
        enqueued: [
          {
            agent: "sub-verify",
            payload: { opportunityId, subcontractorId },
            opts: {
              singletonKey: `verify-retry:${opportunityId}:${subcontractorId}`,
              singletonSeconds: 3600,
            },
          },
        ],
      };
    }

    const opp = await queryOne<Opportunity>(
      `select * from opportunities where id = $1`,
      [opportunityId]
    );
    if (!opp) return { ok: false, summary: `opportunity ${opportunityId} not found` };

    const oppSub = await queryOne<{
      trade: string | null;
      verification_json: { needs_project_history?: boolean } | null;
    }>(
      `select trade, verification_json from opportunity_subs
       where opportunity_id=$1 and subcontractor_id=$2
       order by created_at asc limit 1`,
      [opportunityId, subcontractorId]
    );

    const profile = await getProfileJson();
    const analysis = opp.solicitation_analysis;

    const projectHistoryEmpty =
      !Array.isArray(sub.project_history) || sub.project_history.length === 0;
    const needsProjectHistory =
      projectHistoryEmpty || Boolean(oppSub?.verification_json?.needs_project_history);

    // One-screen card object.
    // If the reply-poll spotted a dollar figure in the sub's email, carry it
    // onto the card so the workspace's pricing step says "their email
    // mentioned $X, confirm it on the call".
    const emailPrice = Number(ctx.payload.emailMentionedPrice);
    const card = {
      company_name: sub.company_name,
      owner_name: sub.owner_name,
      ...(Number.isFinite(emailPrice) && emailPrice > 0
        ? { email_mentioned_price: emailPrice }
        : {}),
      phone: sub.phone,
      google_rating: sub.google_rating,
      review_count: sub.review_count,
      reviews_summary: sub.reviews_summary ?? null,
      license_status: sub.license_status,
      sb_eligibility: sub.sb_certified,
      prior_relationship: {
        notes: sub.notes ?? null,
        last_contacted: sub.last_contacted ?? null,
      },
      project_history: sub.project_history ?? [],
      trade: oppSub?.trade ?? null,
      opportunity_title: opp.title,
    };

    const subWork = resolveSubWork({
      trade: oppSub?.trade,
      analysis,
      description: opp.description,
      maxChars: 500,
    });

    // Claude-generated script + questions tailored to the SOW.
    let callScript =
      `Hi, this is a call about ${opp.title ?? "an upcoming opportunity"} on behalf of ${
        profile?.legal_name ?? "our team"
      }. We'd like to gauge your interest and availability for the ${
        oppSub?.trade ?? "scope"
      } work and get a rough quote.` +
      (subWork.work
        ? ` In plain terms, we need you to: ${subWork.work.replace(/\s+/g, " ").slice(0, 280)}`
        : "");
    // Fallback when Claude is off: the analyst's questions, typed by their
    // wording so even the degraded path gets structured inputs.
    let questions: CallQuestion[] = coerceQuestions(
      analysis?.questions_for_subs?.slice() ?? []
    );

    try {
      const prompt = buildCallPrompt(opp, sub, oppSub?.trade ?? null, replied, subWork.work);
      const { data, usage } = await completeJson(prompt, {
        schema: CallPlanSchema,
        maxTokens: 900,
      });
      callScript = data.call_script;
      questions = coerceQuestions(data.questions);
      await logAgent({
        agent: "call-prep",
        action: "generate-card",
        opportunityId,
        subcontractorId,
        message: "Generated SOW-tailored call script via Claude.",
        claudeUsage: usage,
      });
    } catch (err) {
      if (!(err instanceof ClaudeNotConfiguredError)) throw err;
      await logAgent({
        agent: "call-prep",
        action: "generate-card",
        level: "warn",
        status: "skipped",
        opportunityId,
        subcontractorId,
        message: "Claude not configured, using a generic call script.",
      });
    }

    // Project history is asked by the guide itself when the sub has none on
    // file, so it is no longer appended here: two copies of the same question
    // is exactly what this card had too much of.

    // Scrub solicitor contacts from scripts/questions so they are never read
    // aloud or copied into outbound notes.
    const { scrubGovtContacts } = await import("../integrations/scrub-contacts");
    callScript = scrubGovtContacts(callScript).sanitised;
    questions = questions.map((q) => ({
      ...q,
      ask: scrubGovtContacts(q.ask).sanitised,
    }));

    await query(
      `insert into call_cards
         (opportunity_id, subcontractor_id, card_json, call_script, question_list,
          needs_project_history, status, source)
       values ($1,$2,$3,$4,$5,$6,'pending',$7)
       on conflict (opportunity_id, subcontractor_id)
       do update set card_json=excluded.card_json, call_script=excluded.call_script,
                     question_list=excluded.question_list,
                     needs_project_history=excluded.needs_project_history,
                     -- Keep completed / operator-skipped cards out of the queue.
                     -- Blindly resetting to pending put skipped calls back on Today.
                     status=case
                       when call_cards.status in ('called','skipped') then call_cards.status
                       else 'pending'
                     end,
                     -- a reply upgrades a cold card, but never the reverse.
                     source=case when call_cards.source='reply' then 'reply'
                                 else excluded.source end`,
      [
        opportunityId,
        subcontractorId,
        JSON.stringify(card),
        callScript,
        JSON.stringify(questions),
        needsProjectHistory,
        source,
      ]
    );

    // A reply marks the sub responsive; a cold follow-up card leaves the
    // outreach state alone (they haven't replied yet).
    if (replied) {
      await query(
        `update opportunity_subs
           set outreach_state='responsive', responded_at=now()
         where opportunity_id=$1 and subcontractor_id=$2`,
        [opportunityId, subcontractorId]
      );
    }

    // Surface the opportunity in the Call Queue. A reply always warrants it; a
    // cold card only advances from the outreach stage so it never drags an
    // opportunity backwards out of pricing or bidding.
    if (replied) {
      await query(
        `update opportunities set stage='call_queue', human_action_required=true where id=$1`,
        [opportunityId]
      );
    } else {
      await query(
        `update opportunities set stage='call_queue', human_action_required=true
         where id=$1 and stage='outreach'`,
        [opportunityId]
      );
    }

    return {
      ok: true,
      summary: `${replied ? "Reply" : "Follow-up"} call card ready for ${
        sub.company_name
      } on "${opp.title ?? "opportunity"}", ${questions.length} questions${
        needsProjectHistory ? " (incl. project-history collection)" : ""
      }. Queued for the operator.`,
      reasoning: `Built one-screen card + ${questions.length} typed job-specific questions tailored to the draft SOW; opportunity moved to call_queue and flagged for human action.`,
      data: {
        questions: questions.length,
        needsProjectHistory,
        trade: oppSub?.trade ?? null,
      },
      humanActionRequired: true,
    };
  },
};

function buildCallPrompt(
  opp: Opportunity,
  sub: Subcontractor,
  trade: string | null,
  replied: boolean,
  tradeWork: string
): string {
  const analysis = opp.solicitation_analysis;
  const intro = replied
    ? "Write a short phone-call plan for our estimator to call a subcontractor who replied to our outreach. We want to confirm interest, availability, and get a rough quote for their trade on this opportunity."
    : "Write a short phone-call plan for our estimator to make a follow-up call to a subcontractor we emailed about this opportunity who has not replied yet. The goal is a warm, low-pressure call to gauge interest and availability and get a rough quote for their trade. Open by noting we sent an email and are following up.";
  return [
    intro,
    "",
    `SUBCONTRACTOR: ${sub.company_name}${sub.owner_name ? ` (owner: ${sub.owner_name})` : ""}`,
    `TRADE: ${trade ?? "(scope work)"}`,
    `OPPORTUNITY: ${opp.title ?? "(untitled)"}`,
    "",
    "WHAT WE NEED THIS SUBCONTRACTOR TO DO (plain English, weave this into the script so the estimator can explain the work clearly):",
    tradeWork ||
      (analysis?.draft_sow ?? opp.description ?? "(no SOW available)").slice(0, 2000),
    "",
    "FULLER DRAFT SCOPE (background only):",
    (analysis?.draft_sow ?? analysis?.scope_plain_language ?? opp.description ?? "(none)").slice(
      0,
      1500
    ),
    "",
    "PRE-DRAFTED QUESTIONS FOR SUBS (incorporate the relevant ones):",
    (analysis?.questions_for_subs ?? []).map((q) => `- ${q}`).join("\n") || "(none)",
    "",
    "Return JSON: { call_script: string, questions: [{ ask, type, options? }] }.",
    "",
    "call_script: two sentences at most, spoken aloud, including a plain-English line on what the work is. The estimator reads this while the other person is waiting, so long is worse than vague.",
    "",
    "questions: AT MOST 4, and only things specific to THIS job that a general form cannot ask. The form already captures, with its own structured field, every one of these, so never ask them: whether they can do the work, whether they are interested, their price, firm-or-estimate, start date, availability, insurance, bonding, licenses, certifications, and past projects. A question repeating any of those is discarded.",
    "",
    "NEVER reveal that this is a competitive government solicitation. Do not mention the government, the agency, a federal contract, an award, a bid, a solicitation number, or winning; do not ask whether they have bid it themselves or what they would do 'if we win'. Write as though we are a contractor pricing a job we intend to take on. Questions phrased that way are discarded, and the reason is commercial: it invites the sub to price against the bid instead of the work, or to go find the solicitation and bid it without us.",
    "",
    "Each question needs the answer type that makes it fastest to record while someone is talking:",
    "  yes_no     - anything answerable yes or no. Prefer this; it is one tap.",
    "  choice     - a small fixed set. Supply options as short labels.",
    "  money      - a dollar amount.",
    "  number     - a count or duration.",
    "  date       - a single date.",
    "  short_text - a few words, when nothing above fits.",
    "  notes      - only for genuinely open-ended answers. Use sparingly.",
    "",
    "Phrase each question the way the estimator would say it out loud, under 12 words, no preamble.",
  ].join("\n");
}
