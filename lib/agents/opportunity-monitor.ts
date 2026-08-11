/**
 * OPPORTUNITY MONITOR, cron every 2 hours.
 * Polls SAM.gov (and optional state/local scrapers), deduplicates against
 * existing records by source_id, normalizes to the opportunities schema, stores
 * new rows, triggers the Scoring Engine for each, and routes Sources Sought
 * notices to the high-priority sub-queue (Sources Sought Responder).
 */
import { query, queryOne } from "../db";
import { getProfileJson } from "../ai/companyProfile";
import { logAgent } from "../logger";
import { sam, wantNoticeType, type SamOpportunity } from "../integrations/sam";
import { runEnabledScrapers } from "../integrations/scrapers";
import { enqueue } from "../queue";
import { resolveEstimatedValue } from "../domain/value-extract";
import { listActiveOrganizations } from "../organizations";
import { LEGACY_ORG_ID, runWithOrg } from "../tenant-context";
import type { AgentDefinition } from "./types";
import type { AgentResult } from "../types";

// SAM's ncode/ptype/state are all single-value, so federal ingestion queries
// ONE NAICS code per request and filters notice types client-side. These bounds
// keep a busy profile within the ~1000/day SAM key quota (the 2-hour cron picks
// up anything skipped on the next run; dedup by source_id prevents re-ingest).
const SAM_MAX_NAICS = 60; // codes queried per run (most profiles have far fewer)
const SAM_PAGES_PER_NAICS = 3; // 300 notices/code/run is ample for a 3-day window
const SAM_REQUEST_BUDGET = 150; // hard cap on SAM calls per run

function firstPoc(o: SamOpportunity) {
  const poc = o.pointOfContact?.[0];
  return poc ? { name: poc.fullName, email: poc.email, phone: poc.phone } : null;
}

/**
 * SAM sends "" (and occasionally unparseable text) for missing dates. Passing
 * that straight to a timestamptz column throws `invalid input syntax for type
 * timestamp with time zone: ""`, which used to abort the entire ingest run.
 * Normalize to null so a missing date is simply a missing date.
 */
function ts(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return Number.isNaN(new Date(s).getTime()) ? null : s;
}

/** Normalize a SAM notice into an opportunities insert payload. */
export function normalizeSamNotice(o: SamOpportunity) {
  const isSourcesSought =
    (o.type ?? "").toLowerCase().includes("sources sought") ||
    (o.type ?? "").toLowerCase() === "r";
  // Extract an estimated value at ingest time, when possible: SAM's own
  // award.amount is authoritative but only ever set on award notices; for a
  // live solicitation, sweep the title/description for a stated ceiling,
  // budget, or IGCE figure so scoring and the UI have a real number from the
  // moment the record exists, rather than waiting on a human to pursue it
  // before the deeper Solicitation Analyst pass runs.
  const resolvedValue = resolveEstimatedValue({
    listedAmount: o.award?.amount ? Number(o.award.amount) : null,
    title: o.title,
    description: o.description,
  });
  return {
    source: "sam_federal",
    source_id: o.noticeId,
    solicitation_number: o.solicitationNumber ?? null,
    title: o.title ?? null,
    description: o.description ?? null,
    naics_code: o.naicsCode ?? null,
    psc_code: o.classificationCode ?? null,
    set_aside_type: o.typeOfSetAsideDescription ?? o.typeOfSetAside ?? null,
    value_estimated: resolvedValue?.amount ?? null,
    value_estimated_source: resolvedValue?.source ?? null,
    deadline: ts(o.responseDeadLine),
    posted_at: ts(o.postedDate),
    location_state: o.placeOfPerformance?.state?.code ?? null,
    location_text: o.placeOfPerformance?.city?.name ?? null,
    agency: o.fullParentPathName ?? o.department ?? null,
    sub_agency: o.subTier ?? null,
    contact_json: firstPoc(o),
    attachments_json: (o.resourceLinks ?? []).map((url) => ({ name: "attachment", url })),
    raw_json: o as unknown as Record<string, unknown>,
    is_sources_sought: isSourcesSought,
  };
}

async function ingestOne(
  n: ReturnType<typeof normalizeSamNotice>,
  orgId: string
): Promise<{ inserted: boolean; id?: string; isSourcesSought: boolean }> {
  if (!n.source_id) return { inserted: false, isSourcesSought: n.is_sources_sought };
  // Deduplicate per tenant: the same SAM notice may be relevant to multiple orgs.
  const existing = await queryOne<{ id: string }>(
    `select id from opportunities where source_id = $1 and org_id = $2`,
    [n.source_id, orgId]
  );
  if (existing) return { inserted: false, id: existing.id, isSourcesSought: n.is_sources_sought };

  const row = await queryOne<{ id: string }>(
    `insert into opportunities
      (org_id, source, source_id, solicitation_number, title, description, naics_code, psc_code,
       set_aside_type, value_estimated, value_estimated_source, deadline, posted_at,
       location_state, location_text,
       agency, sub_agency, contact_json, attachments_json, raw_json, is_sources_sought,
       stage, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
             'scoring','open')
     returning id`,
    [
      orgId,
      n.source, n.source_id, n.solicitation_number, n.title, n.description, n.naics_code,
      n.psc_code, n.set_aside_type, n.value_estimated, n.value_estimated_source,
      n.deadline, n.posted_at,
      n.location_state, n.location_text, n.agency, n.sub_agency,
      n.contact_json ? JSON.stringify(n.contact_json) : null,
      JSON.stringify(n.attachments_json),
      JSON.stringify(n.raw_json),
      n.is_sources_sought,
    ]
  );
  return { inserted: true, id: row!.id, isSourcesSought: n.is_sources_sought };
}

async function monitorForOrg(orgId: string): Promise<{
  ingested: number;
  sourcesSought: number;
  ingestErrors: number;
  skippedDisabled: boolean;
  enqueued: AgentResult["enqueued"];
  naics: string[];
  scanned: number;
}> {
  return runWithOrg(orgId, async () => {
    const profile = await getProfileJson();
    const naics = profile?.naics_codes ?? [];
    const enqueued: AgentResult["enqueued"] = [];
    let ingested = 0;
    let sourcesSought = 0;
    let ingestErrors = 0;
    let skippedDisabled = false;

    // --- Federal (SAM.gov) ---
    // SAM accepts a SINGLE ncode per request, so we query once per NAICS code
    // (never a comma-joined list, which SAM silently rejects), paginate each,
    // and keep only biddable + sources-sought notices (filtered client-side,
    // since ptype is also single-value). This is the correct, complete mapping
    // of the profile's NAICS codes to SAM requests.
    const samItems: SamOpportunity[] = [];
    const seenNoticeIds = new Set<string>();
    let samDisabled = false;
    let samRequests = 0;
    let samCapped = false;

    if (naics.length === 0) {
      // No NAICS on the profile means we can't target federal notices without
      // pulling the entire firehose. Skip + warn rather than ingest noise.
      await logAgent({
        agent: "opportunity-monitor",
        action: "poll-sam",
        level: "warn",
        status: "skipped",
        message: "No NAICS codes on the Company Profile, federal ingestion skipped. Add NAICS codes in Settings to enable it.",
      });
    } else {
      const codes = naics.slice(0, SAM_MAX_NAICS);
      if (naics.length > SAM_MAX_NAICS) samCapped = true;
      naicsLoop: for (const code of codes) {
        for (let page = 0; page < SAM_PAGES_PER_NAICS; page++) {
          if (samRequests >= SAM_REQUEST_BUDGET) {
            samCapped = true;
            break naicsLoop;
          }
          const res = await sam.searchOpportunities({
            naics: code,
            limit: 100,
            offset: page * 100,
          });
          samRequests++;
          if (res.disabled) {
            samDisabled = true;
            break naicsLoop;
          }
          const items = res.items ?? [];
          for (const o of items) {
            if (!wantNoticeType(o.type)) continue; // drop award/special/etc.
            if (o.noticeId && seenNoticeIds.has(o.noticeId)) continue;
            if (o.noticeId) seenNoticeIds.add(o.noticeId);
            samItems.push(o);
          }
          if (items.length < 100) break; // last page for this NAICS
        }
      }
    }

    const search = { disabled: samDisabled, items: samItems };
    if (search.disabled) {
      skippedDisabled = true;
      await logAgent({
        agent: "opportunity-monitor",
        action: "poll-sam",
        level: "warn",
        status: "skipped",
        message: "SAM_API_KEY not set, federal ingestion skipped.",
      });
    } else {
      if (samCapped) {
        await logAgent({
          agent: "opportunity-monitor",
          action: "poll-sam",
          level: "info",
          message: `SAM request budget reached (${samRequests} calls, ${naics.length} NAICS). Remaining codes/pages will be picked up on the next 2-hour run.`,
        });
      }
      for (const o of search.items) {
        // Fault-isolate EVERY notice. A single malformed record (bad date,
        // oversized field) used to throw out of this loop, abort the whole
        // run, and, because the runner only enqueues downstream work on a
        // clean return, silently discard the scoring jobs for every record
        // already inserted in this batch. That is how hundreds of records
        // ended up sitting in Scoring forever.
        try {
          const res = await ingestOne(normalizeSamNotice(o), orgId);
          if (!res.inserted || !res.id) continue;
          ingested++;
          if (res.isSourcesSought) {
            sourcesSought++;
            enqueued.push({
              agent: "sources-sought-responder",
              payload: { opportunityId: res.id },
            });
          }
          // Enqueue scoring IMMEDIATELY rather than accumulating it for the
          // runner to flush at the end: a later failure can no longer strand
          // the records ingested before it. Singleton per opp so a re-run
          // within the window can't double-score.
          await enqueue(
            "scoring-engine",
            { opportunityId: res.id },
            { singletonKey: `score:${res.id}`, singletonSeconds: 3600 }
          ).catch((e) =>
            console.error("[opportunity-monitor] enqueue scoring failed:", (e as Error).message)
          );
        } catch (err) {
          ingestErrors++;
          await logAgent({
            agent: "opportunity-monitor",
            action: "ingest-skip",
            level: "warn",
            message: `Skipped one malformed notice (${o.noticeId ?? "no id"}): ${(err as Error).message}`,
          });
        }
      }
    }

    // --- State / local portals (Playwright scrapers; opt-in) ---
    const scraped = await runEnabledScrapers(naics).catch(() => []);
    for (const s of scraped) {
      const existing = await queryOne<{ id: string }>(
        `select id from opportunities where source_id = $1 and org_id = $2`,
        [s.source_id, orgId]
      );
      if (existing) continue;
      const scraperValue = resolveEstimatedValue({
        listedAmount: s.value_estimated ?? null, // scrapers that already parsed a value pass it directly
        title: s.title,
        description: s.description,
      });
      const row = await queryOne<{ id: string }>(
        `insert into opportunities
           (org_id, source, source_id, title, description, naics_code, set_aside_type,
            value_estimated, value_estimated_source, deadline, location_state, agency, raw_json, stage, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'scoring','open') returning id`,
        [
          orgId,
          s.source, s.source_id, s.title, s.description ?? null, s.naics_code ?? null,
          s.set_aside_type ?? null, scraperValue?.amount ?? null, scraperValue?.source ?? null,
          s.deadline ?? null,
          s.location_state ?? null, s.agency ?? null, JSON.stringify(s.raw ?? {}),
        ]
      );
      if (row) {
        ingested++;
        enqueued.push({
          agent: "scoring-engine",
          payload: { opportunityId: row.id },
          opts: { singletonKey: `score:${row.id}`, singletonSeconds: 3600 },
        });
      }
    }

    return {
      ingested,
      sourcesSought,
      ingestErrors,
      skippedDisabled,
      enqueued,
      naics,
      scanned: search.items?.length ?? 0,
    };
  });
}

export const opportunityMonitor: AgentDefinition = {
  name: "opportunity-monitor",
  label: "Opportunity Monitor",
  description:
    "Polls SAM.gov + state/local portals per subscribed organization, dedupes, stores, and triggers scoring.",
  cron: "0 */2 * * *", // every 2 hours
  worksWithoutClaude: true, // ingestion is rule-based; scoring needs Claude
  async handler(): Promise<AgentResult> {
    let orgs = await listActiveOrganizations().catch(() => []);
    if (orgs.length === 0) {
      // Pre-migration / single-tenant fallback.
      orgs = [{ id: LEGACY_ORG_ID } as Awaited<ReturnType<typeof listActiveOrganizations>>[number]];
    }

    let ingested = 0;
    let sourcesSought = 0;
    let ingestErrors = 0;
    let skippedDisabled = false;
    const enqueued: AgentResult["enqueued"] = [];
    const naicsAll = new Set<string>();

    for (const org of orgs) {
      const result = await monitorForOrg(org.id);
      ingested += result.ingested;
      sourcesSought += result.sourcesSought;
      ingestErrors += result.ingestErrors;
      skippedDisabled = skippedDisabled || result.skippedDisabled;
      enqueued.push(...(result.enqueued ?? []));
      for (const n of result.naics) naicsAll.add(n);
    }

    const summary = skippedDisabled
      ? `Ingestion partial (SAM disabled). ${ingested} new from other sources across ${orgs.length} org(s).`
      : `Ingested ${ingested} new opportunities across ${orgs.length} org(s) (${sourcesSought} sources-sought), triggered scoring.${
          ingestErrors > 0 ? ` Skipped ${ingestErrors} malformed notice(s).` : ""
        }`;
    return {
      ok: true,
      summary,
      reasoning: `Polled SAM per org for NAICS [${[...naicsAll].join(", ")}]; deduped by source_id+org_id.`,
      data: { ingested, sourcesSought, orgs: orgs.length },
      enqueued,
    };
  },
};
