/**
 * CALL PREP, triggered when a sub replies to outreach.
 * Assembles a one-screen call card for the operator: everything worth knowing
 * about the sub, plus a Claude-generated call script and question list tailored
 * to the draft SOW. A project-history collection question is always appended
 * when the sub has no project history on file. The card is upserted into
 * call_cards, the sub is marked responsive, and the opportunity moves into the
 * call_queue with a human-action flag so the operator picks up the call.
 */
import { z } from "zod";
import { query, queryOne } from "../db";
import { getProfileJson } from "../ai/companyProfile";
import { completeJson, ClaudeNotConfiguredError } from "../ai/claude";
import { logAgent } from "../logger";
import type { AgentDefinition } from "./types";
import type { AgentResult, Opportunity, Subcontractor } from "../types";

const CallPlanSchema = z.object({
  call_script: z.string(),
  question_list: z.array(z.string()).default([]),
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
    const card = {
      company_name: sub.company_name,
      owner_name: sub.owner_name,
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

    // Claude-generated script + questions tailored to the SOW.
    let callScript =
      `Hi, this is a call about ${opp.title ?? "an upcoming opportunity"} on behalf of ${
        profile?.legal_name ?? "our team"
      }. We'd like to gauge your interest and availability for the ${
        oppSub?.trade ?? "scope"
      } work and get a rough quote.`;
    let questionList: string[] = analysis?.questions_for_subs?.slice() ?? [];

    try {
      const prompt = buildCallPrompt(opp, sub, oppSub?.trade ?? null, replied);
      const { data, usage } = await completeJson(prompt, {
        schema: CallPlanSchema,
        maxTokens: 900,
      });
      callScript = data.call_script;
      questionList = data.question_list;
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

    // Always collect project history when we don't have it.
    if (needsProjectHistory && !questionList.includes(PROJECT_HISTORY_QUESTION)) {
      questionList.push(PROJECT_HISTORY_QUESTION);
    }

    await query(
      `insert into call_cards
         (opportunity_id, subcontractor_id, card_json, call_script, question_list,
          needs_project_history, status, source)
       values ($1,$2,$3,$4,$5,$6,'pending',$7)
       on conflict (opportunity_id, subcontractor_id)
       do update set card_json=excluded.card_json, call_script=excluded.call_script,
                     question_list=excluded.question_list,
                     needs_project_history=excluded.needs_project_history,
                     status='pending',
                     -- a reply upgrades a cold card, but never the reverse.
                     source=case when call_cards.source='reply' then 'reply'
                                 else excluded.source end`,
      [
        opportunityId,
        subcontractorId,
        JSON.stringify(card),
        callScript,
        JSON.stringify(questionList),
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
      } on "${opp.title ?? "opportunity"}", ${questionList.length} questions${
        needsProjectHistory ? " (incl. project-history collection)" : ""
      }. Queued for the operator.`,
      reasoning: `Built one-screen card + ${questionList.length}-question list tailored to the draft SOW; opportunity moved to call_queue and flagged for human action.`,
      data: {
        questions: questionList.length,
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
  replied: boolean
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
    "DRAFT SCOPE OF WORK:",
    (analysis?.draft_sow ?? opp.description ?? "(no SOW available)").slice(0, 2000),
    "",
    "PRE-DRAFTED QUESTIONS FOR SUBS (incorporate the relevant ones):",
    (analysis?.questions_for_subs ?? []).map((q) => `- ${q}`).join("\n") || "(none)",
    "",
    "Return JSON: { call_script: string, question_list: string[] }. The call_script is a natural 4-6 sentence opener the estimator can read. The question_list is the specific things to confirm on this call (availability, pricing basis, scope clarifications). Do not include a project-history question, that is appended separately.",
  ].join("\n");
}
