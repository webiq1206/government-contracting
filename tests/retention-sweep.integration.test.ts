/**
 * DB-backed integration tests for the retention sweep helper and
 * expiredOpportunitySweep delete-unworkable path.
 *
 * Each test creates its own fixture rows and cleans up in afterAll,
 * so tests can run safely against the dev database without leaking data.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("purgeOpportunitiesWithBlobs (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  // Use a dynamic import to get the unexported helper via the agent handler.
  // We test the helper indirectly via retentionSweep.handler(), which is the
  // actual production code path.
  let retentionSweep: typeof import("../lib/agents/maintenance").retentionSweep;
  let expiredOpportunitySweep: typeof import("../lib/agents/maintenance").expiredOpportunitySweep;
  let setAutomationRules: typeof import("../lib/app-settings").setAutomationRules;

  // Shared IDs for cleanup
  const ids = {
    opp1: randomUUID(),      // stale archived — should be purged
    opp2: randomUUID(),      // stale archived WITH a quote — must be kept
    opp3: randomUUID(),      // stale archived, shared blob path — should purge opp but keep blob
    oppShared: randomUUID(), // another opp referencing the same blob path — must be kept alive
    oppJunk: randomUUID(),   // past-deadline junk in monitoring — expired sweep should delete
    oppJunkBlob: randomUUID(), // past-deadline junk WITH a blob — expired sweep deletes opp + blob
  };
  const SHARED_PATH = `test-shared/${randomUUID()}.pdf`;
  const OPP1_PATH   = `test-opp1/${randomUUID()}.pdf`;
  const JUNK_PATH   = `test-junk/${randomUUID()}.pdf`;

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ retentionSweep, expiredOpportunitySweep } = await import("../lib/agents/maintenance"));
    ({ setAutomationRules } = await import("../lib/app-settings"));

    // Set retention to 1 day so "old" test records qualify immediately.
    await setAutomationRules({ retention_days: 1 }, "test@example.com");

    const staleDate = "2020-01-01";

    // opp1 — plain stale archived record, has its own blob
    await query(
      `insert into opportunities (id, title, stage, status, source, updated_at)
       values ($1, 'TEST-RETENTION opp1', 'dismissed', 'archived', 'manual', $2)`,
      [ids.opp1, staleDate]
    );
    await query(
      `insert into documents (opportunity_id, kind, name, storage_path, storage_backend)
       values ($1, 'solicitation', 'sow.pdf', $2, 'db')`,
      [ids.opp1, OPP1_PATH]
    );
    await query(
      `insert into file_blobs (path, mime, bytes) values ($1, 'application/pdf', $2)`,
      [OPP1_PATH, Buffer.from("blob-data-opp1")]
    );

    // opp2 — stale archived WITH a quote; must never be deleted
    await query(
      `insert into opportunities (id, title, stage, status, source, updated_at)
       values ($1, 'TEST-RETENTION opp2 (has quote)', 'dismissed', 'archived', 'manual', $2)`,
      [ids.opp2, staleDate]
    );
    await query(
      `insert into quotes (opportunity_id, quote_amount)
       values ($1, 50000)`,
      [ids.opp2]
    );

    // opp3 — stale archived, uses a blob path shared with oppShared
    await query(
      `insert into opportunities (id, title, stage, status, source, updated_at)
       values ($1, 'TEST-RETENTION opp3 (shared blob)', 'dismissed', 'archived', 'manual', $2)`,
      [ids.opp3, staleDate]
    );
    await query(
      `insert into documents (opportunity_id, kind, name, storage_path, storage_backend)
       values ($1, 'solicitation', 'shared.pdf', $2, 'db')`,
      [ids.opp3, SHARED_PATH]
    );

    // oppShared — active open record referencing same blob path
    await query(
      `insert into opportunities (id, title, stage, status, source)
       values ($1, 'TEST-RETENTION oppShared (active)', 'analysis', 'open', 'manual')`,
      [ids.oppShared]
    );
    await query(
      `insert into documents (opportunity_id, kind, name, storage_path, storage_backend)
       values ($1, 'solicitation', 'shared.pdf', $2, 'db')`,
      [ids.oppShared, SHARED_PATH]
    );
    await query(
      `insert into file_blobs (path, mime, bytes) values ($1, 'application/pdf', $2)
       on conflict (path) do nothing`,
      [SHARED_PATH, Buffer.from("shared-blob-data")]
    );

    // oppJunk — past-deadline in monitoring, no work — expired sweep should delete
    await query(
      `insert into opportunities (id, title, stage, status, source, deadline)
       values ($1, 'TEST-RETENTION junk (monitoring)', 'monitoring', 'open', 'manual', '2020-01-01')`,
      [ids.oppJunk]
    );

    // oppJunkBlob — past-deadline junk WITH a stored blob
    await query(
      `insert into opportunities (id, title, stage, status, source, deadline)
       values ($1, 'TEST-RETENTION junkBlob', 'monitoring', 'open', 'manual', '2020-01-01')`,
      [ids.oppJunkBlob]
    );
    await query(
      `insert into documents (opportunity_id, kind, name, storage_path, storage_backend)
       values ($1, 'solicitation', 'junk.pdf', $2, 'db')`,
      [ids.oppJunkBlob, JUNK_PATH]
    );
    await query(
      `insert into file_blobs (path, mime, bytes) values ($1, 'application/pdf', $2)`,
      [JUNK_PATH, Buffer.from("junk-blob")]
    );
  });

  afterAll(async () => {
    // Clean up anything that wasn't deleted by the sweeps (e.g. the protected records).
    const remainingIds = [ids.opp1, ids.opp2, ids.opp3, ids.oppShared, ids.oppJunk, ids.oppJunkBlob];
    await query(`delete from opportunities where id = any($1)`, [remainingIds]).catch(() => {});
    await query(`delete from file_blobs where path = any($1)`, [
      [OPP1_PATH, SHARED_PATH, JUNK_PATH],
    ]).catch(() => {});
    // Restore retention default
    await (await import("../lib/app-settings")).setAutomationRules(
      { retention_days: 30 }, "test@example.com"
    );
  });

  it("retentionSweep deletes stale archived opp and its blob", async () => {
    await retentionSweep.handler();

    const opp = await queryOne(`select id from opportunities where id = $1`, [ids.opp1]);
    expect(opp).toBeNull(); // opportunity deleted

    const blob = await queryOne(`select path from file_blobs where path = $1`, [OPP1_PATH]);
    expect(blob).toBeNull(); // blob deleted too
  });

  it("retentionSweep NEVER deletes an opportunity that has a quote", async () => {
    const opp = await queryOne(`select id from opportunities where id = $1`, [ids.opp2]);
    expect(opp).not.toBeNull(); // still present
  });

  it("retentionSweep deletes opp3 but KEEPS the shared blob (still referenced by oppShared)", async () => {
    const opp = await queryOne(`select id from opportunities where id = $1`, [ids.opp3]);
    expect(opp).toBeNull(); // opp deleted

    // The shared blob must survive because oppShared still has a document referencing it.
    const blob = await queryOne(`select path from file_blobs where path = $1`, [SHARED_PATH]);
    expect(blob).not.toBeNull();
  });

  it("expiredOpportunitySweep deletes past-deadline monitoring junk and its blob", async () => {
    await expiredOpportunitySweep.handler();

    const opp = await queryOne(`select id from opportunities where id = $1`, [ids.oppJunk]);
    expect(opp).toBeNull(); // deleted

    const oppBlob = await queryOne(`select id from opportunities where id = $1`, [ids.oppJunkBlob]);
    expect(oppBlob).toBeNull(); // deleted

    const blob = await queryOne(`select path from file_blobs where path = $1`, [JUNK_PATH]);
    expect(blob).toBeNull(); // blob also cleaned up
  });
});
