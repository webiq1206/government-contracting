import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("lib/agents/maintenance.ts", "utf8");

function between(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("outreach maintenance safety", () => {
  it("never turns a failed or fully paused organization lookup into legacy work", () => {
    const body = between("async function activeOrgIds", "export const outreachFollowup");
    expect(body).toContain('orgsToSweep("maintenance")');
    expect(body).toContain("if (fanout.error)");
    expect(body).toContain("throw new Error");
    expect(body).toContain("return fanout.orgs.map");
    expect(body).not.toContain("LEGACY_ORG_ID");
  });

  it("keeps follow-up schedules on claims, pauses, and transport failures", () => {
    const body = between("async function followUpForOrg", "export const outreachRecoverySweep");
    expect(body).toMatch(/follow_up_at = now\(\) \+ interval '15 minutes'[\s\S]*returning id/);
    expect(body).toMatch(/else if \(res\.disabled\)[\s\S]*follow_up_at = now\(\) \+ interval '1 hour'/);
    expect(body).toMatch(/Transport failure[\s\S]*follow_up_at = now\(\) \+ interval '15 minutes'/);
  });

  it("assesses the complete attachment package before any fallback follow-up can send", () => {
    const body = between("async function followUpForOrg", "export const outreachRecoverySweep");
    expect(body).toContain("gatherTradeAttachments(orgId, opp");
    expect(body).toContain("assessAttachmentPackage({");
    expect(body).toContain("undelivered: fallbackGathered.undelivered");
    expect(body).toContain("if (!packageAssessment.ok)");
    expect(body).toContain('action: "attachment-blocked"');
    expect(body.indexOf("if (!packageAssessment.ok)")).toBeLessThan(
      body.indexOf("const res = await sendOutreachEmail")
    );
  });

  it("does not recover failed outreach for paused accounts or removed pairings", () => {
    const body = between("export const outreachRecoverySweep", "export const reviewExpirySweep");
    expect(body).toContain('orgsToSweep("outreach-recovery-sweep")');
    expect(body).toContain("os.removed_at is null");
    expect(body).toContain("their recovery work was left unchanged");
  });

  it("leaves paused reply cursors unchanged and persists bounded backlog progress", () => {
    const body = between("export const replyPoll", "export const unresponsiveSweep");
    expect(body).toContain('orgsToSweep("reply-poll")');
    expect(body).toContain("their mailbox cursors were left unchanged");
    expect(body).toContain("reply_poll_page_token");
    expect(body).toContain("reply_poll_scan_started");
  });

  it("runs platform-only backlink outreach only for the founding account", () => {
    const body = between("export const backlinkOutreachSweep", "export function extractMentionedPrice");
    expect(body).toContain("runWithOrg(LEGACY_ORG_ID");
    expect(body).toContain("isAutomationPaused()");
    expect(body).not.toContain("listActiveOrganizations");
    expect(body).toContain("p.org_id = o.org_id");
    expect(body).toMatch(/where id = \$1 and org_id = \$2/);
  });
});
