/**
 * COMPLIANCE MONITOR, daily cron (08:00). Tracks every compliance deadline and
 * cap (SYS-08): SAM registration expiry, small-business certifications, state LLC
 * annual reports, insurance renewals, the non-small-business sub spend cap per
 * active contract, and FAR changes. Upserts a compliance_items row per check and
 * sends a single bundled SMS alert for any critical/blocked items.
 *
 * Rule-only agent (worksWithoutClaude:true). Claude is used opportunistically to
 * summarize FAR RSS relevance when available.
 */
import { query, queryOne } from "../db";
import { getProfileJson } from "../ai/companyProfile";
import { complete, ClaudeNotConfiguredError } from "../ai/claude";
import { logAgent } from "../logger";
import { orgsToSweep, fanoutNote } from "./org-fanout";
import { sam } from "../integrations/sam";
import { sms } from "../integrations/twilio";
import { deadlineStatus, daysBetween, nonSsCapState } from "../domain/compliance";
import { listActiveOrganizations } from "../organizations";
import { runWithOrg } from "../tenant-context";
import type { AgentDefinition } from "./types";

/** Named once, because the fan-out helper logs under it. */
const AGENT_NAME = "compliance-monitor";
import type { AgentResult } from "../types";
import type { ComplianceStatus } from "../domain/compliance";
import {
  COMPLIANCE_STATE_LABEL,
  COMPLIANCE_STATE_ORDER,
} from "../domain/compliance-state";

const FAR_RSS = "https://www.acquisition.gov/rss.xml";

interface UpsertArgs {
  orgId: string;
  category: string;
  label: string;
  contractId?: string | null;
  dueAt?: string | null;
  status: ComplianceStatus;
  daysRemaining?: number | null;
  detail?: Record<string, unknown>;
  /**
   * False when there is nothing the platform can check for this item.
   *
   * Four of the items below are placeholders whose own detail says "Operator
   * must set the expiry date". They were written as `ok` and rendered as "On
   * track", which is a claim about the future made from no evidence at all: a
   * certification nobody has ever supplied a date for, asserted to be fine.
   */
  monitorable?: boolean;
}

/**
 * Upsert by (org, category, contract_id, label), updating the existing item or
 * inserting a new one.
 *
 * The dedupe lookup has to name the org, because the keys it matches on are
 * not unique across tenants: every organization has exactly one item labelled
 * "SAM.gov registration" in category sam_registration. Unscoped, the first
 * customer to be checked owned that row and every later customer's daily run
 * overwrote it with their own expiry date, status, and UEI.
 */
async function upsertItem(a: UpsertArgs): Promise<void> {
  const contractId = a.contractId ?? null;
  const existing = await queryOne<{ id: string }>(
    `select id from compliance_items
      where org_id = $4
        and category = $1 and coalesce(contract_id::text,'') = coalesce($2::text,'')
        and label = $3
        and coalesce(source,'monitor') = 'monitor'
      limit 1`,
    [a.category, contractId, a.label, a.orgId]
  );
  if (existing) {
    await query(
      `update compliance_items
          set due_at=$2, status=$3, days_remaining=$4, detail=$5,
              monitorable=$6, last_checked_at=now()
        where id=$1`,
      [
        existing.id,
        a.dueAt ?? null,
        a.status,
        a.daysRemaining ?? null,
        a.detail ? JSON.stringify(a.detail) : null,
        a.monitorable ?? true,
      ]
    );
  } else {
    // compliance_items is a root table, so nothing derives its org: an item
    // written without one is invisible on the compliance page that exists to
    // show it.
    await query(
      `insert into compliance_items
         (org_id, category, label, contract_id, due_at, status, days_remaining, detail,
          monitorable, last_checked_at)
       values ($8,$1,$2,$3,$4,$5,$6,$7,$9,now())`,
      [
        a.category,
        a.label,
        contractId,
        a.dueAt ?? null,
        a.status,
        a.daysRemaining ?? null,
        a.detail ? JSON.stringify(a.detail) : null,
        a.orgId,
        a.monitorable ?? true,
      ]
    );
  }
}

/**
 * The run's own counts, in the states it actually wrote.
 *
 * Listing five fixed severities meant a run that produced none of them still
 * reported "0 critical, 0 blocked, 0 warning", which reads as a clean check
 * whether or not anything was checked at all.
 */
function tallyLine(counts: Partial<Record<ComplianceStatus, number>>): string {
  const parts = COMPLIANCE_STATE_ORDER.filter((s) => (counts[s] ?? 0) > 0).map(
    (s) => `${counts[s]} ${COMPLIANCE_STATE_LABEL[s].toLowerCase()}`
  );
  return parts.length ? parts.join(", ") : "nothing to check";
}

/** States that put an item in front of somebody rather than on a list. */
function isRed(s: ComplianceStatus): boolean {
  return s === "expired" || s === "blocked" || s === "conflicting";
}

export const complianceMonitor: AgentDefinition = {
  name: "compliance-monitor",
  label: "Compliance Monitor",
  description:
    "Daily deadline + cap tracking: SAM registration, SB certs, state LLC, insurance, non-SS sub cap, FAR changes. Alerts on critical items.",
  cron: "0 8 * * *",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    /**
     * One compliance check per organization.
     *
     * Everything this agent decides is per customer: their UEI, their
     * certifications, their contracts, their alert thresholds, their phone
     * number. With no tenant context it read the founding org's profile,
     * swept every org's active contracts against it, and texted the results
     * to our alert number. The items it wrote had no org, so the compliance
     * page that exists to show them stayed empty.
     */
    const fanout = await orgsToSweep(AGENT_NAME);
    const orgs = fanout.orgs;

    const summaries: string[] = [];
    const failed: string[] = [];
    let humanAction = false;
    for (const org of orgs) {
      /**
       * One tenant's failure must not end the sweep.
       *
       * This loop is the nightly compliance check for every organization on
       * the platform, and it was a bare await: one org with a malformed
       * profile, a deleted contract mid-run, or any other throw aborted the
       * whole handler, so every tenant after it in the list was silently
       * never checked. The run reported as failed, which reads as "the check
       * did not happen" rather than "it happened for eleven of twelve".
       */
      try {
        const res = await runWithOrg(org.id, () => checkForOrg(org.id));
        summaries.push(res.summary);
        // One organization with a critical item is enough to need a human.
        humanAction = humanAction || res.humanAction;
      } catch (err) {
        failed.push(org.id);
        humanAction = true;
        console.error(
          `[compliance-monitor] check failed for org ${org.id}: ${(err as Error).message}`
        );
        await logAgent({
          agent: "compliance-monitor",
          action: "daily-check",
          level: "error",
          status: "error",
          message: `Compliance check failed for this organization: ${(err as Error).message}`,
        }).catch(() => {});
      }
    }

    const failureNote = failed.length
      ? ` ${failed.length} organization(s) could not be checked and need attention.`
      : "";
    const note = fanoutNote(fanout);
    return {
      ok: fanout.error == null,
      summary: note
        ? note
        : (summaries.length === 1 && failed.length === 0
            ? summaries[0]
            : `Compliance check across ${summaries.length} of ${summaries.length + failed.length} organizations. ${summaries.join(" | ")}`) +
          failureNote,
      // Nobody checked is a person-shaped problem: it is the nightly
      // compliance sweep, and a night it did not happen has to be visible.
      humanActionRequired: humanAction || fanout.error != null,
    };
  },
};

async function checkForOrg(
  orgId: string
): Promise<{ summary: string; humanAction: boolean }> {
  const profile = await getProfileJson();
  if (!profile) return { summary: "no active Company Profile", humanAction: false };

  const now = new Date();
  const t = profile.decision_thresholds;
  const counts: Partial<Record<ComplianceStatus, number>> = {};
  const criticalMessages: string[] = [];
  const tally = (s: ComplianceStatus) => {
    counts[s] = (counts[s] ?? 0) + 1;
  };

  // --- 1) SAM registration. ---
  if (profile.uei) {
    const reg = await sam.getEntityRegistration(profile.uei);
    if (reg && !reg.disabled && reg.expiresAt) {
      const days = daysBetween(now, new Date(reg.expiresAt));
      const status = deadlineStatus(days, t.sam_alert_days, { blockAtZero: true });
      await upsertItem({
        orgId,
        category: "sam_registration",
        label: "SAM.gov registration",
        dueAt: reg.expiresAt,
        status,
        daysRemaining: days,
        detail: { uei: profile.uei, registrationStatus: reg.status ?? null },
      });
      tally(status);
      if (isRed(status) && days <= 7) {
        criticalMessages.push(`SAM registration expires in ${days}d`);
      }
    } else {
      await upsertItem({
        orgId,
        category: "sam_registration",
        label: "SAM.gov registration",
        /*
         * We asked and could not get an answer. That is exactly what "Cannot
         * monitor" is for, and it is a very different statement from the "On
         * track" this used to show, which asserted a registration was current
         * on the strength of an API call that returned nothing.
         */
        status: "cannot_monitor",
        monitorable: false,
        detail: {
          uei: profile.uei,
          note: reg?.disabled ? "SAM API disabled" : "no expiry returned; verify manually",
        },
      });
      tally("cannot_monitor");
    }
  }

  // --- 2) Small-business certifications (operator-managed expiry dates). ---
  for (const cert of profile.certifications ?? []) {
    const detail: Record<string, unknown> = {
      certification: cert,
      note: "Operator must set the expiry date for this certification.",
    };
    if (now.getMonth() === 0 && /hubzone/i.test(cert)) {
      detail.hubzone_review =
        "January review: re-verify HUBZone eligibility (map + employee residency).";
    }
    await upsertItem({
      orgId,
      category: "sb_cert",
      label: `${cert} certification`,
      // There is no register the platform can read a certification expiry
      // from. Somebody has to supply it, and until they do the honest state is
      // that nobody knows rather than that it is fine.
      status: "cannot_monitor",
      monitorable: false,
      detail,
    });
    tally("cannot_monitor");
  }

  // --- 3) State LLC annual report (operator-managed date). ---
  await upsertItem({
    orgId,
    category: "state_llc",
    label: "State LLC annual report",
    status: "cannot_monitor",
    monitorable: false,
    detail: {
      state: profile.entity_state ?? null,
      alert_days: t.state_llc_alert_days,
      note: "Operator must set the annual-report due date.",
    },
  });
  tally("cannot_monitor");

  // --- 4) Insurance renewals (operator-managed date). ---
  await upsertItem({
    orgId,
    category: "insurance",
    label: "Insurance renewal",
    status: "cannot_monitor",
    monitorable: false,
    detail: {
      alert_days: t.insurance_alert_days,
      note: "Operator must set insurance renewal date(s) (GL, workers' comp, etc.).",
    },
  });
  tally("cannot_monitor");

  // --- 5) Non-small-business sub spend cap per active contract. ---
  const contracts = await query<{
    id: string;
    contract_number: string | null;
    non_ss_sub_pct: string | number | null;
  }>(
    `select id, contract_number, non_ss_sub_pct from contracts
      where org_id = $1 and status = 'active'`,
    [orgId]
  );
  for (const c of contracts) {
    const nonSs = Number(c.non_ss_sub_pct ?? 0);
    const cap = nonSsCapState(nonSs, t.non_ss_cap_pct, t.non_ss_alert_pct);
    const status: ComplianceStatus = cap.status;
    await upsertItem({
      orgId,
      category: "non_ss_cap",
      label: `Non-SB sub spend cap, ${c.contract_number ?? c.id}`,
      contractId: c.id,
      status,
      detail: {
        utilizationPct: cap.utilizationPct,
        capPct: t.non_ss_cap_pct,
        alertPct: t.non_ss_alert_pct,
        blockAdditional: cap.blockAdditional,
      },
    });
    tally(status);
    if (cap.alert) {
      const msg = `Non-SB sub cap ${cap.utilizationPct}% on ${
        c.contract_number ?? c.id
      }${cap.blockAdditional ? " (BLOCK new non-SB subs)" : ""}`;
      if (isRed(status)) criticalMessages.push(msg);
      else await sms.alert(msg);
    }
  }

  // --- 6) FAR changes (best-effort RSS). ---
  let farFetchFailed = false;
  const farTitles = await fetchFarTitles().catch((err) => {
    // Unchecked is not unchanged: without this, an RSS outage counted the
    // FAR-change check as clean in the daily summary.
    farFetchFailed = true;
    console.error(`[compliance-monitor] FAR feed fetch failed: ${(err as Error).message}`);
    return [] as string[];
  });
  if (farTitles.length > 0) {
    let detailText: string;
    try {
      const { text, usage } = await complete(
        [
          "Below are recent FAR / acquisition.gov RSS item titles. In 2-3 sentences, summarize which (if any) are relevant to a small government contractor doing construction/facilities work, and why. Do not use em dashes.",
          "",
          ...farTitles.slice(0, 20).map((x) => `- ${x}`),
        ].join("\n"),
        { maxTokens: 400 }
      );
      detailText = text.trim();
      await logAgent({
        agent: "compliance-monitor",
        action: "far-summary",
        message: "Summarized FAR RSS relevance.",
        claudeUsage: usage,
      });
    } catch (err) {
      if (!(err instanceof ClaudeNotConfiguredError)) throw err;
      detailText = "";
    }
    await upsertItem({
      orgId,
      category: "far_change",
      label: "FAR / acquisition.gov updates",
      /*
       * A summary somebody has to read. Not "complete": nobody here has
       * looked at it yet, and a rule change that affects how a bid has to be
       * written is exactly the thing that must not be filed as done because
       * a feed was fetched successfully.
       */
      status: "needs_review",
      detail: {
        titles: farTitles.slice(0, 20),
        summary: detailText || "Claude disabled, raw titles stored for operator review.",
        needs_review_reason: "New regulation summaries have not been read here yet.",
      },
    });
    tally("needs_review");
  } else if (farFetchFailed) {
    await upsertItem({
      orgId,
      category: "far_change",
      label: "FAR / acquisition.gov updates",
      // The feed did not answer, so nothing was checked. That is precisely
      // "Cannot monitor" and not a severity.
      status: "cannot_monitor",
      monitorable: false,
      detail: {
        summary:
          "The acquisition.gov feed could not be fetched, so regulation changes were NOT checked this run. Retries on the next scheduled run.",
      },
    });
    tally("cannot_monitor");
  }

  // --- Bundle a single SMS alert for critical/blocked items. ---
  if (criticalMessages.length > 0) {
    const body = `Compliance alerts (${criticalMessages.length}): ${criticalMessages.join(
      "; "
    )}`.slice(0, 1400);
    await sms.alert(body);
  }

  await logAgent({
    agent: "compliance-monitor",
    action: "daily-check",
    level: criticalMessages.length ? "warn" : "info",
    message: `Checked compliance: ${tallyLine(counts)}.`,
    reasoning: `SAM + certs + state LLC + insurance + ${contracts.length} active contract cap(s) + FAR RSS.`,
    output: counts,
  });

  return {
    summary: `${tallyLine(counts)}${criticalMessages.length ? " (alert sent)" : ""}`,
    humanAction: criticalMessages.length > 0,
  };
}

/** Best-effort fetch + crude parse of RSS item titles. Returns [] on any failure. */
async function fetchFarTitles(): Promise<string[]> {
  const res = await fetch(FAR_RSS, {
    headers: { "user-agent": "BROSTCO-ComplianceMonitor/1.0" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const xml = await res.text();
  const titles: string[] = [];
  const re = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const title = m[1].trim();
    if (title) titles.push(title);
  }
  // Drop the channel title (first) if there are item titles.
  return titles.length > 1 ? titles.slice(1) : titles;
}
