/**
 * Fill in the notice text for SAM rows that only carry the link to it.
 *
 * Rows ingested before the fix stored SAM's description URL as the
 * description. Scoring and analysis now read the text on their next run,
 * but a scored record that never runs again keeps printing a link. This
 * sweep reads a bounded batch per organization each hour, within the SAM
 * daily budget, so the backlog clears on its own.
 */
import type { AgentDefinition, AgentResult } from "./types";
import { query } from "../db";
import { runWithOrg } from "../tenant-context";
import { orgsToSweep } from "./org-fanout";
import { ensureNoticeDescription } from "../opportunity-description";

const PER_ORG = 30;

export const noticeDescriptionSweep: AgentDefinition = {
  name: "notice-description-sweep",
  label: "Notice Description Backfill",
  description: "Reads the notice text for SAM.gov opportunities whose description is still the API link, a bounded batch per organization per hour.",
  cron: "17 * * * *",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    const fanout = await orgsToSweep("notice-description-sweep");
    if (fanout.error) return { ok: false, summary: "No accounts were processed: the organization list could not be read." };
    let filled = 0;
    let skipped = 0;
    let stopped = 0;
    for (const org of fanout.orgs) {
      await runWithOrg(org.id, async () => {
        const rows = await query<{ id: string; source: string; source_id: string | null; description: string | null }>(
          `select id, source, source_id, description from opportunities
            where org_id=$1 and status='open' and source='sam_federal' and source_id is not null
              and description ~* '^https?://api\\.sam\\.gov/'
            order by deadline nulls last
            limit $2`,
          [org.id, PER_ORG]
        );
        for (const row of rows) {
          const text = await ensureNoticeDescription(org.id, row).catch(() => null);
          if (text) filled++;
          else {
            skipped++;
            // A refused call (no key, budget spent) will refuse the rest too.
            stopped++;
            if (stopped >= 3) break;
          }
        }
      });
    }
    return {
      ok: true,
      summary: `Filled ${filled} notice description(s)${skipped ? `; ${skipped} could not be read this run (no SAM key or budget spent, or the notice has no text)` : ""}.`,
      data: { filled, skipped },
    };
  },
};
