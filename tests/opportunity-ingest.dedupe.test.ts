/**
 * Idempotent ingest: the same notice / solicitation number must never create
 * a second open opportunity for an org. Uses the real DB when DATABASE_URL is
 * set; otherwise skips.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("opportunity ingest dedupe", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let ingestOpportunity: typeof import("../lib/domain/opportunity-ingest").ingestOpportunity;

  const orgId = "00000000-0000-4000-8000-000000000001";
  const sourceId = `test-notice-${randomUUID()}`;
  const solNum = `TEST-SOL-${randomUUID().slice(0, 8).toUpperCase()}`;
  const createdIds: string[] = [];

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ ingestOpportunity } = await import("../lib/domain/opportunity-ingest"));
  });

  afterAll(async () => {
    if (createdIds.length) {
      await query(`delete from opportunities where id = any($1::uuid[])`, [
        createdIds,
      ]);
    }
    await query(
      `delete from opportunities where source_id like 'test-notice-%' or solicitation_number like 'TEST-SOL-%'`
    ).catch(() => undefined);
  });

  it("inserts once for a source_id and skips the second insert", async () => {
    const first = await ingestOpportunity({
      orgId,
      source: "manual",
      source_id: sourceId,
      solicitation_number: solNum,
      title: "TEST dedupe opp A",
      description: "first",
      raw_json: {},
      attachments_json: [],
    });
    expect(first.inserted).toBe(true);
    expect(first.id).toBeTruthy();
    createdIds.push(first.id!);

    const second = await ingestOpportunity({
      orgId,
      source: "manual",
      source_id: sourceId,
      solicitation_number: solNum,
      title: "TEST dedupe opp A refreshed",
      description: "second pass",
      deadline: "2026-12-01T17:00:00Z",
      raw_json: { amended: true },
      attachments_json: [{ name: "amendment", url: "https://example.test/a" }],
    });
    expect(second.inserted).toBe(false);
    expect(second.id).toBe(first.id);
    expect(second.dedupedBy).toBe("source_id");

    const count = await queryOne<{ n: string }>(
      `select count(*)::text as n from opportunities where org_id=$1 and source_id=$2`,
      [orgId, sourceId]
    );
    expect(Number(count?.n)).toBe(1);

    const row = await queryOne<{ title: string; deadline: string | null }>(
      `select title, deadline::text from opportunities where id=$1`,
      [first.id]
    );
    expect(row?.title).toBe("TEST dedupe opp A refreshed");
    expect(row?.deadline).toBeTruthy();
  });

  it("blocks a different noticeId that shares the same open solicitation number", async () => {
    const otherSource = `test-notice-${randomUUID()}`;
    const third = await ingestOpportunity({
      orgId,
      source: "manual",
      source_id: otherSource,
      solicitation_number: solNum.toLowerCase(),
      title: "TEST amendment twin",
      raw_json: {},
      attachments_json: [],
    });
    expect(third.inserted).toBe(false);
    expect(third.dedupedBy).toBe("solicitation_number");
    expect(third.id).toBe(createdIds[0]);

    const count = await queryOne<{ n: string }>(
      `select count(*)::text as n from opportunities
        where org_id=$1 and status='open'
          and lower(btrim(solicitation_number)) = lower(btrim($2))`,
      [orgId, solNum]
    );
    expect(Number(count?.n)).toBe(1);
  });

  it("allows the same source_id for a different org when present", async () => {
    // If only one org exists in the DB this still proves the lookup is org-scoped:
    // a second org id that is not the legacy org should insert independently
    // when the unique index is (org_id, source_id). Skip if FK blocks unknown org.
    const otherOrg = await queryOne<{ id: string }>(
      `select id from organizations where id <> $1 limit 1`,
      [orgId]
    );
    if (!otherOrg) return;

    const res = await ingestOpportunity({
      orgId: otherOrg.id,
      source: "manual",
      source_id: sourceId,
      solicitation_number: `${solNum}-ORG2`,
      title: "TEST other org same notice",
      raw_json: {},
      attachments_json: [],
    });
    expect(res.inserted).toBe(true);
    if (res.id) createdIds.push(res.id);
  });
});
