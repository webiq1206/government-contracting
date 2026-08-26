/**
 * Storing a re-check, against a real database.
 *
 * Two things here are enforced by Postgres rather than by convention, and both
 * are tested directly because a convention lasts until the first hotfix.
 *
 * A clean verdict cannot be written for a run that did not finish or did not
 * read every document it expected. Without that constraint, "Verified" is only
 * as good as whichever code path happened to write the row, and the whole
 * point of this work is that the word means something.
 *
 * And one live run per opportunity and scope, so a double click, a retry and a
 * scheduled run collapse into one check rather than three.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const LIVE = !!process.env.DATABASE_URL && !!process.env.ALLOW_TESTS_AGAINST_DATABASE_URL;
const d = LIVE ? describe : describe.skip;

d("the verification record", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let store: typeof import("../lib/reverification");

  const org = randomUUID();
  const otherOrg = randomUUID();
  let oppId = "";

  const clean = {
    documentsExpected: 3,
    documentsVerified: 3,
    documentsUnreadable: 0,
    pagesProcessed: 42,
  };

  async function fresh(scope: Parameters<typeof store.startVerification>[0]["scope"] = "full") {
    await query(
      `delete from solicitation_verifications where opportunity_id = $1 and scope = $2`,
      [oppId, scope]
    );
    const { run } = await store.startVerification({
      orgId: org,
      opportunityId: oppId,
      scope,
      requestedBy: "op@x.invalid",
      snapshot: { title: "Stop probe", requirements: ["a", "b"] },
    });
    return run;
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    store = await import("../lib/reverification");
    for (const [id, name] of [
      [org, "Reverify Probe"],
      [otherOrg, "Reverify Neighbour"],
    ] as const) {
      await query(
        `insert into organizations (id, name, subscription_status, billing_exempt)
         values ($1,$2,'active',true) on conflict (id) do nothing`,
        [id, name]
      );
    }
    const opp = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status)
       values ($1,'test','Reverify probe','bid_building','open') returning id`,
      [org]
    );
    oppId = opp!.id;
  });

  afterAll(async () => {
    for (const id of [org, otherOrg]) {
      await query(`delete from organizations where id = $1`, [id]).catch(() => {});
    }
    const { closePool } = await import("../lib/db");
    await closePool().catch(() => {});
  });

  it("takes the snapshot before anything is checked", async () => {
    const run = await fresh();
    const snap = await store.snapshotOf(run.id, org);
    expect(snap?.title).toBe("Stop probe");
    // And fingerprints what it snapshotted, so "nothing changed" can be a
    // comparison rather than an assertion.
    expect(run.fingerprintBefore).toBeTruthy();
    expect(run.state).toBe("queued");
  });

  it("hands back the run already going rather than starting a second", async () => {
    await fresh();
    const again = await store.startVerification({
      orgId: org,
      opportunityId: oppId,
      scope: "full",
      requestedBy: "someone-else@x.invalid",
      snapshot: {},
    });
    expect(again.alreadyRunning).toBe(true);
    const live = await query<{ id: string }>(
      `select id from solicitation_verifications
        where opportunity_id = $1 and scope = 'full' and state in ('queued','in_progress')`,
      [oppId]
    );
    expect(live).toHaveLength(1);
  });

  it("lets a different scope run alongside", async () => {
    await fresh();
    const other = await store.startVerification({
      orgId: org,
      opportunityId: oppId,
      scope: "documents",
      requestedBy: "op@x.invalid",
      snapshot: {},
    });
    expect(other.alreadyRunning).toBe(false);
    await query(`delete from solicitation_verifications where id = $1`, [other.run.id]);
  });

  it("computes the outcome rather than accepting one", async () => {
    const run = await fresh();
    await store.markRunning(run.id, org);
    const finished = await store.finishVerification({
      runId: run.id,
      orgId: org,
      findings: [],
      coverage: clean,
      failedScopes: [],
      fingerprintAfter: "same",
    });
    expect(finished.state).toBe("verified_no_changes");
  });

  it("refuses a clean verdict on a run that could not read everything", async () => {
    const run = await fresh();
    await store.markRunning(run.id, org);
    const finished = await store.finishVerification({
      runId: run.id,
      orgId: org,
      findings: [],
      coverage: { ...clean, documentsVerified: 1, documentsUnreadable: 2 },
      failedScopes: [],
      fingerprintAfter: null,
    });
    expect(finished.state).toBe("partially_verified");
  });

  it("will not let a clean verdict be written directly either", async () => {
    const run = await fresh();
    // The constraint, not the code path. A convention lasts until the first
    // hotfix; this is the thing that makes the word mean something.
    await expect(
      query(
        `update solicitation_verifications
            set state = 'verified_no_changes', finished_at = now(),
                documents_expected = 9, documents_verified = 4, documents_unreadable = 5
          where id = $1`,
        [run.id]
      )
    ).rejects.toThrow();
  });

  it("keeps coverage null when a run never got as far as counting", async () => {
    const run = await fresh();
    const read = (await store.verificationsFor(oppId, org)).find((r) => r.id === run.id);
    // Not zeroed: a run that failed before opening anything has not
    // established that there are no documents.
    expect(read?.coverage).toBeNull();
  });

  it("cancels a queued run and refuses to cancel one in progress", async () => {
    const run = await fresh();
    expect(await store.cancelVerification(run.id, org)).toBe(true);

    const second = await fresh();
    await store.markRunning(second.id, org);
    // A run in progress has opened documents and may be part way through a
    // comparison. Recording it as cancelled would leave a half-finished
    // reading labelled as a decision somebody made.
    expect(await store.cancelVerification(second.id, org)).toBe(false);
  });

  it("does not let another account start, finish or cancel a run", async () => {
    await expect(
      store.startVerification({
        orgId: otherOrg,
        opportunityId: oppId,
        scope: "documents",
        requestedBy: "intruder@x.invalid",
        snapshot: {},
      })
    ).rejects.toThrow();

    const run = await fresh();
    expect(await store.cancelVerification(run.id, otherOrg)).toBe(false);
    await expect(
      store.finishVerification({
        runId: run.id,
        orgId: otherOrg,
        findings: [],
        coverage: clean,
        failedScopes: [],
        fingerprintAfter: null,
      })
    ).rejects.toThrow();
  });

  it("reports the last run that finished, not the last one that went well", async () => {
    const run = await fresh();
    await store.markRunning(run.id, org);
    await store.finishVerification({
      runId: run.id,
      orgId: org,
      findings: [],
      coverage: { documentsExpected: 3, documentsVerified: 0, documentsUnreadable: 3, pagesProcessed: 0 },
      failedScopes: ["documents"],
      fingerprintAfter: null,
      error: "Three attachments would not open.",
    });
    const last = await store.lastVerification(oppId, org);
    // A screen showing the last clean result and hiding three failures behind
    // it is the screen that says everything is fine.
    expect(last?.state).toBe("partially_verified");
    expect(last?.error).toContain("would not open");
  });

  it("only counts a full run as a full verification when it actually concluded", async () => {
    await query(`delete from solicitation_verifications where opportunity_id = $1`, [oppId]);
    const failed = await fresh();
    await store.markRunning(failed.id, org);
    await store.finishVerification({
      runId: failed.id,
      orgId: org,
      findings: [],
      coverage: clean,
      failedScopes: [],
      fingerprintAfter: null,
      aborted: true,
    });
    expect(await store.lastFullVerificationAt(oppId, org)).toBeNull();

    const good = await fresh();
    await store.markRunning(good.id, org);
    await store.finishVerification({
      runId: good.id,
      orgId: org,
      findings: [],
      coverage: clean,
      failedScopes: [],
      fingerprintAfter: "x",
    });
    expect(await store.lastFullVerificationAt(oppId, org)).toBeTruthy();
  });

  it("records acceptance only against a run that found something to accept", async () => {
    await query(`delete from solicitation_verifications where opportunity_id = $1`, [oppId]);
    const run = await fresh();
    await store.markRunning(run.id, org);
    await store.finishVerification({
      runId: run.id,
      orgId: org,
      findings: [],
      coverage: clean,
      failedScopes: [],
      fingerprintAfter: "x",
    });
    // Nothing changed, so there is nothing to accept.
    expect(await store.acceptFindings(run.id, org, "owner@x.invalid")).toBe(false);

    await query(`delete from solicitation_verifications where opportunity_id = $1`, [oppId]);
    const changed = await fresh();
    await store.markRunning(changed.id, org);
    await store.finishVerification({
      runId: changed.id,
      orgId: org,
      findings: [
        {
          scope: "requirements_and_deadlines",
          subject: "Offer deadline",
          kind: "changed",
          impact: "blocking",
          before: "2026-04-01",
          after: "2026-03-20",
        },
      ],
      coverage: clean,
      failedScopes: [],
      fingerprintAfter: "y",
    });
    expect(await store.acceptFindings(changed.id, org, "owner@x.invalid")).toBe(true);
    // And accepting twice is not two acceptances.
    expect(await store.acceptFindings(changed.id, org, "owner@x.invalid")).toBe(false);
  });
});
