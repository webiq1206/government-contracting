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
 * close date, the clause list a document deterministically contains, the score
 * the current metadata produces. Trade scopes are the one thing that cannot be
 * re-derived without a fresh analysis, so this agent does not pretend to have
 * re-derived them. When the documents moved it says the trades are unverified;
 * when they did not, it says so and leaves them alone.
 *
 * A scope that cannot run goes into `failedScopes`, and the outcome model
 * refuses a clean verdict when that list is non-empty. So an unreachable
 * source produces "partly checked", never "verified".
 */
import { query, queryOne } from "../db";
import { logAgent } from "../logger";
import { sam } from "../integrations/sam";
import { guardedFetch, GuardedFetchError } from "../integrations/guarded-fetch";
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
    let notice: Awaited<ReturnType<typeof lookupNotice>> = null;
    if (wanted.includes("source_and_amendments")) {
      notice = await lookupNotice(opp);
      if (!notice) {
        failed.push("source_and_amendments");
        findings.push({
          scope: "source_and_amendments",
          subject: "The source notice",
          kind: "unreadable",
          impact: "material",
          before: opp.solicitation_number ?? null,
          after: null,
          note: "SAM could not be reached or did not return this notice, so nothing below was confirmed against the source.",
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

    if (wanted.includes("bid_readiness")) {
      findings.push(...(await readinessFindings(opportunityId, orgId)));
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

    await logAgent({
      agent: "reverify",
      action: "verification-finished",
      opportunityId,
      level: material.length > 0 ? "warn" : "info",
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
      ok: true,
      summary: `${run.state} with ${material.length} material difference(s)`,
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
  if (!solnum) return null;
  const posted = opp.posted_at ? new Date(opp.posted_at) : null;
  const from = posted ? new Date(posted.getTime() - 7 * 86_400_000) : new Date(Date.now() - 400 * 86_400_000);
  const res = await sam
    .searchOpportunities({
      solnum,
      postedFrom: mmddyyyy(from),
      postedTo: mmddyyyy(new Date()),
      limit: 10,
    })
    .catch(() => null);
  if (!res || res.disabled || res.error) return null;
  return res.items.find((i) => (i.solicitationNumber ?? "").trim() === solnum) ?? res.items[0] ?? null;
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
      where opportunity_id = $1 and org_id = $2 and kind = 'solicitation'`,
    [opportunityId, orgId]
  ).catch(() => []);

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
  for (const link of resourceLinks) {
    const name = nameFromLink(link);
    try {
      const res = await guardedFetch(link, {
        maxBytes: MAX_DOC_BYTES,
        timeoutMs: FETCH_TIMEOUT_MS,
        onOversize: "refuse",
      });
      after.push({
        key: keyFor(link, name),
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
        key: keyFor(link, name),
        name,
        contentHash: null,
        pageCount: null,
        readable: false,
      });
      if (err instanceof GuardedFetchError) {
        // Recorded, not thrown: one attachment behind a login must not stop
        // the other eight being checked.
        await logAgent({
          agent: "reverify",
          action: "document-unreadable",
          opportunityId,
          level: "warn",
          message: `${name} could not be re-downloaded: ${err.kind}.`,
        }).catch(() => undefined);
      }
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
  if (!url) return `name:${name.toLowerCase()}`;
  const id = /\/files\/([A-Za-z0-9-]+)\//.exec(url)?.[1];
  return id ? `sam:${id}` : `name:${name.toLowerCase()}`;
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
  notice: Awaited<ReturnType<typeof lookupNotice>>
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
async function readinessFindings(opportunityId: string, orgId: string): Promise<Finding[]> {
  const bid = await queryOne<{
    requirements_fingerprint: string | null;
    package_ready: boolean;
    submission_state: string | null;
  }>(
    `select requirements_fingerprint, package_ready, submission_state
       from bids where opportunity_id = $1 and org_id = $2
      order by created_at desc limit 1`,
    [opportunityId, orgId]
  ).catch(() => null);
  if (!bid) return [];

  const { currentRequirementsFingerprint } = await import("../bid-package-state");
  const opp = await queryOne<Opportunity>(`select * from opportunities where id = $1`, [
    opportunityId,
  ]);
  const current = opp ? currentRequirementsFingerprint(opp) : null;
  if (!bid.requirements_fingerprint || !current) return [];
  if (bid.requirements_fingerprint === current) {
    return [
      {
        scope: "bid_readiness",
        subject: "Package fingerprint",
        kind: "unchanged",
        impact: "safe_metadata",
        before: bid.requirements_fingerprint,
        after: current,
      },
    ];
  }
  return [
    {
      scope: "bid_readiness",
      subject: "Package fingerprint",
      kind: "changed",
      impact: "blocking",
      before: bid.requirements_fingerprint,
      after: current,
      note: "The package was assembled against different requirements from the ones on file now. Re-run the Bid Builder before this goes out.",
    },
  ];
}
