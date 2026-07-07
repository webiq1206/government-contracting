/**
 * SOURCES SOUGHT RESPONDER, separate from the main scoring pipeline. Triggered
 * when a Sources Sought notice is detected (by the Opportunity Monitor). These
 * are time-sensitive market-research requests: responding well positions us for a
 * future set-aside, so we draft fast and queue for human review within 24 hours.
 *
 * Flow: load opportunity + profile → draft a capability-statement response body
 * with Claude (Template 3 tone, tailored to the notice scope) → render a
 * capability-statement PDF → upload to storage → record a documents row → draft
 * (but do NOT send) the outbound email in communications → flag for human review.
 */
import { z } from "zod";
import { query, queryOne } from "../db";
import { getProfileJson } from "../ai/companyProfile";
import { completeJson, ClaudeNotConfiguredError } from "../ai/claude";
import { logAgent } from "../logger";
import { storage } from "../integrations/storage";
import { documents } from "../integrations/documents";
import type { AgentDefinition } from "./types";
import type { AgentResult, Opportunity } from "../types";

const ResponseSchema = z.object({
  email_subject: z.string(),
  email_body: z.string(),
  differentiators: z.array(z.string()).default([]),
  capability_summary: z.string(),
});

function buildPrompt(opp: Opportunity): string {
  return [
    "Draft our response to this federal Sources Sought notice. Sources Sought notices are market research, the goal is to demonstrate that a capable small business (us) exists so the agency can justify a set-aside. Match the tone of our Template 3 (Sources Sought response): professional, concise, capability-forward, no pricing, no unsupported claims.",
    "Use the Company Profile (your system context) for our certifications, NAICS, trades, and service areas.",
    "",
    "SOURCES SOUGHT NOTICE:",
    `Title: ${opp.title ?? "(none)"}`,
    `Agency: ${opp.agency ?? "(none)"}`,
    `Solicitation/Notice #: ${opp.solicitation_number ?? "(none)"}`,
    `NAICS: ${opp.naics_code ?? "(none)"}  Set-aside: ${opp.set_aside_type ?? "(none)"}`,
    `Location: ${opp.location_state ?? "(unknown)"}`,
    "",
    "SCOPE / DESCRIPTION:",
    (opp.description ?? "(no description provided)").slice(0, 5000),
    "",
    "Return JSON: { email_subject: string, email_body: string, differentiators: string[], capability_summary: string }.",
    "email_body is the full outbound email a human will review and send (address it to the notice's point of contact / contracting officer, sign as our company). differentiators are 2-5 short bullets on why we are a strong candidate. capability_summary is one paragraph.",
  ].join("\n");
}

export const sourcesSoughtResponder: AgentDefinition = {
  name: "sources-sought-responder",
  label: "Sources Sought Responder",
  description:
    "Drafts a tailored Sources Sought response + capability statement PDF and queues it for human review and send within 24 hours.",
  cron: undefined,
  worksWithoutClaude: false,
  async handler(ctx): Promise<AgentResult> {
    const opportunityId = ctx.payload.opportunityId as string;
    if (!opportunityId) return { ok: false, summary: "no opportunityId in payload" };

    const opp = await queryOne<Opportunity>(`select * from opportunities where id = $1`, [
      opportunityId,
    ]);
    if (!opp) return { ok: false, summary: `opportunity ${opportunityId} not found` };

    const profile = await getProfileJson();
    if (!profile) return { ok: false, summary: "no active Company Profile" };

    // 1) Draft the response body via Claude.
    let subject: string;
    let body: string;
    let differentiators: string[];
    let capabilitySummary: string;
    try {
      const { data, usage } = await completeJson(buildPrompt(opp), {
        schema: ResponseSchema,
        maxTokens: 2000,
      });
      subject = data.email_subject;
      body = data.email_body;
      differentiators = data.differentiators;
      capabilitySummary = data.capability_summary;
      await logAgent({
        agent: "sources-sought-responder",
        action: "draft",
        opportunityId,
        message: "drafted Sources Sought response",
        reasoning: capabilitySummary,
        claudeUsage: usage,
      });
    } catch (err) {
      if (err instanceof ClaudeNotConfiguredError) {
        await logAgent({
          agent: "sources-sought-responder",
          action: "draft",
          opportunityId,
          level: "warn",
          status: "skipped",
          message: "Claude not configured, Sources Sought response not drafted; flagged for human.",
        });
        await query(
          `update opportunities set human_action_required = true, stage = 'outreach' where id = $1`,
          [opportunityId]
        );
        return {
          ok: true,
          summary: "Sources Sought response not drafted (Claude disabled), flagged for human review.",
          humanActionRequired: true,
        };
      }
      throw err;
    }

    // 2) Build the capability statement PDF.
    const pdf = await documents.buildCapabilityStatementPdf({
      company_name: profile.legal_name,
      uei: profile.uei,
      cage_code: profile.cage_code,
      naics_codes: profile.naics_codes,
      certifications: profile.certifications,
      primary_trades: profile.primary_trades,
      service_areas: profile.service_areas,
      differentiators: differentiators.length ? differentiators : undefined,
      contact: undefined,
    });

    // 3) Upload to storage.
    const key = `capability-statements/${opportunityId}.pdf`;
    const uploaded = await storage.upload(key, pdf, "application/pdf");

    // 4) Record a documents row.
    await query(
      `insert into documents
         (opportunity_id, kind, name, storage_path, storage_backend, mime)
       values ($1, 'capability_statement', $2, $3, $4, 'application/pdf')`,
      [
        opportunityId,
        `Capability Statement, ${opp.title ?? opportunityId}`,
        uploaded.path,
        uploaded.backend,
      ]
    );

    // 5) Draft (do NOT send) the outbound email; a human reviews then sends.
    const noteBody = `${body}\n\n---\n[Attachment: capability statement, ${uploaded.path}]\n[ACTION REQUIRED: review and send within 24 hours of the notice.]`;
    await query(
      `insert into communications
         (opportunity_id, channel, direction, subject, body, meta)
       values ($1, 'email', 'outbound', $2, $3, $4)`,
      [
        opportunityId,
        subject,
        noteBody,
        JSON.stringify({
          kind: "sources_sought_response",
          status: "draft",
          must_send_within_hours: 24,
          capability_statement_path: uploaded.path,
        }),
      ]
    );

    // 6) Flag for human review; move to outreach stage.
    await query(
      `update opportunities set human_action_required = true, stage = 'outreach' where id = $1`,
      [opportunityId]
    );

    await logAgent({
      agent: "sources-sought-responder",
      action: "queue-review",
      opportunityId,
      level: "success",
      message: `capability statement generated (${uploaded.backend}); email drafted; queued for human send within 24h.`,
    });

    return {
      ok: true,
      summary:
        "Drafted Sources Sought response + capability statement PDF; queued for human review and send within 24 hours.",
      reasoning: capabilitySummary,
      data: {
        capability_statement_path: uploaded.path,
        storage_backend: uploaded.backend,
        email_subject: subject,
        must_send_within_hours: 24,
      },
      humanActionRequired: true,
    };
  },
};
