/**
 * COMPLIANCE AUDITOR, an independent, adversarial review of an assembled bid
 * package. It re-reads the actual solicitation text and, acting as a strict
 * contracting-officer's reviewer, hunts for every way the package could be
 * rejected as non-responsive: requirements the matrix missed, required agency
 * forms not used, format/submission-mechanics risks, and unsigned attestations.
 *
 * Findings with severity "blocker" gate submission (combined with the
 * deterministic validation). Fully resilient: if Claude is unavailable or
 * errors, the bid is marked audit_status='skipped' and left submittable via the
 * normal validation gate, the auditor only ever ADDS scrutiny.
 */
import { z } from "zod";
import { query, queryOne } from "../db";
import { getProfileJson } from "../ai/companyProfile";
import { completeJson, ClaudeNotConfiguredError } from "../ai/claude";
import { config } from "../config";
import { logAgent } from "../logger";
import { noEmDash } from "../sanitize";
import { computeReady } from "../domain/package";
import type { AgentDefinition } from "./types";
import type {
  AgentResult,
  AuditFinding,
  Bid,
  Opportunity,
  ResolvedRequirement,
  PackageValidation,
  CompanyProfileJson,
} from "../types";

const FindingsSchema = z.object({
  findings: z
    .array(
      z.object({
        severity: z.enum(["blocker", "warning", "info"]),
        category: z
          .enum(["missing_requirement", "official_form", "format", "signature", "content", "other"])
          .default("other"),
        finding: z.string(),
        recommendation: z.string(),
        requirement_id: z.string().optional(),
      })
    )
    .default([]),
  overall: z.string().default(""),
});

function buildAuditPrompt(
  opp: Pick<Opportunity, "title" | "agency" | "solicitation_number">,
  solicitationText: string,
  matrix: ResolvedRequirement[],
  profile: CompanyProfileJson
): string {
  const matrixLines = matrix
    .map(
      (r) =>
        `- [${r.status}] ${r.title} (${r.category}${r.official_form ? `, official_form: ${r.official_form}` : ""}${
          r.mandatory ? ", mandatory" : ", optional"
        }), satisfied_by ${r.satisfied_by}`
    )
    .join("\n");

  return [
    "You are a STRICT government contracting-officer's compliance reviewer. Your job is to find every reason the following bid package could be rejected as NON-RESPONSIVE. Be adversarial and specific. Do NOT be reassuring.",
    "",
    "You are given: (1) the actual solicitation text, (2) the compliance matrix and package the bidder assembled, and (3) what the bidder's platform can auto-generate vs. what the human must supply.",
    "",
    "WHAT THE PLATFORM AUTO-GENERATES (drafts, NOT official agency forms): a cover/transmittal letter, an itemized pricing schedule, a prefilled reps & certifications DATA SHEET (not the official form), a capability statement. It CANNOT reproduce official government forms (SF-1449, SF-33, agency worksheets) or apply signatures.",
    "",
    "Find and report:",
    "1. missing_requirement, anything the solicitation REQUIRES for a responsive offer that is absent from the matrix/package.",
    "2. official_form, any place a SPECIFIC agency form/worksheet is required but the matrix relies on a generated draft instead.",
    "3. format, page limits, font/size, number of copies, required file types, labeling, or portal/mechanics rules that could cause rejection.",
    "4. signature, required signatures or attestations not yet satisfied.",
    "5. content, a required document that is present but likely incomplete or non-compliant.",
    "Assign severity: blocker (would likely make the bid non-responsive), warning (real risk, review), info (minor).",
    "Do NOT invent requirements that are not supported by the solicitation text. If the text is silent on submission contents, say so as an info finding rather than guessing.",
    "",
    `OPPORTUNITY: ${opp.title ?? ""}, ${opp.agency ?? ""}, ${opp.solicitation_number ?? ""}`,
    `BIDDER: ${profile.legal_name} (small_business=${profile.small_business}, certs=${(profile.certifications ?? []).join("/") || "none"}, UEI=${profile.uei ?? "MISSING"}, CAGE=${profile.cage_code ?? "MISSING"})`,
    "",
    "ASSEMBLED COMPLIANCE MATRIX / PACKAGE:",
    matrixLines || "(empty)",
    "",
    "SOLICITATION TEXT (authoritative, read carefully):",
    solicitationText.slice(0, 90_000),
    "",
    'Return JSON: { "findings": [{ "severity", "category", "finding", "recommendation", "requirement_id"? }], "overall": string }. requirement_id should reference a matrix item id when the finding is about one.',
  ].join("\n");
}

export const complianceAuditor: AgentDefinition = {
  name: "compliance-auditor",
  label: "Compliance Auditor",
  description:
    "Independently re-reads the solicitation against the assembled bid package and reports missing or non-compliant items. Blocker findings gate submission.",
  cron: undefined,
  worksWithoutClaude: false,
  async handler(ctx): Promise<AgentResult> {
    const opportunityId = ctx.payload.opportunityId as string | undefined;
    if (!opportunityId) return { ok: false, summary: "no opportunityId in payload" };

    const opp = await queryOne<
      Pick<Opportunity, "id" | "title" | "agency" | "solicitation_number"> & {
        solicitation_text: string | null;
        solicitation_analysis: unknown;
      }
    >(
      `select id, title, agency, solicitation_number, solicitation_text, solicitation_analysis
         from opportunities where id=$1`,
      [opportunityId]
    );
    if (!opp) return { ok: false, summary: `opportunity ${opportunityId} not found` };

    const bid = await queryOne<
      Pick<Bid, "id" | "compliance_matrix" | "validation_json" | "audit_findings">
    >(
      `select id, compliance_matrix, validation_json, audit_findings
         from bids where opportunity_id=$1 order by created_at desc limit 1`,
      [opportunityId]
    );
    if (!bid) return { ok: true, summary: "no bid to audit yet" };

    const matrix = (bid.compliance_matrix ?? []) as ResolvedRequirement[];
    const validation = (bid.validation_json ?? null) as PackageValidation | null;
    // Deterministic eligibility findings (elig_*) are preserved across audits,
    // keeping their acknowledged state; the AI findings (af_*) are refreshed.
    const preserved = (bid.audit_findings ?? []).filter((f) => f.id.startsWith("elig_"));
    const profile = await getProfileJson();
    const solText = opp.solicitation_text ?? "";

    // Nothing to audit against, keep eligibility findings, skip the AI pass.
    if (!profile || solText.trim().length < 40) {
      const ready = computeReady(validation, preserved);
      await query(
        `update bids set audit_findings=$2, audit_status='skipped', package_ready=$3 where id=$1`,
        [bid.id, JSON.stringify(preserved), ready]
      );
      return { ok: true, summary: "AI audit skipped (no solicitation text or profile)" };
    }

    let findings: AuditFinding[];
    try {
      const { data, usage } = await completeJson(
        buildAuditPrompt(opp, solText, matrix, profile),
        { schema: FindingsSchema, model: config.claude.modelSmart, maxTokens: 4096 }
      );
      const aiFindings: AuditFinding[] = data.findings.map((f, i) => ({
        id: `af_${i + 1}`,
        severity: f.severity,
        category: f.category,
        finding: noEmDash(f.finding),
        recommendation: noEmDash(f.recommendation),
        requirement_id: f.requirement_id,
        acknowledged: false,
      }));
      // Deterministic eligibility findings first, then the AI findings.
      findings = [...preserved, ...aiFindings];
      await logAgent({
        agent: "compliance-auditor",
        action: "audit",
        opportunityId,
        bidId: bid.id,
        level: findings.some((f) => f.severity === "blocker") ? "warn" : "info",
        message: `Audit: ${findings.filter((f) => f.severity === "blocker").length} blocker(s), ${
          findings.filter((f) => f.severity === "warning").length
        } warning(s). ${data.overall}`.slice(0, 500),
        claudeUsage: usage,
      });
    } catch (err) {
      if (err instanceof ClaudeNotConfiguredError) {
        const ready = computeReady(validation, preserved);
        await query(
          `update bids set audit_findings=$2, audit_status='skipped', package_ready=$3 where id=$1`,
          [bid.id, JSON.stringify(preserved), ready]
        );
        return { ok: true, summary: "AI audit skipped (Claude not configured)" };
      }
      // Any other error: keep eligibility findings, skip the AI pass.
      const ready = computeReady(validation, preserved);
      await query(
        `update bids set audit_findings=$2, audit_status='skipped', package_ready=$3 where id=$1`,
        [bid.id, JSON.stringify(preserved), ready]
      );
      await logAgent({
        agent: "compliance-auditor",
        action: "audit",
        opportunityId,
        level: "warn",
        message: `Audit errored, skipped: ${(err as Error).message}`,
      });
      return { ok: true, summary: `audit skipped (error): ${(err as Error).message}` };
    }

    const status = findings.some((f) => f.severity === "blocker")
      ? "issues"
      : findings.length > 0
        ? "issues"
        : "clean";
    const ready = computeReady(validation, findings);

    await query(
      `update bids set audit_findings=$2, audit_status=$3, package_ready=$4 where id=$1`,
      [bid.id, JSON.stringify(findings), status, ready]
    );
    // Surface an unmet audit as human-action so it shows on Today.
    if (!ready) {
      await query(`update opportunities set human_action_required=true where id=$1`, [
        opportunityId,
      ]);
    }

    return {
      ok: true,
      summary: `Compliance audit complete: ${findings.length} finding(s); package ${
        ready ? "ready" : "not ready"
      }.`,
      data: { findings: findings.length, ready },
    };
  },
};
