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
import { query, queryOne } from "../db";
import { getProfileJson } from "../ai/companyProfile";
import { complete, ClaudeNotConfiguredError } from "../ai/claude";
import { logAgent } from "../logger";
import { noEmDash } from "../sanitize";
import { storage } from "../integrations/storage";
import { documents, type BidDocData } from "../integrations/documents";
import {
  bidForTargetMargin,
  marginFromBid,
  markupForTargetMargin,
  selectQuotesForBid,
  isOutOfRange,
} from "../domain/pricing";
import { resolveRequirements, buildManifest, validatePackage, computeReady } from "../domain/package";
import { checkEligibility } from "../domain/eligibility";
import { competitivePositioningBrief } from "../domain/competition";
import { opportunityCompetitors } from "../data";
import { retrieveRelevantContent, renderContentForPrompt } from "../ai/contentLibrary";
import { assemblePackageDocuments } from "./package-builder";
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

    const allQuotes = await query<QuoteRow>(`select * from quotes where opportunity_id = $1`, [
      opportunityId,
    ]);
    if (allQuotes.length === 0) {
      return {
        ok: true,
        summary: `No quotes entered yet for opportunity ${opportunityId}; nothing to build.`,
      };
    }

    // Only price against quotes with a real positive amount. A NULL/zero quote
    // must never silently drop a sub's cost out of the bid total.
    const quotes = allQuotes.filter((q) => num(q.quote_amount) > 0);
    const invalidCount = allQuotes.length - quotes.length;
    if (quotes.length === 0) {
      await query(`update opportunities set human_action_required = true where id = $1`, [
        opportunityId,
      ]);
      await logAgent({
        agent: "bid-builder",
        action: "invalid-quotes",
        opportunityId,
        level: "warn",
        message: `All ${allQuotes.length} quote(s) are missing a dollar amount. Fix the quotes before building the bid.`,
      });
      return {
        ok: true,
        summary: `All quotes for ${opportunityId} are missing amounts; flagged for review instead of building a $0 bid.`,
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
    const pricedQuotes = selection.selected;
    const subQuoteTotal = pricedQuotes.reduce((sum, q) => sum + q.quote_amount, 0);

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
      await query(
        `insert into bids
           (opportunity_id, sub_quote_total, human_flags, outcome)
         values ($1,$2,$3,'pending')`,
        [opportunityId, subQuoteTotal, humanFlags]
      );
      await query(
        `update opportunities
            set human_action_required = true, risk_flags = $2
          where id = $1`,
        [opportunityId, oppFlags]
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
    });
    const failing = qaChecklist.filter((q) => !q.ok);

    // --- Line items. ---
    const lineItems: Array<{ label: string; amount: number }> = pricedQuotes.map((q) => ({
      label: q.trade || "Subcontractor",
      amount: q.quote_amount,
    }));
    lineItems.push({
      label: `Markup ${markupPct.toFixed(1)}% (prices to ${profile.target_margin_pct}% target margin)`,
      amount: markupAmount,
    });

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

    const pdfBuffer = await documents.buildBidPdf(docData);
    const docxBuffer = await documents.buildBidDocx(docData);
    const pdfKey = `bids/${opportunityId}.pdf`;
    const docxKey = `bids/${opportunityId}.docx`;
    const pdfUpload = await storage.upload(pdfKey, pdfBuffer, "application/pdf");
    const docxUpload = await storage.upload(
      docxKey,
      docxBuffer,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );

    // Fresh document rows for this opportunity's bid (replace any prior).
    await query(`delete from documents where opportunity_id = $1 and kind in ('bid_pdf','bid_docx')`, [
      opportunityId,
    ]);
    await query(
      `insert into documents (opportunity_id, kind, name, storage_path, storage_backend, mime)
       values ($1,'bid_pdf',$2,$3,$4,'application/pdf'),
              ($1,'bid_docx',$5,$6,$7,'application/vnd.openxmlformats-officedocument.wordprocessingml.document')`,
      [
        opportunityId,
        `Bid, ${opp.title ?? opportunityId}.pdf`,
        pdfUpload.path,
        pdfUpload.backend,
        `Bid, ${opp.title ?? opportunityId}.docx`,
        docxUpload.path,
        docxUpload.backend,
      ]
    );

    const documentsJson = [
      { name: `Bid PDF`, storage_path: pdfUpload.path, kind: "bid_pdf" },
      { name: `Bid DOCX`, storage_path: docxUpload.path, kind: "bid_docx" },
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
      `select compliance_matrix from bids where opportunity_id = $1 order by created_at asc limit 1`,
      [opportunityId]
    );
    const confirmed = new Set(
      (priorBid?.compliance_matrix ?? [])
        .filter((r) => r.operator_confirmed)
        .map((r) => r.id)
    );
    const hasIdentifiers = Boolean(profile.uei || profile.cage_code);
    const resolved = resolveRequirements(requirements, {
      confirmed,
      hasNarrative: Boolean(narrative),
      hasIdentifiers,
    });

    // Link required official forms to the ACTUAL blank form when it's among the
    // solicitation attachments, so the operator signs the real agency document.
    const solDocs = await query<{ name: string; storage_path: string | null }>(
      `select name, storage_path from documents where opportunity_id=$1 and kind='solicitation'`,
      [opportunityId]
    );
    for (const r of resolved) {
      if (!r.official_form || !r.official_form_doc) {
        const token = (r.official_form ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
        if (!token) continue;
        const match = solDocs.find(
          (d) => d.storage_path && d.name.replace(/[^a-z0-9]/gi, "").toLowerCase().includes(token)
        );
        if (match?.storage_path) {
          r.official_form_doc = { name: match.name, path: match.storage_path };
          r.note = `The agency's ${r.official_form} is attached to the solicitation, sign that form and include it.`;
        }
      }
    }

    let packageDocs: { name: string; storage_path: string; kind: string }[] = [];
    if (resolved.length > 0) {
      try {
        packageDocs = await assemblePackageDocuments({
          opportunityId,
          opp,
          profile,
          resolved,
          lineItems,
          bidAmount,
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
    const requiredTradeList = requiredTrades(opp);
    const quotedTradeSet = new Set(
      quotes
        .filter((q) => Number(q.quote_amount) > 0)
        .map((q) => (q.trade ?? "").trim().toLowerCase())
        .filter(Boolean)
    );
    const missingTrades = requiredTradeList.filter(
      (t) => !quotedTradeSet.has(t.trim().toLowerCase())
    );
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
    ];

    // --- Upsert the bid (one bid per opportunity). ---
    const existing = await queryOne<{ id: string }>(
      `select id from bids where opportunity_id = $1 order by created_at asc limit 1`,
      [opportunityId]
    );
    if (existing) {
      await query(
        `update bids
            set sub_quote_total=$2, markup_pct=$3, bid_amount=$4, margin_pct=$5,
                target_margin_pct=$6, qa_checklist=$7, narrative=$8, documents_json=$9,
                human_flags=$10, outcome='pending',
                compliance_matrix=$11, package_manifest=$12, package_ready=$13, validation_json=$14,
                audit_findings=$15, audit_status='pending'
          where id=$1`,
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
        ]
      );
    } else {
      await query(
        `insert into bids
           (opportunity_id, sub_quote_total, markup_pct, bid_amount, margin_pct,
            target_margin_pct, qa_checklist, narrative, documents_json, human_flags, outcome,
            compliance_matrix, package_manifest, package_ready, validation_json,
            audit_findings, audit_status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12,$13,$14,$15,'pending')`,
        [
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
        ]
      );
    }

    await query(
      `update opportunities set stage='bid_building', human_action_required=true where id=$1`,
      [opportunityId]
    );

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
      where os.opportunity_id = $1`,
    [opportunityId]
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
      note: anyOutOfRange ? "one or more quotes flagged out of range" : "no comps",
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
    i.quotes.map((q) => (q.trade ?? "").trim().toLowerCase()).filter(Boolean)
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
  const stats = summary.comp_stats as Record<string, unknown> | undefined;
  const candidate =
    stats?.median ??
    stats?.average ??
    summary.median ?? // tolerate a flat shape too
    summary.average ??
    summary.sub_cost_proxy_estimate;
  const n = Number(candidate);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Required trades from the solicitation analysis, if present. */
function requiredTrades(opp: Opportunity): string[] {
  const analysis = opp.solicitation_analysis;
  if (analysis && Array.isArray(analysis.required_trades)) {
    return analysis.required_trades.filter(Boolean);
  }
  return [];
}
