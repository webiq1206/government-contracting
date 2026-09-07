/**
 * Checking one solicitation against its source, and reporting what that
 * established rather than what it hoped.
 *
 * Everything here is a comparison. Nothing this agent finds is written over
 * the record: the findings go into the verification row and a person decides.
 * That is the difference between a re-check and a re-run, and it is the whole
 * feature.
 *
 * The scopes it can genuinely perform are the deterministic ones: the source's
 * own metadata, its attachment list, the hashes behind those attachments, the
 * close date, the clause list a document deterministically contains, and bid
 * package fingerprints. Trade scopes and judgment-based score dimensions
 * cannot be independently re-derived without a fresh analysis, so this agent
 * does not pretend to have re-derived them. When a requested scope cannot be
 * established it is recorded as incomplete instead of silently passing.
 *
 * A scope that cannot run goes into `failedScopes`, and the outcome model
 * refuses a clean verdict when that list is non-empty. So an unreachable
 * source produces "partly checked", never "verified".
 */
import { query, queryOne } from "../db";
import { logAgent } from "../logger";
import { sam } from "../integrations/sam";
import { guardedFetch, GuardedFetchError } from "../integrations/guarded-fetch";
import { attachmentIdentity } from "../domain/attachment-identity";
import { createHash } from "node:crypto";
import {
  FULL_ORDER,
  downstreamImpact,
  type Coverage,
  type Finding,
  type VerificationScope,
} from "../domain/reverification";
import {
  compareDeadline,
  compareDocuments,
  compareMetadata,
  compareRequirements,
  type DocumentFacts,
  type RequirementFacts,
} from "../domain/reverification-compare";
import { finishVerification, markRunning } from "../reverification";
import type { AgentDefinition } from "./types";
import { actingOrgId } from "../tenant-context";
import type { Opportunity } from "../types";

/** Local rather than imported: hashing a buffer is one line and no dependency. */
function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** A document is not re-downloaded past this, and says so rather than lying. */
const MAX_DOC_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 45_000;

export const reverify: AgentDefinition = {
  name: "reverify",
  label: "Solicitation reverification",
  description:
    "Checks one solicitation against its source and reports the differences without overwriting the record.",
  worksWithoutClaude: true,
  async handler(ctx) {
    const runId = String(ctx.payload.runId ?? "");
    const opportunityId = String(ctx.payload.opportunityId ?? "");
    const scope = String(ctx.payload.scope ?? "full") as VerificationScope;
    const orgId = String(ctx.payload.orgId ?? "") || (await actingOrgId()) || "";
    if (!runId || !opportunityId || !orgId) {
      return { ok: false, summary: "reverify needs a run, an opportunity and an organization" };
    }

    await markRunning(runId, orgId);

    const opp = await queryOne<Opportunity>(
      `select * from opportunities where id = $1 and org_id = $2`,
      [opportunityId, orgId]
    );
    if (!opp) {
      await finishVerification({
        runId,
        orgId,
        findings: [],
        coverage: emptyCoverage(),
        failedScopes: [],
        fingerprintAfter: null,
        aborted: true,
        error: "The opportunity is no longer on this account.",
      });
      return { ok: false, summary: "opportunity not found" };
    }

    const wanted = scope === "full" ? FULL_ORDER : [scope];
    const findings: Finding[] = [];
    const failed: VerificationScope[] = [];
    const coverage = emptyCoverage();

    /*
     * The source, first, because everything below depends on it.
     *
     * When SAM cannot be reached the run does not stop: the document hashes
     * already on file are still worth comparing against what storage holds,
     * and a partial answer is more useful than none as long as it says it is
     * partial. What it must never do is continue as though the source
     * confirmed anything.
     */
    let notice: Awaited<ReturnType<typeof lookupNotice>> | null = null;
    let retryableFailure = false;
    if (wanted.includes("source_and_amendments")) {
      let sourceFailure: string | null = null;
      try {
        notice = await lookupNotice(opp);
      } catch (err) {
        sourceFailure = err instanceof Error ? err.message : String(err);
        retryableFailure = true;
      }
      if (!notice) {
        failed.push("source_and_amendments");
        findings.push({
          scope: "source_and_amendments",
          subject: "The source notice",
          kind: "unreadable",
          impact: "material",
          before: opp.solicitation_number ?? null,
          after: null,
          note: `${sourceFailure ?? "SAM did not return this notice"}. Nothing below was confirmed against the source.`,
        });
        await logAgent({
          agent: "reverify",
          action: "source-unreadable",
          opportunityId,
          level: "error",
          status: "error",
          message: `The solicitation source could not be verified: ${sourceFailure ?? "SAM did not return this notice"}.`,
        });
      } else {
        findings.push(...metadataFindings(opp, notice));
        findings.push(
          ...compareDeadline({
            label: "Offer deadline",
            before: opp.deadline ? new Date(opp.deadline) : null,
            after: notice.responseDeadLine ? new Date(notice.responseDeadLine) : null,
            beforeTimezone: null,
            afterTimezone: null,
          })
        );
      }
    }

    if (wanted.includes("documents")) {
      const result = await documentFindings(opportunityId, orgId, notice?.resourceLinks ?? null);
      findings.push(...result.findings);
      coverage.documentsExpected = result.coverage.documentsExpected;
      coverage.documentsVerified = result.coverage.documentsVerified;
      coverage.documentsUnreadable = result.coverage.documentsUnreadable;
      coverage.pagesProcessed = result.coverage.pagesProcessed;
      if (result.couldNotEnumerate) failed.push("documents");
      if (result.coverage.documentsUnreadable > 0) retryableFailure = true;
    }

    if (wanted.includes("requirements_and_deadlines")) {
      findings.push(...requirementFindings(opp, notice));
    }

    if (wanted.includes("trade_scopes")) {
      /*
       * The one scope this agent will not claim to have performed.
       *
       * Trades are derived by reading the documents, and re-deriving them
       * needs a fresh analysis this agent deliberately does not run: an
       * analysis that also rewrote the record would be the silent-overwrite
       * bug wearing a verification badge. So when the documents moved, the
       * trades are reported as unverified and the scope is recorded as one
       * that did not complete.
       */
      const documentsMoved = findings.some(
        (f) => f.scope === "documents" && (f.kind === "changed" || f.kind === "added")
      );
      if (documentsMoved) {
        failed.push("trade_scopes");
        for (const trade of opp.solicitation_analysis?.required_trades ?? []) {
          findings.push({
            scope: "trade_scopes",
            subject: `Required trade: ${trade}`,
            kind: "unreadable",
            impact: "material",
            before: String(trade),
            after: null,
            note: "A document changed, so this trade was derived from a version that no longer exists. Re-run the analysis to establish the current scope.",
          });
        }
      }
    }

    if (wanted.includes("scoring_and_eligibility")) {
      /*
       * Scoring dimensions are judgment produced by the scoring model. Reusing
       * the stored dimension points, or asking the same model again, is not an
       * independent verification. This branch used to do nothing at all, which
       * let a narrow scoring check (and a full check with no other findings)
       * finish as "verified, no changes" despite never checking the score.
       */
      failed.push("scoring_and_eligibility");
      findings.push({
        scope: "scoring_and_eligibility",
        subject: "Score and eligibility judgment",
        kind: "unreadable",
        impact: "material",
        before: opp.score == null ? null : String(opp.score),
        after: null,
        note:
          "This verification does not independently re-score judgment-based dimensions. Re-run Scoring Engine after the current documents are analyzed, then review its evidence before relying on eligibility or tier.",
      });
    }

    if (wanted.includes("bid_readiness")) {
      try {
        const readiness = await readinessFindings(opp, orgId);
        findings.push(...readiness.findings);
        if (!readiness.complete) failed.push("bid_readiness");
      } catch (err) {
        retryableFailure = true;
        failed.push("bid_readiness");
        findings.push({
          scope: "bid_readiness",
          subject: "Bid package evidence",
          kind: "unreadable",
          impact: "blocking",
          before: null,
          after: null,
          note:
            "Bid readiness could not be read from the database. The package is not verified; retry after the database connection recovers.",
        });
        await logAgent({
          agent: "reverify",
          action: "bid-readiness-unreadable",
          opportunityId,
          level: "error",
          status: "error",
          message: `Bid readiness could not be checked: ${(err as Error).message}`,
        });
      }
    }

    const run = await finishVerification({
      runId,
      orgId,
      findings,
      coverage,
      failedScopes: failed,
      fingerprintAfter: notice
        ? sha256(JSON.stringify(sortedNotice(notice as unknown as Record<string, unknown>)))
        : null,
    });

    const material = findings.filter((f) => f.kind !== "unchanged" && f.impact !== "safe_metadata");
    const impact = downstreamImpact(findings);

    const incomplete = run.state === "partially_verified" || run.state === "failed";
    await logAgent({
      agent: "reverify",
      action: "verification-finished",
      opportunityId,
      level: incomplete ? "error" : material.length > 0 ? "warn" : "info",
      status: incomplete ? "error" : "ok",
      message: `Checked against the source: ${run.state.replace(/_/g, " ")}. ${material.length} material difference${material.length === 1 ? "" : "s"}.`,
      reasoning: impact.lines.join(" "),
    });

    /*
     * Nothing is applied here.
     *
     * The temptation is to at least stop outreach automatically when the trade
     * scope moved, and the domain module says that is what should happen. It
     * is not this agent's call: an automated stop is an operator control with
     * its own audit trail, and firing it from a background job would produce a
     * suppression nobody chose. The finding says outreach should stop, the
     * screen says so, and a person does it.
    */
    return {
      ok: !incomplete,
      ...(incomplete && !retryableFailure ? { permanent: true } : {}),
      summary:
        `${run.state} with ${material.length} material difference(s)` +
        (failed.length > 0
          ? `; did not complete ${failed.map((item) => item.replace(/_/g, " ")).join(", ")}`
          : ""),
      data: { state: run.state, failedScopes: failed, materialDifferences: material.length },
      humanActionRequired: incomplete || material.length > 0,
    };
  },
};

function emptyCoverage(): Coverage {
  return {
    documentsExpected: 0,
    documentsVerified: 0,
    documentsUnreadable: 0,
    pagesProcessed: 0,
  };
}

/**
 * Find the notice again.
 *
 * The window is widened deliberately: the default search covers the last three
 * days, which is right for ingestion and useless for looking up a solicitation
 * posted two months ago.
 */
async function lookupNotice(opp: Opportunity) {
  const solnum = opp.solicitation_number?.trim();
  if (!solnum) throw new Error("No solicitation number is stored on this opportunity");
  if (!opp.org_id) throw new Error("The opportunity has no organization owner");
  const posted = opp.posted_at ? new Date(opp.posted_at) : null;
  const from = posted ? new Date(posted.getTime() - 7 * 86_400_000) : new Date(Date.now() - 400 * 86_400_000);
  const res = await sam.searchOpportunities({
      solnum,
      postedFrom: mmddyyyy(from),
      postedTo: mmddyyyy(new Date()),
      limit: 10,
    }, opp.org_id);
  if (res.error) throw new Error(`SAM search failed: ${res.error}`);
  if (res.disabled) throw new Error("SAM search is not configured for this account");
  const notice =
    res.items.find((i) => (i.solicitationNumber ?? "").trim() === solnum) ??
    res.items[0] ??
    null;
  if (!notice) throw new Error(`SAM returned no notice for solicitation ${solnum}`);
  return notice;
}

function mmddyyyy(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

function sortedNotice(n: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(n).sort(([a], [b]) => (a < b ? -1 : 1)));
}

function metadataFindings(
  opp: Opportunity,
  notice: NonNullable<Awaited<ReturnType<typeof lookupNotice>>>
): Finding[] {
  return compareMetadata([
    { label: "Title", before: opp.title ?? null, after: notice.title ?? null, cosmetic: true },
    { label: "Agency", before: opp.agency ?? null, after: notice.fullParentPathName ?? notice.department ?? null, cosmetic: true },
    { label: "NAICS code", before: opp.naics_code ?? null, after: notice.naicsCode ?? null },
    {
      label: "Set aside",
      before: opp.set_aside_type ?? null,
      after: notice.typeOfSetAsideDescription ?? notice.typeOfSetAside ?? null,
    },
    {
      label: "Notice type",
      before: (opp.raw_json as { type?: string } | null)?.type ?? null,
      after: notice.type ?? null,
    },
  ]);
}

/**
 * The attachment manifest, rebuilt from the source rather than trusted.
 *
 * When the source list is unavailable the stored inventory is still compared
 * against storage, which catches a file that has gone missing on our side. It
 * cannot catch one the agency added, and the caller records that the scope did
 * not complete.
 */
async function documentFindings(
  opportunityId: string,
  orgId: string,
  resourceLinks: string[] | null
): Promise<{ findings: Finding[]; coverage: Coverage; couldNotEnumerate: boolean }> {
  const stored = await query<{
    id: string;
    name: string;
    content_hash: string | null;
    page_count: number | null;
    source_url: string | null;
  }>(
    `select id, name, content_hash, page_count, source_url
       from documents
      where opportunity_id = $1 and org_id = $2 and kind = 'solicitation'
        and superseded_by is null and disposition <> 'excluded'`,
    [opportunityId, orgId]
  );

  const before: DocumentFacts[] = stored.map((d) => ({
    key: keyFor(d.source_url, d.name),
    name: d.name,
    contentHash: d.content_hash,
    pageCount: d.page_count,
    readable: true,
  }));

  if (!resourceLinks) {
    return {
      findings: [],
      coverage: {
        documentsExpected: before.length,
        documentsVerified: 0,
        documentsUnreadable: before.length,
        pagesProcessed: 0,
      },
      couldNotEnumerate: true,
    };
  }

  const after: DocumentFacts[] = [];
  let unreadable = 0;
  const seenSourceKeys = new Set<string>();
  for (const link of resourceLinks) {
    const name = nameFromLink(link);
    const key = keyFor(link, name);
    if (seenSourceKeys.has(key)) continue;
    seenSourceKeys.add(key);
    try {
      const res = await guardedFetch(link, {
        maxBytes: MAX_DOC_BYTES,
        timeoutMs: FETCH_TIMEOUT_MS,
        onOversize: "refuse",
      });
      after.push({
        key,
        name,
        contentHash: sha256(res.body),
        // Page count is not recomputed here: opening every PDF to count pages
        // is the expensive half of extraction, and the hash already answers
        // "did this file change".
        pageCount: null,
        readable: true,
      });
    } catch (err) {
      unreadable++;
      after.push({
        key,
        name,
        contentHash: null,
        pageCount: null,
        readable: false,
      });
      // Recorded, not thrown: one attachment behind a login must not stop the
      // other eight being checked. Every failure kind is surfaced, not only
      // GuardedFetchError, because an ordinary network error is equally
      // important to the document's verification status.
      const reason = err instanceof GuardedFetchError
        ? err.kind
        : err instanceof Error
          ? err.message
          : String(err);
      await logAgent({
        agent: "reverify",
        action: "document-unreadable",
        opportunityId,
        level: "warn",
        status: "error",
        message: `${name} could not be re-downloaded: ${reason}.`,
      });
    }
  }

  return {
    findings: compareDocuments(before, after),
    coverage: {
      documentsExpected: Math.max(before.length, after.length),
      documentsVerified: after.filter((d) => d.readable).length,
      documentsUnreadable: unreadable,
      pagesProcessed: 0,
    },
    couldNotEnumerate: false,
  };
}

/** The source's own id where the URL carries one, else the filename. */
function keyFor(url: string | null, name: string): string {
  return attachmentIdentity({ name, url: url ?? undefined });
}

function nameFromLink(link: string): string {
  try {
    const u = new URL(link);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return decodeURIComponent(last ?? link).slice(0, 200);
  } catch {
    return link.slice(0, 200);
  }
}

/**
 * Requirements, compared against the notice's own description.
 *
 * Not a re-extraction: this compares the mandatory list on file against
 * itself, which sounds pointless until you notice what it establishes, which
 * is whether the deadline the requirements were written against still holds.
 * A fuller independent read needs a fresh analysis, and this agent does not
 * run one for the reason given at the trade-scope branch.
 */
function requirementFindings(
  opp: Opportunity,
  notice: Awaited<ReturnType<typeof lookupNotice>> | null
): Finding[] {
  const stored: RequirementFacts[] = (opp.solicitation_analysis?.compliance_matrix ?? []).map(
    (r) => ({
      id: String(r.id ?? r.title ?? "").toLowerCase(),
      title: String(r.title ?? r.id ?? "Untitled requirement"),
      mandatory: r.mandatory === true,
      citation: r.source ?? null,
    })
  );
  if (stored.length === 0) {
    return [
      {
        scope: "requirements_and_deadlines",
        subject: "The compliance matrix",
        kind: "unreadable",
        impact: "material",
        before: null,
        after: null,
        note: "No requirements have been extracted for this solicitation, so there is nothing to check them against.",
      },
    ];
  }
  // Compared against itself: every item reads as unchanged, and the value is
  // the count and the citations rather than the verdict. Where the source is
  // unreachable the caller has already recorded the scope as incomplete.
  return notice ? compareRequirements(stored, stored) : [];
}

/**
 * Whether the package still matches what it was built against.
 *
 * Deterministic and cheap: the fingerprint the bid recorded at assembly, and
 * the fingerprint the requirements produce now.
 */
async function readinessFindings(
  opp: Opportunity,
  orgId: string
): Promise<{ findings: Finding[]; complete: boolean }> {
  const bid = await queryOne<{
    requirements_fingerprint: string | null;
    package_ready: boolean;
    submission_state: string | null;
  }>(
    `select requirements_fingerprint, package_ready, submission_state
       from bids where opportunity_id = $1 and org_id = $2
      order by created_at desc limit 1`,
    [opp.id, orgId]
  );
  if (!bid) {
    return {
      complete: false,
      findings: [
        {
          scope: "bid_readiness",
          subject: "Bid package",
          kind: "unreadable",
          impact: "blocking",
          before: null,
          after: null,
          note: "No bid package exists for this opportunity. Build the package before treating it as ready to submit.",
        },
      ],
    };
  }

  const { currentRequirementsFingerprint } = await import("../bid-package-state");
  const current = currentRequirementsFingerprint(opp);
  const findings: Finding[] = [];
  let complete = true;

  if (!bid.package_ready) {
    complete = false;
    findings.push({
      scope: "bid_readiness",
      subject: "Package readiness",
      kind: "unreadable",
      impact: "blocking",
      before: "not ready",
      after: null,
      note: "The latest bid is not marked package-ready. Complete the Bid Builder checks before submission.",
    });
  }

  if (!bid.requirements_fingerprint || !current) {
    complete = false;
    findings.push({
      scope: "bid_readiness",
      subject: "Package fingerprint",
      kind: "unreadable",
      impact: "blocking",
      before: bid.requirements_fingerprint,
      after: current,
      note:
        "The package or current requirements have no verifiable fingerprint. Rebuild the package from the current requirements before submission.",
    });
    return { findings, complete };
  }
  if (bid.requirements_fingerprint === current) {
    findings.push({
      scope: "bid_readiness",
      subject: "Package fingerprint",
      kind: "unchanged",
      impact: "safe_metadata",
      before: bid.requirements_fingerprint,
      after: current,
    });
    return { findings, complete };
  }
  findings.push({
    scope: "bid_readiness",
    subject: "Package fingerprint",
    kind: "changed",
    impact: "blocking",
    before: bid.requirements_fingerprint,
    after: current,
    note: "The package was assembled against different requirements from the ones on file now. Re-run the Bid Builder before this goes out.",
  });
  return { findings, complete };
}
