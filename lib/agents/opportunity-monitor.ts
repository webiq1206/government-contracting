/**
 * OPPORTUNITY MONITOR — cron every 2 hours.
 * Polls SAM.gov (and optional state/local scrapers), deduplicates against
 * existing records by source_id, normalizes to the opportunities schema, stores
 * new rows, triggers the Scoring Engine for each, and routes Sources Sought
 * notices to the high-priority sub-queue (Sources Sought Responder).
 */
import { query, queryOne } from "../db";
import { getProfileJson } from "../ai/companyProfile";
import { logAgent } from "../logger";
import { sam, type SamOpportunity } from "../integrations/sam";
import { runEnabledScrapers } from "../integrations/scrapers";
import type { AgentDefinition } from "./types";
import type { AgentResult } from "../types";

function firstPoc(o: SamOpportunity) {
  const poc = o.pointOfContact?.[0];
  return poc ? { name: poc.fullName, email: poc.email, phone: poc.phone } : null;
}

/** Normalize a SAM notice into an opportunities insert payload. */
function normalizeSam(o: SamOpportunity) {
  const isSourcesSought =
    (o.type ?? "").toLowerCase().includes("sources sought") ||
    (o.type ?? "").toLowerCase() === "r";
  return {
    source: "sam_federal",
    source_id: o.noticeId,
    solicitation_number: o.solicitationNumber ?? null,
    title: o.title ?? null,
    description: o.description ?? null,
    naics_code: o.naicsCode ?? null,
    psc_code: o.classificationCode ?? null,
    set_aside_type: o.typeOfSetAsideDescription ?? o.typeOfSetAside ?? null,
    value_estimated: o.award?.amount ? Number(o.award.amount) : null,
    deadline: o.responseDeadLine ?? null,
    posted_at: o.postedDate ?? null,
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
  n: ReturnType<typeof normalizeSam>
): Promise<{ inserted: boolean; id?: string; isSourcesSought: boolean }> {
  if (!n.source_id) return { inserted: false, isSourcesSought: n.is_sources_sought };
  const existing = await queryOne<{ id: string }>(
    `select id from opportunities where source_id = $1`,
    [n.source_id]
  );
  if (existing) return { inserted: false, id: existing.id, isSourcesSought: n.is_sources_sought };

  const row = await queryOne<{ id: string }>(
    `insert into opportunities
      (source, source_id, solicitation_number, title, description, naics_code, psc_code,
       set_aside_type, value_estimated, deadline, posted_at, location_state, location_text,
       agency, sub_agency, contact_json, attachments_json, raw_json, is_sources_sought,
       stage, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
             'scoring','open')
     returning id`,
    [
      n.source, n.source_id, n.solicitation_number, n.title, n.description, n.naics_code,
      n.psc_code, n.set_aside_type, n.value_estimated, n.deadline, n.posted_at,
      n.location_state, n.location_text, n.agency, n.sub_agency,
      n.contact_json ? JSON.stringify(n.contact_json) : null,
      JSON.stringify(n.attachments_json),
      JSON.stringify(n.raw_json),
      n.is_sources_sought,
    ]
  );
  return { inserted: true, id: row!.id, isSourcesSought: n.is_sources_sought };
}

export const opportunityMonitor: AgentDefinition = {
  name: "opportunity-monitor",
  label: "Opportunity Monitor",
  description:
    "Polls SAM.gov + state/local portals, dedupes, normalizes, stores, and triggers scoring.",
  cron: "0 */2 * * *", // every 2 hours
  worksWithoutClaude: true, // ingestion is rule-based; scoring needs Claude
  async handler(): Promise<AgentResult> {
    const profile = await getProfileJson();
    const naics = profile?.naics_codes ?? [];
    const enqueued: AgentResult["enqueued"] = [];
    let ingested = 0;
    let sourcesSought = 0;
    let skippedDisabled = false;

    // --- Federal (SAM.gov) ---
    // Paginate so a busy NAICS window can't silently drop notices past the
    // first page. Bounded at 5 pages/run (500 notices) to respect the daily
    // SAM key quota; the 2-hour cron catches anything beyond that next run.
    const samItems: Awaited<ReturnType<typeof sam.searchOpportunities>>["items"] = [];
    let samDisabled = false;
    const search0 = await sam.searchOpportunities({
      naicsCodes: naics.length ? naics : undefined,
      ptype: "o,p,k,r", // Solicitation, Presol, Combined, Sources Sought
      limit: 100,
      offset: 0,
    });
    samDisabled = !!search0.disabled;
    samItems.push(...(search0.items ?? []));
    if (!samDisabled && (search0.items?.length ?? 0) === 100) {
      for (let page = 1; page < 5; page++) {
        const next = await sam.searchOpportunities({
          naicsCodes: naics.length ? naics : undefined,
          ptype: "o,p,k,r",
          limit: 100,
          offset: page * 100,
        });
        samItems.push(...(next.items ?? []));
        if ((next.items?.length ?? 0) < 100) break;
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
        message: "SAM_API_KEY not set — federal ingestion skipped.",
      });
    } else {
      for (const o of search.items) {
        const res = await ingestOne(normalizeSam(o));
        if (res.inserted && res.id) {
          ingested++;
          if (res.isSourcesSought) {
            sourcesSought++;
            enqueued.push({
              agent: "sources-sought-responder",
              payload: { opportunityId: res.id },
            });
          }
          // Always score newly ingested opportunities. Singleton per opp so a
          // re-run within the window can't double-score (and double-trigger
          // the whole downstream pipeline).
          enqueued.push({
            agent: "scoring-engine",
            payload: { opportunityId: res.id },
            opts: { singletonKey: `score:${res.id}`, singletonSeconds: 3600 },
          });
        }
      }
    }

    // --- State / local portals (Playwright scrapers; opt-in) ---
    const scraped = await runEnabledScrapers(naics).catch(() => []);
    for (const s of scraped) {
      const existing = await queryOne<{ id: string }>(
        `select id from opportunities where source_id = $1`,
        [s.source_id]
      );
      if (existing) continue;
      const row = await queryOne<{ id: string }>(
        `insert into opportunities
           (source, source_id, title, description, naics_code, set_aside_type,
            value_estimated, deadline, location_state, agency, raw_json, stage, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'scoring','open') returning id`,
        [
          s.source, s.source_id, s.title, s.description ?? null, s.naics_code ?? null,
          s.set_aside_type ?? null, s.value_estimated ?? null, s.deadline ?? null,
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

    const summary = skippedDisabled
      ? `Ingestion partial (SAM disabled). ${ingested} new from other sources.`
      : `Ingested ${ingested} new opportunities (${sourcesSought} sources-sought), triggered scoring.`;
    return {
      ok: true,
      summary,
      reasoning: `Polled SAM for NAICS [${naics.join(", ")}]; deduped by source_id; routed sources-sought to high-priority queue.`,
      data: { ingested, sourcesSought, scanned: search.items?.length ?? 0 },
      enqueued,
    };
  },
};
