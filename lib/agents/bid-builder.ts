/**
 * BID BUILDER, triggered when a sub quote is entered for an opportunity.
 * Aggregates all sub quotes, prices the bid to the target margin, generates a
 * past-performance narrative (when the solicitation allows a team past-perf
 * approach), runs a QA checklist, renders PDF + DOCX bid documents, and upserts
 * the bids row. Always leaves the opportunity flagged for human review + submit.
 *
 * Past-performance gating:
 *  - prime_only    -> BLOCK, flag for human review, do NOT build docs.
 *  - team_accepted -> generate an experience narrative from sub project history.
 *  - not_required  -> omit the narrative.
 */
import { query, queryOne, transaction } from "../db";
import { createHash, randomUUID } from "node:crypto";
import { getProfileJson } from "../ai/companyProfile";
import { complete, ClaudeNotConfiguredError } from "../ai/claude";
import { logAgent } from "../logger";
import { noEmDash } from "../sanitize";
import { storage, type StorageBackend } from "../integrations/storage";
import { documents, type BidDocData } from "../integrations/documents";
import {
  bidForTargetMargin,
  marginFromBid,
  markupForTargetMargin,
  selectQuotesForBid,
  offerLineItems,
  isOutOfRange,
} from "../domain/pricing";
import { benchmarkFor } from "../domain/comp-reliability";
import {
  resolveRequirements,
  buildManifest,
  validatePackage,
  computeReady,
  confirmedKeys,
  requirementKeys,
  requirementsFingerprint,
} from "../domain/package";
import { checkEligibility } from "../domain/eligibility";
import { matchOfficialForm } from "../domain/official-form";
import { competitivePositioningBrief } from "../domain/competition";
import {
  priceRow,
  pricingSheet,
  type PricedRow,
  type RowContext,
} from "../domain/pricing-row";
import {
  EDITABLE_OPPORTUNITY_STAGES,
  opportunityMutationProblem,
} from "../domain/opportunity-lifecycle";
import { pricingRowsWithQuotes } from "../pricing-rows";
import { opportunityCompetitors } from "../data";
import { retrieveRelevantContent, renderContentForPrompt } from "../ai/contentLibrary";
import { assemblePackageDocuments } from "./package-builder";
import { expectedPursuitVersion } from "../pursuit-job-context";
import type { AgentDefinition } from "./types";
import type {
  AgentResult,
  Opportunity,
  CompanyProfileJson,
  QaChecklistItem,
  ProjectHistoryItem,
  SolicitationAnalysis,
  ResolvedRequirement,
} from "../types";

interface QuoteRow {
  id: string;
  opportunity_id: string;
  subcontractor_id: string | null;
  trade: string | null;
  quote_amount: string | number;
  payment_terms: string | null;
  notes: string | null;
  is_out_of_range: boolean;
  comparison_json: Record<string, unknown> | null;
}

interface GeneratedBidDocument {
  name: string;
  storage_path: string;
  storage_backend: StorageBackend;
  content_hash: string;
  kind: string;
}

async function publishGeneratedDocuments(
  opportunityId: string,
  orgId: string,
  pursuitVersion: number,
  docs: GeneratedBidDocument[]
): Promise<boolean> {
  if (docs.length === 0) return true;
  const kinds = docs.map((doc) => doc.kind);
  return transaction(async (client) => {
    const draft = await client.query<{ id: string }>(
      `select b.id from bids b
        join opportunities o on o.id=b.opportunity_id and o.org_id=b.org_id
       where b.opportunity_id=$1 and b.org_id=$2 and b.submission_state='package_ready'
         and o.pursuit_version=$3 and o.status='open'
         and coalesce(o.pursuit_state, 'active')='active'
         and o.stage=any($4::text[])
       order by b.created_at desc limit 1
       for update of o, b`,
      [opportunityId, orgId, pursuitVersion, EDITABLE_OPPORTUNITY_STAGES]
    );
    if (draft.rows.length === 0) return false;
    await client.query(
      `delete from documents
        where opportunity_id=$1 and org_id=$2 and kind=any($3::text[])`,
      [opportunityId, orgId, kinds]
    );
    for (const doc of docs) {
      const mime =
        doc.kind === "bid_docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/pdf";
      await client.query(
        `insert into documents
           (org_id, opportunity_id, kind, name, storage_path, storage_backend, mime,
            content_hash, disposition, extraction_state)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'delivered','not_applicable')`,
        [
          orgId,
          opportunityId,
          doc.kind,
          doc.name,
          doc.storage_path,
          doc.storage_backend,
          mime,
          doc.content_hash,
        ]
      );
    }
    return true;
  });
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export const bidBuilder: AgentDefinition = {
  name: "bid-builder",
  label: "Bid Builder",
  description:
    "Aggregates sub quotes, prices to target margin, drafts narrative + QA, renders PDF/DOCX, and stages the bid for operator review.",
  cron: undefined,
  // Pricing, documents, compliance matrix, and QA are all deterministic; the
  // narrative has a rule-based fallback when Claude is unavailable. Marking
  // this false would dead-end the pipeline at quote_entry without an API key.
  worksWithoutClaude: true,
  async handler(ctx): Promise<AgentResult> {
    const opportunityId = ctx.payload.opportunityId as string | undefined;
    if (!opportunityId) return { ok: false, summary: "no opportunityId in payload" };

    const opp = await queryOne<Opportunity>(`select * from opportunities where id = $1`, [
      opportunityId,
    ]);
    if (!opp) return { ok: false, summary: `opportunity ${opportunityId} not found` };
    if (!opp.org_id) {
      return {
        ok: false,
        permanent: true,
        summary: `Opportunity ${opportunityId} has no account owner, so its bid was not built.`,
        humanActionRequired: true,
      };
    }
    const observedPursuitVersion = Number(opp.pursuit_version);
    const buildPursuitVersion =
      expectedPursuitVersion(opportunityId) ?? observedPursuitVersion;
    if (!Number.isInteger(buildPursuitVersion) || buildPursuitVersion < 1) {
      return {
        ok: false,
        permanent: true,
        summary: "The pursuit version could not be verified, so the bid was not built.",
        humanActionRequired: true,
      };
    }

    const existingBidAtStart = await queryOne<{ id: string; submission_state: string }>(
      `select id, submission_state from bids where opportunity_id=$1
        and org_id=$2
        order by created_at desc limit 1`,
      [opportunityId, opp.org_id]
    );
    const lifecycleProblem = opportunityMutationProblem(
      {
        stage: opp.stage,
        status: opp.status,
        pursuitState: opp.pursuit_state,
        submissionState: existingBidAtStart?.submission_state ?? null,
      },
      "bid_build"
    );
    if (lifecycleProblem) {
      await logAgent({
        agent: "bid-builder",
        action: "build-blocked",
        opportunityId,
        level: "warn",
        message: lifecycleProblem,
      });
      return {
        ok: false,
        permanent: true,
        summary: lifecycleProblem,
        humanActionRequired: true,
      };
    }

    // Trial meter, before any Claude call or document render. A bid package is
    // the most expensive thing the platform builds, so the check sits ahead of
    // the work rather than beside the insert.
    const { checkTrialQuota } = await import("../billing/trial-limits");
    const quota = await checkTrialQuota(opp.org_id, "bid_packages");
    if (!quota.allowed) {
      return { ok: false, summary: quota.message ?? "Trial limit reached.", humanActionRequired: true };
    }

    const profile = await getProfileJson();
    if (!profile) return { ok: false, summary: "no active Company Profile" };

    const [allQuotes, pricingRows] = await Promise.all([
      query<QuoteRow>(`select * from quotes where opportunity_id = $1 and org_id = $2`, [
        opportunityId,
        opp.org_id,
      ]),
      pricingRowsWithQuotes(opportunityId, opp.org_id),
    ]);
    if (allQuotes.length === 0 && pricingRows.length === 0) {
      return {
        ok: true,
        summary: `No pricing entered yet for opportunity ${opportunityId}; nothing to build.`,
      };
    }

    // Only price against quotes with a real positive amount. A NULL/zero quote
    // must never silently drop a sub's cost out of the bid total.
    const quotes = allQuotes.filter((q) => num(q.quote_amount) > 0);
    const invalidCount = allQuotes.length - quotes.length;
    if (quotes.length === 0 && pricingRows.every((r) => r.baseQuote == null)) {
      await query(
        `update opportunities set human_action_required = true where id = $1 and org_id = $2`,
        [opportunityId, opp.org_id]
      );
      await logAgent({
        agent: "bid-builder",
        action: "invalid-quotes",
        opportunityId,
        level: "warn",
        message: `All ${allQuotes.length} quote(s) are missing a dollar amount. Fix the quotes before building the bid.`,
      });
      return {
        ok: true,
        summary: `All pricing for ${opportunityId} is missing amounts; flagged for review instead of building a $0 bid.`,
        humanActionRequired: true,
      };
    }
    if (invalidCount > 0) {
      await logAgent({
        agent: "bid-builder",
        action: "partial-quotes",
        opportunityId,
        level: "warn",
        message: `${invalidCount} quote(s) had no amount and were excluded from pricing. Verify before submitting.`,
      });
    }

    /**
     * One quote per trade, not all of them.
     *
     * Outreach deliberately collects competing quotes for the same scope, so
     * summing every row priced the job as though every bidder were hired at
     * once: three electricians on one trade made the bid three electricians
     * wide, and each appeared as its own line item on the document the agency
     * reads.
     */
    const selection = selectQuotesForBid(
      quotes.map((q) => ({
        id: String(q.id),
        subcontractor_id: q.subcontractor_id ? String(q.subcontractor_id) : null,
        trade: q.trade ?? null,
        quote_amount: num(q.quote_amount),
      }))
    );
    const requiredTradeList = requiredTrades(opp);
    const pricingContext: RowContext = {
      now: new Date(),
      bidDueAt: opp.deadline ? new Date(opp.deadline) : null,
      quoteValidityRequired: (opp.solicitation_analysis?.compliance_matrix ?? []).some((r) =>
        /quote\s+validity|price\s+validity|prices?\s+(?:must\s+)?(?:remain|held|hold)/i.test(
          `${r?.title ?? ""} ${r?.instructions ?? ""} ${r?.format ?? ""}`
        )
      ),
    };
    const reviewedSheet = pricingSheet(requiredTradeList, pricingRows, pricingContext);
    // A stored pricing row is the reviewed source of truth. Quote records are
    // evidence feeding that row, not a second total for the builder to choose.
    const pricedRows: PricedRow[] =
      requiredTradeList.length > 0
        ? reviewedSheet.rows
        : pricingRows.map((row) => priceRow(row, pricingContext));
    const pricingBlockers =
      requiredTradeList.length > 0
        ? reviewedSheet.blockers
        : pricedRows.flatMap((row) => row.problems.filter((p) => p.severity === "blocker"));
    const rowTotals = pricedRows.map((row) => row.total);
    const subQuoteTotal =
      requiredTradeList.length > 0
        ? reviewedSheet.cost
        : rowTotals.some((total) => total == null)
          ? null
          : rowTotals.reduce<number>((sum, total) => sum + (total ?? 0), 0);

    if (subQuoteTotal == null || pricingBlockers.length > 0) {
      const messages = pricingBlockers.map((problem) => problem.message);
      await query(
        `update opportunities set human_action_required=true
          where id=$1 and org_id=$2 and status='open'
            and coalesce(pursuit_state, 'active')='active'`,
        [opportunityId, opp.org_id]
      );
      await query(
        `update bids set package_ready=false, audit_status='pending', updated_at=now()
          where opportunity_id=$1 and org_id=$2 and submission_state='package_ready'`,
        [opportunityId, opp.org_id]
      );
      await logAgent({
        agent: "bid-builder",
        action: "pricing-incomplete",
        opportunityId,
        level: "warn",
        message: `The bid was not rebuilt because pricing is incomplete: ${messages.join(" ")}`.slice(
          0,
          500
        ),
        output: { blockers: messages },
      });
      return {
        ok: true,
        summary:
          messages.length > 0
            ? `Pricing needs attention before the bid can be rebuilt: ${messages.join(" ")}`
            : "Pricing needs attention before the bid can be rebuilt.",
        humanActionRequired: true,
        data: { blockers: messages },
      };
    }

    if (selection.contestedTrades.length > 0) {
      // The cheapest is a sound default and not a decision. Say which trades
      // had a choice made in them so a person confirms before submission.
      await logAgent({
        agent: "bid-builder",
        action: "quote-selection",
        opportunityId,
        level: "info",
        message:
          `Priced from the lowest quote in each trade. More than one quote was on file for: ` +
          `${selection.contestedTrades.join(", ")}. ${selection.alternates.length} other ` +
          `quote(s) were left out of the total and are still on the opportunity to compare.`,
      });
    }
    const pastPerf = opp.past_perf_classification;

    // --- prime_only: block + flag, do not build documents. ---
    if (pastPerf === "prime_only") {
      const humanFlags = ["prime_only"];
      const oppFlags = Array.from(new Set([...(opp.risk_flags ?? []), "prime_only"]));
      const blockedBid = await query<{ id: string }>(
        // One bid per opportunity: a re-run of the prime_only block updates the
        // existing row's flags rather than stacking a second row (which the
        // unique index would now reject anyway).
        `with eligible as (
           select id from opportunities
            where id=$2 and org_id=$1 and pursuit_version=$5
              and status='open' and coalesce(pursuit_state, 'active')='active'
              and stage=any($6::text[])
            for update
         )
         insert into bids
           (org_id, opportunity_id, sub_quote_total, human_flags, outcome)
         select $1,$2,$3,$4,'pending' from eligible
         on conflict (opportunity_id) do update set
           sub_quote_total=excluded.sub_quote_total,
           human_flags=excluded.human_flags, outcome='pending', updated_at=now()
         where bids.org_id=excluded.org_id and bids.submission_state='package_ready'
         returning id`,
        [
          opp.org_id,
          opportunityId,
          subQuoteTotal,
          humanFlags,
          buildPursuitVersion,
          EDITABLE_OPPORTUNITY_STAGES,
        ]
      );
      if (blockedBid.length === 0) {
        return {
          ok: false,
          permanent: true,
          summary: "The approved or sent package is locked and was not changed.",
          humanActionRequired: true,
        };
      }
      await query(
        `update opportunities
            set human_action_required = true, risk_flags = $2
          where id = $1 and org_id = $3`,
        [opportunityId, oppFlags, opp.org_id]
      );
      await logAgent({
        agent: "bid-builder",
        action: "block-prime-only",
        opportunityId,
        level: "warn",
        message: "Past performance is prime_only, blocked, flagged for human review.",
        reasoning:
          "Solicitation requires prime past performance we cannot yet meet; no bid documents generated.",
      });
      return {
        ok: true,
        summary:
          "Past performance is prime_only, blocked and flagged for human review (no documents built).",
        reasoning: "prime_only past-performance requirement cannot be met as a team.",
        humanActionRequired: true,
      };
    }

    // --- Pricing. ---
    const bidAmount = bidForTargetMargin(subQuoteTotal, profile.target_margin_pct);
    const marginPct = marginFromBid(subQuoteTotal, bidAmount);
    const markupPct = markupForTargetMargin(profile.target_margin_pct);
    const markupAmount = Math.round((bidAmount - subQuoteTotal + Number.EPSILON) * 100) / 100;

    // --- Narrative. ---
    let narrative: string | null = null;
    if (pastPerf === "team_accepted") {
      narrative = await buildNarrative(opportunityId, opp, profile);
    }

    // --- QA checklist. ---
    const qaChecklist = buildQaChecklist({
      opp,
      profile,
      quotes,
      subQuoteTotal,
      bidAmount,
      marginPct,
      narrative,
      pricedTrades: pricedRows.map((row) => row.row.trade),
    });
    const failing = qaChecklist.filter((q) => !q.ok);

    // --- Line items. ---
    // Cost basis, for the record and for internal review.
    const costLineItems: Array<{ label: string; amount: number }> = pricedRows.map((row) => ({
      label: row.row.trade || "Subcontractor",
      amount: row.total!,
    }));
    // What the agency sees: a price per scope. The markup is carried inside
    // the scope lines rather than announced on its own line next to our
    // target margin, which is what the submitted schedule used to do.
    const lineItems = offerLineItems(costLineItems, bidAmount);

    // --- Documents. ---
    const docData: BidDocData = {
      company_name: profile.legal_name,
      opportunity_title: opp.title ?? "(untitled opportunity)",
      solicitation_number: opp.solicitation_number ?? undefined,
      agency: opp.agency ?? undefined,
      bid_amount: bidAmount,
      margin_pct: marginPct,
      line_items: lineItems,
      narrative: narrative ?? undefined,
      qa_checklist: qaChecklist,
    };

    // Every build gets immutable object keys. If approval races with this
    // worker, these bytes cannot replace the package that was approved.
    const buildToken = randomUUID();
    const pdfBuffer = await documents.buildBidPdf(docData);
    const docxBuffer = await documents.buildBidDocx(docData);
    const pdfKey = `bids/${opportunityId}/${buildToken}/bid.pdf`;
    const docxKey = `bids/${opportunityId}/${buildToken}/bid.docx`;
    const pdfUpload = await storage.upload(pdfKey, pdfBuffer, "application/pdf");
    const docxUpload = await storage.upload(
      docxKey,
      docxBuffer,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    const pdfHash = createHash("sha256").update(pdfBuffer).digest("hex");
    const docxHash = createHash("sha256").update(docxBuffer).digest("hex");

    const documentsJson = [
      {
        name: "Bid PDF",
        storage_path: pdfUpload.path,
        storage_backend: pdfUpload.backend,
        content_hash: pdfHash,
        kind: "bid_pdf",
      },
      {
        name: "Bid DOCX",
        storage_path: docxUpload.path,
        storage_backend: docxUpload.backend,
        content_hash: docxHash,
        kind: "bid_docx",
      },
    ];

    // --- Submission compliance matrix + assembled package. ---
    const analysis = (opp.solicitation_analysis as SolicitationAnalysis | null) ?? null;
    const requirements = [...(analysis?.compliance_matrix ?? [])];
    // If amendments were issued but no acknowledgment requirement was captured,
    // add one, unacknowledged amendments are a common rejection reason.
    const amendments = analysis?.qa_addenda ?? [];
    if (
      amendments.length > 0 &&
      !requirements.some((r) => r.category === "acknowledgment")
    ) {
      requirements.push({
        id: "amendment_ack",
        title: "Acknowledgment of amendments",
        category: "acknowledgment",
        mandatory: true,
        source: "Amendments issued to this solicitation",
        signature_required: true,
        satisfied_by: "operator_signature",
      });
    }
    // Preserve operator confirmations (signed/uploaded) across rebuilds.
    const priorBid = await queryOne<{ compliance_matrix: ResolvedRequirement[] | null }>(
      // Newest, matching every reader (the download route, submit, preview,
      // requirements, and the auditor all use desc). The builder used to read
      // and write the OLDEST row, so on an opportunity with two bid rows (the
      // prime_only path inserts one unconditionally) the manifest was written
      // where nothing looks for it and the download reported "no package".
      `select compliance_matrix from bids
        where opportunity_id = $1 and org_id = $2
        order by created_at desc limit 1`,
      [opportunityId, opp.org_id]
    );
    // Keyed by every identity the requirement had, not just the model's slug:
    // a re-analysis regenerates those slugs, and matching on the slug alone
    // threw away confirmations the operator had already made.
    const confirmed = confirmedKeys(priorBid?.compliance_matrix ?? []);
    // The file the operator already uploaded for a requirement survives a
    // rebuild too. Without this the rebuild kept their confirmation (matched
    // above) but dropped the attachment, so the item read as done and the
    // manifest pointed at nothing again.
    const priorDocs = new Map<
      string,
      { name: string; path: string; mime?: string; content_hash?: string }
    >();
    for (const r of priorBid?.compliance_matrix ?? []) {
      if (!r.operator_doc) continue;
      for (const k of requirementKeys(r)) priorDocs.set(k, r.operator_doc);
    }
    const hasIdentifiers = Boolean(profile.uei || profile.cage_code);
    const resolved = resolveRequirements(requirements, {
      confirmed,
      hasNarrative: Boolean(narrative),
      hasIdentifiers,
      agencyScheduleLines: analysis?.bid_schedule?.length ?? 0,
    });

    for (const r of resolved) {
      if (r.operator_doc) continue;
      const doc = requirementKeys(r)
        .map((k) => priorDocs.get(k))
        .find(Boolean);
      if (doc) {
        r.operator_doc = doc;
        r.operator_confirmed = true;
        r.status = "satisfied";
        r.note = `Your uploaded "${doc.name}" is included in the package for this item.`;
      }
    }

    // Link required official forms to the ACTUAL blank form when it's among the
    // solicitation attachments, so the operator signs the real agency document.
    const solDocs = await query<{ name: string; storage_path: string | null }>(
      `select name, storage_path from documents
        where opportunity_id=$1 and org_id=$2 and kind='solicitation'`,
      [opportunityId, opp.org_id]
    );
    for (const r of resolved) {
      if (!r.official_form || !r.official_form_doc) {
        const match = matchOfficialForm(r.official_form, solDocs);
        if (match?.storage_path) {
          r.official_form_doc = { name: match.name, path: match.storage_path };
          r.note = `The agency's ${r.official_form} is attached to the solicitation, sign that form and include it.`;
        }
      }
    }

    let packageDocs: {
      name: string;
      storage_path: string;
      kind: string;
      storage_backend: StorageBackend;
      content_hash: string;
    }[] = [];
    if (resolved.length > 0) {
      try {
        packageDocs = await assemblePackageDocuments({
          opportunityId,
          opp,
          profile,
          resolved,
          lineItems,
          bidAmount,
          buildToken,
          amendments: amendments.map((a) => ({
            label: a.label,
            date: a.date,
            summary: a.summary,
          })),
        });
      } catch (err) {
        await logAgent({
          agent: "bid-builder",
          action: "package-docs",
          opportunityId,
          level: "warn",
          message: `Package document generation had an issue: ${(err as Error).message}`,
        });
      }
    }

    const manifest = buildManifest(resolved, opp.solicitation_number);
    const pricingReconciles =
      Math.abs(bidAmount - (subQuoteTotal + markupAmount)) < 1; // within $1 rounding
    const validation = validatePackage({
      resolved,
      hasIdentifiers,
      pricingReconciles,
      bidAmount,
      nowIso: new Date().toISOString(),
      // Every document kind actually written this build: if package assembly
      // failed above (caught + logged), the missing artifacts block readiness
      // here instead of shipping a "ready" package with absent files.
      presentDocKinds: new Set([...documentsJson, ...packageDocs].map((d) => d.kind)),
    });

    // Hard gate: every required trade must have a positive quote before the
    // package can be considered ready for submission.
    const missingTrades = reviewedSheet.missingTrades;
    if (missingTrades.length > 0) {
      for (const t of missingTrades) {
        validation.blockers.push(
          `${t} pricing has not been received. Enter a quote for this required trade before submission.`
        );
      }
      validation.passed = false;
    }

    // Deterministic eligibility findings (set-aside, NAICS, bonding, SAM). These
    // are preserved by the AI auditor and gate submission immediately.
    const eligibilityFindings = checkEligibility({ profile, opp, analysis });
    const packageReady =
      computeReady(validation, eligibilityFindings) && missingTrades.length === 0;

    // Merge generated package docs into documents_json (dedupe by kind).
    for (const d of packageDocs) {
      if (!documentsJson.some((x) => x.kind === d.kind)) documentsJson.push(d);
    }

    const humanFlags = [
      ...(failing.length ? ["qa_failures"] : []),
      ...(validation.passed ? [] : ["package_incomplete"]),
      ...(resolved.length === 0 ? ["requirements_missing"] : []),
    ];

    // An unextracted requirements matrix is not a package problem to discover
    // inside the package view; it means this bid cannot be assembled at all.
    // Say so where the operator actually looks: on the opportunity, in the
    // log, and by asking for a person.
    if (resolved.length === 0) {
      await query(
        `update opportunities
            set human_action_required = true,
                risk_flags = (
                  select array(select distinct unnest(coalesce(risk_flags,'{}') || array['requirements_missing']))
                )
          where id = $1 and org_id = $2`,
        [opportunityId, opp.org_id]
      );
      await logAgent({
        agent: "bid-builder",
        action: "requirements-missing",
        opportunityId,
        level: "error",
        status: "error",
        message:
          "No submission requirements were extracted for this solicitation, so the package would have been empty. The bid is held: re-run the analysis, and if the documents are scans with no readable text, add the required items by hand.",
        reasoning:
          "solicitation_analysis.compliance_matrix was empty, which means the analysis never ran or could not read the documents, not that the solicitation asks for nothing.",
      });
    }

    // --- Upsert the bid (one bid per opportunity). ---
    // What this package is being assembled from. Stored so a later re-analysis
    // (an amendment, a scan finally transcribed) can be seen to have moved the
    // requirements out from under an already-built package.
    const builtFingerprint = requirementsFingerprint(requirements, amendments);

    const existing = await queryOne<{ id: string }>(
      `select id from bids where opportunity_id = $1 and org_id = $2
        order by created_at desc limit 1`,
      [opportunityId, opp.org_id]
    );
    let persisted: { id: string }[];
    if (existing) {
      persisted = await query<{ id: string }>(
        `with eligible as (
           select id from opportunities
            where id=$18 and org_id=$17 and pursuit_version=$19
              and status='open' and coalesce(pursuit_state, 'active')='active'
              and stage=any($20::text[])
            for update
         )
         update bids
            set sub_quote_total=$2, markup_pct=$3, bid_amount=$4, margin_pct=$5,
                target_margin_pct=$6, qa_checklist=$7, narrative=$8, documents_json=$9,
                human_flags=$10, outcome='pending',
                compliance_matrix=$11, package_manifest=$12, package_ready=$13, validation_json=$14,
                audit_findings=$15, audit_status='pending', requirements_fingerprint=$16,
                updated_at=now()
           from eligible
          where bids.id=$1 and bids.org_id=$17 and bids.opportunity_id=eligible.id
            and bids.submission_state='package_ready'
          returning id`,
        [
          existing.id,
          subQuoteTotal,
          markupPct,
          bidAmount,
          marginPct,
          profile.target_margin_pct,
          JSON.stringify(qaChecklist),
          narrative,
          JSON.stringify(documentsJson),
          humanFlags,
          JSON.stringify(resolved),
          JSON.stringify(manifest),
          packageReady,
          JSON.stringify(validation),
          JSON.stringify(eligibilityFindings),
          builtFingerprint,
          opp.org_id,
          opportunityId,
          buildPursuitVersion,
          EDITABLE_OPPORTUNITY_STAGES,
        ]
      );
    } else {
      persisted = await query<{ id: string }>(
        // on conflict: if a concurrent build inserted the row between our read
        // and this write, become an update instead of a second row. The unique
        // index on opportunity_id (migration 058) is what makes this atomic;
        // without the clause the second insert would raise instead.
        `with eligible as (
           select id from opportunities
            where id=$2 and org_id=$1 and pursuit_version=$18
              and status='open' and coalesce(pursuit_state, 'active')='active'
              and stage=any($19::text[])
            for update
         )
         insert into bids
           (org_id, opportunity_id, sub_quote_total, markup_pct, bid_amount, margin_pct,
            target_margin_pct, qa_checklist, narrative, documents_json, human_flags, outcome,
            compliance_matrix, package_manifest, package_ready, validation_json,
            audit_findings, audit_status, requirements_fingerprint)
         select $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,$13,$14,$15,$16,'pending',$17
           from eligible
         on conflict (opportunity_id) do update set
           sub_quote_total=excluded.sub_quote_total, markup_pct=excluded.markup_pct,
           bid_amount=excluded.bid_amount, margin_pct=excluded.margin_pct,
           target_margin_pct=excluded.target_margin_pct, qa_checklist=excluded.qa_checklist,
           narrative=excluded.narrative, documents_json=excluded.documents_json,
           human_flags=excluded.human_flags, outcome='pending',
           compliance_matrix=excluded.compliance_matrix, package_manifest=excluded.package_manifest,
           package_ready=excluded.package_ready, validation_json=excluded.validation_json,
           audit_findings=excluded.audit_findings, audit_status='pending',
           requirements_fingerprint=excluded.requirements_fingerprint, updated_at=now()
         where bids.org_id=excluded.org_id and bids.submission_state='package_ready'
         returning id`,
        [
          opp.org_id,
          opportunityId,
          subQuoteTotal,
          markupPct,
          bidAmount,
          marginPct,
          profile.target_margin_pct,
          JSON.stringify(qaChecklist),
          narrative,
          JSON.stringify(documentsJson),
          humanFlags,
          JSON.stringify(resolved),
          JSON.stringify(manifest),
          packageReady,
          JSON.stringify(validation),
          JSON.stringify(eligibilityFindings),
          builtFingerprint,
          buildPursuitVersion,
          EDITABLE_OPPORTUNITY_STAGES,
        ]
      );
    }

    if (persisted.length === 0) {
      await logAgent({
        agent: "bid-builder",
        action: "build-blocked",
        opportunityId,
        level: "warn",
        message:
          "The package was approved or sent while a rebuild was running. The approved package was left unchanged.",
      });
      return {
        ok: false,
        permanent: true,
        summary:
          "The package was approved or sent while this rebuild was running, so the rebuild was discarded.",
        humanActionRequired: true,
      };
    }

    // The bid row is the package version. Publish its document pointers only
    // after the guarded bid write succeeds, so a discarded racing build never
    // becomes the current file list for an approved package.
    const pointersPublished = await publishGeneratedDocuments(
      opportunityId,
      opp.org_id,
      buildPursuitVersion,
      documentsJson
    );
    if (!pointersPublished) {
      await logAgent({
        agent: "bid-builder",
        action: "document-pointers-not-published",
        opportunityId,
        level: "warn",
        message:
          "The package was approved while its Files entries were being published. The approved bid still keeps the exact immutable document paths, but the Files list may show the prior draft.",
      });
    }

    const moved = await query<{ id: string }>(
      `update opportunities set stage='bid_building', human_action_required=true
        where id=$1 and org_id=$2 and status='open' and stage=any($3::text[])
          and coalesce(pursuit_state, 'active')='active'
          and pursuit_version=$4
        returning id`,
      [opportunityId, opp.org_id, EDITABLE_OPPORTUNITY_STAGES, buildPursuitVersion]
    );
    if (moved.length === 0) {
      await logAgent({
        agent: "bid-builder",
        action: "stage-not-regressed",
        opportunityId,
        level: "warn",
        message:
          "The bid package was built, but the opportunity reached a locked state before its stage could be updated. Its current stage was preserved.",
      });
    }

    await logAgent({
      agent: "bid-builder",
      action: "build-bid",
      opportunityId,
      level: "success",
      message: `Built bid $${bidAmount.toLocaleString()} at ${marginPct.toFixed(1)}% margin (${
        failing.length
      } QA failures).`,
      reasoning: `sub_quote_total=${subQuoteTotal}; priced to target ${profile.target_margin_pct}% margin; ${quotes.length} quotes.`,
      output: { bidAmount, marginPct, markupPct, failing: failing.map((f) => f.item) },
    });

    const failNote = failing.length
      ? `, QA failing: ${failing.map((f) => f.item).join("; ")}`
      : "";
    return {
      ok: true,
      summary: `Bid staged: $${bidAmount.toLocaleString()} at ${marginPct.toFixed(
        1
      )}% margin${failNote}. Operator review + submit required.`,
      reasoning: `Aggregated ${quotes.length} quotes ($${subQuoteTotal.toLocaleString()}), priced to target margin, rendered PDF/DOCX, staged for review.`,
      data: {
        bidAmount,
        marginPct,
        markupPct,
        subQuoteTotal,
        failingQa: failing.map((f) => f.item),
      },
      humanActionRequired: true,
      // Kick the independent compliance audit (singleton per opportunity).
      enqueued: [
        {
          agent: "compliance-auditor",
          payload: { opportunityId },
          opts: { singletonKey: `audit:${opportunityId}`, singletonSeconds: 120 },
        },
      ],
    };
  },
};

/** Build a 1-2 paragraph experience narrative from the subs' project history. */
async function buildNarrative(
  opportunityId: string,
  opp: Opportunity,
  profile: CompanyProfileJson
): Promise<string | null> {
  const subs = await query<{ company_name: string; project_history: ProjectHistoryItem[] }>(
    `select s.company_name, s.project_history
      from subcontractors s
       join opportunity_subs os on os.subcontractor_id = s.id
      where os.opportunity_id = $1 and s.org_id = $2`,
    [opportunityId, opp.org_id]
  );
  const historyLines: string[] = [];
  for (const s of subs) {
    const hist = Array.isArray(s.project_history) ? s.project_history : [];
    for (const h of hist) {
      historyLines.push(
        `${s.company_name}: ${h.name} (${h.scope}, ${h.client_type}, ${h.year}, $${num(
          h.value
        ).toLocaleString()})`
      );
    }
  }

  if (historyLines.length === 0) {
    return "Our assembled team brings directly relevant trade experience to this scope of work. Detailed project references are available upon request.";
  }

  // Competitive positioning, derived from the CPI-adjusted award history Pricing
  // Research already gathered for this NAICS + state. It only shapes emphasis
  // (what to lead with), never introduces competitor names or facts, so the
  // narrative stays grounded in the team's own verifiable history.
  const competitors = await opportunityCompetitors(opportunityId);
  const positioning = competitivePositioningBrief(competitors);

  // Pre-approved reusable content matched to this job's trades, agency, and
  // NAICS. Retrieval degrades to nothing when the library is empty or absent, so
  // this only ever adds vetted language the operator already stands behind.
  const reusable = renderContentForPrompt(
    await retrieveRelevantContent({
      categories: ["past_performance", "win_theme", "technical_approach"],
      tags: [...requiredTrades(opp), opp.agency ?? "", opp.naics_code ?? ""].filter(Boolean),
      limit: 3,
    })
  );

  const prompt = [
    "Write a concise past-performance / experience narrative (1-2 paragraphs) for a government bid, drawing on the subcontractor project history and any approved reusable content provided below. Emphasize relevance to the solicitation scope, breadth of trades, and successful delivery. Do not invent projects or add facts beyond what is provided. Do not use em dashes.",
    "",
    `SOLICITATION: ${opp.title ?? "(untitled)"}${opp.agency ? `, ${opp.agency}` : ""}`,
    `SCOPE: ${(opp.description ?? "").slice(0, 1200)}`,
    ...(positioning ? ["", positioning] : []),
    ...(reusable ? ["", reusable] : []),
    "",
    "SUBCONTRACTOR PROJECT HISTORY:",
    ...historyLines.map((l) => `- ${l}`),
  ].join("\n");

  try {
    const { text, usage } = await complete(prompt, { maxTokens: 700 });
    await logAgent({
      agent: "bid-builder",
      action: "narrative",
      opportunityId,
      message: "Generated team past-performance narrative.",
      claudeUsage: usage,
    });
    return noEmDash(text.trim());
  } catch (err) {
    if (err instanceof ClaudeNotConfiguredError) {
      await logAgent({
        agent: "bid-builder",
        action: "narrative",
        opportunityId,
        level: "warn",
        status: "skipped",
        message: "Claude not configured, using a deterministic narrative fallback.",
      });
      return `Our team combines the experience of ${
        subs.length
      } qualified subcontractors with a track record across relevant trades, including: ${historyLines
        .slice(0, 5)
        .join("; ")}. References available upon request.`;
    }
    throw err;
  }
}

interface QaInputs {
  opp: Opportunity;
  profile: CompanyProfileJson;
  quotes: QuoteRow[];
  subQuoteTotal: number;
  bidAmount: number;
  marginPct: number;
  narrative: string | null;
  /** Trades included in the reviewed pricing sheet for this build. */
  pricedTrades?: string[];
}

/** Deterministic QA checklist covering pricing, margin, trades, lead time, docs, certs. */
function buildQaChecklist(i: QaInputs): QaChecklistItem[] {
  const items: QaChecklistItem[] = [];

  // 1) Pricing within comps.
  const anyOutOfRange = i.quotes.some((q) => q.is_out_of_range);
  const comps = extractCompBenchmark(i.opp);
  if (comps != null) {
    const { outOfRange, deltaPct } = isOutOfRange(
      i.bidAmount,
      comps,
      i.profile.pricing_rules.out_of_range_tolerance_pct
    );
    items.push({
      item: "Bid within pricing comps",
      ok: !outOfRange && !anyOutOfRange,
      note: `${deltaPct >= 0 ? "+" : ""}${deltaPct}% vs comp benchmark${
        anyOutOfRange ? "; one or more quotes flagged out of range" : ""
      }`,
    });
  } else {
    items.push({
      item: "Bid within pricing comps",
      ok: !anyOutOfRange,
      note: anyOutOfRange
        ? "one or more quotes flagged out of range"
        : "no comparable awards to price against",
    });
  }

  // 2) Margin >= min_margin_pct.
  items.push({
    item: `Margin >= minimum (${i.profile.min_margin_pct}%)`,
    ok: i.marginPct >= i.profile.min_margin_pct,
    note: `${i.marginPct.toFixed(1)}% actual`,
  });

  // 3) All required trades have a quote.
  const required = requiredTrades(i.opp);
  const quotedTrades = new Set(
    (i.pricedTrades ?? i.quotes.map((q) => q.trade ?? ""))
      .map((trade) => trade.trim().toLowerCase())
      .filter(Boolean)
  );
  const missing = required.filter((t) => !quotedTrades.has(t.trim().toLowerCase()));
  items.push({
    item: "All required trades quoted",
    ok: missing.length === 0,
    note: required.length
      ? missing.length
        ? `missing: ${missing.join(", ")}`
        : `${required.length} trades covered`
      : "no required-trade list; using submitted quotes",
  });

  // 4) Deadline lead time >= submit_lead_hours.
  const leadHours = i.profile.decision_thresholds.submit_lead_hours;
  if (i.opp.deadline) {
    const hoursRemaining =
      (new Date(i.opp.deadline).getTime() - Date.now()) / 3_600_000;
    items.push({
      item: `Lead time >= ${leadHours}h before deadline`,
      ok: hoursRemaining >= leadHours,
      note: `${hoursRemaining.toFixed(1)}h remaining`,
    });
  } else {
    items.push({
      item: `Lead time >= ${leadHours}h before deadline`,
      ok: false,
      note: "no deadline on record",
    });
  }

  // 5) Documents attached (attachments present on the opportunity).
  const hasDocs = (i.opp.attachments_json ?? []).length > 0;
  items.push({
    item: "Solicitation documents attached",
    ok: hasDocs,
    note: hasDocs ? `${i.opp.attachments_json.length} attachment(s)` : "none attached",
  });

  // 6) Certifications listed.
  const certs = i.profile.certifications ?? [];
  items.push({
    item: "Certifications listed",
    ok: certs.length > 0,
    note: certs.length ? certs.join(", ") : "none on profile",
  });

  return items;
}

/**
 * Pull a numeric comp benchmark from the pricing summary that Pricing Research
 * writes into opportunities.raw_json.pricing_summary. The stats live under
 * `comp_stats` (a CompStats object), reading a top-level `median` finds nothing
 * and silently disables the whole price-sanity QA gate, so read the real path,
 * falling back to the sub-cost proxy.
 */
function extractCompBenchmark(opp: Opportunity): number | null {
  const raw = opp.raw_json as Record<string, unknown> | null;
  const summary = raw?.pricing_summary as Record<string, unknown> | undefined;
  if (!summary) return null;
  const stats = (summary.comp_stats ?? summary) as Record<string, unknown>;
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const incumbent = summary.incumbent as { last_award_amount?: unknown } | null | undefined;
  /**
   * Only benchmark against comps that describe comparable work. The median of
   * a NAICS bucket spanning a $12k inspection and a $2M overhaul would fail
   * every honest bid against a ±25% tolerance, so benchmarkFor withholds it
   * and offers the incumbent's award on this recompete instead.
   */
  return benchmarkFor(
    {
      count: num(stats.count ?? summary.comp_count),
      average: num(stats.average),
      median: num(stats.median),
      p25: num(stats.p25),
      p75: num(stats.p75),
    },
    { incumbentLastAward: num(incumbent?.last_award_amount) || null }
  );
}

/** Required trades from the solicitation analysis, if present. */
function requiredTrades(opp: Opportunity): string[] {
  const analysis = opp.solicitation_analysis;
  if (analysis && Array.isArray(analysis.required_trades)) {
    return analysis.required_trades.filter(Boolean);
  }
  return [];
}
