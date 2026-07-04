import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import opportunitiesRouter from "./opportunities";
import { query } from "../lib/db";

// ---------------------------------------------------------------------------
// Minimal test app — injects a fake sessionUser so requireAuth is satisfied
// without a real database session or cookie.
// ---------------------------------------------------------------------------
function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use((_req, _res, next) => {
    // Satisfy requireAuth without a real login
    (_req as Record<string, unknown>).sessionUser = { id: "test-user", email: "test@test.com" };
    next();
  });
  app.use("/opportunities", opportunitiesRouter);
  return app;
}

let server: Server;
let baseUrl: string;

// IDs for test fixtures — generated fresh per test run to avoid conflicts
let oppId: string;
let subId: string;

beforeAll(async () => {
  const app = buildTestApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}/opportunities`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

// Insert a fresh opportunity + subcontractor before each test so tests are
// independent. Clean them (and their call_cards) up when done.
beforeEach(async () => {
  // Subcontractor
  const subRows = await query<{ id: string }>(
    `insert into subcontractors (company_name, trade_categories)
     values ('Test Sub Co', ARRAY['concrete'])
     returning id`,
    []
  );
  subId = subRows[0].id;

  // Opportunity — minimal required columns (source is NOT NULL; source_id must be unique)
  const oppRows = await query<{ id: string }>(
    `insert into opportunities (title, source, source_id, stage, status, tier)
     values ('Test Opp for Quotes', 'test', $1, 'outreach', 'active', 'pursue')
     returning id`,
    [`test-opp-${Date.now()}-${Math.random()}`]
  );
  oppId = oppRows[0].id;

  return async () => {
    // Cleanup: call_cards first (FK), then the parent rows
    await query(`delete from call_cards where opportunity_id = $1`, [oppId]);
    await query(`delete from opportunities where id = $1`, [oppId]);
    await query(`delete from subcontractors where id = $1`, [subId]);
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function postQuote(
  oId: string,
  body: Record<string, unknown>
): Promise<Response> {
  return fetch(`${baseUrl}/${oId}/quotes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getDetail(oId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl}/${oId}`);
  return res.json() as Promise<Record<string, unknown>>;
}

async function getList(oId: string): Promise<Record<string, unknown> | undefined> {
  const res = await fetch(`${baseUrl}/`);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return rows.find((r) => r.id === oId);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /:id/quotes → GET /:id bid summary", () => {
  it("bid_quote_count starts at 0 before any quote is added", async () => {
    const detail = await getDetail(oppId);
    expect(detail.bid_quote_count).toBe(0);
    expect(detail.bid_min_quote).toBeNull();
    expect(detail.bid_avg_quote).toBeNull();
  });

  it("increments bid_quote_count to 1 after adding one quote", async () => {
    const post = await postQuote(oppId, {
      subcontractor_id: subId,
      quote_amount: 50000,
    });
    expect(post.ok).toBe(true);

    const detail = await getDetail(oppId);
    expect(detail.bid_quote_count).toBe(1);
    expect(detail.bid_min_quote).toBe(50000);
    expect(detail.bid_max_quote).toBe(50000);
    expect(detail.bid_avg_quote).toBe(50000);
  });

  it("updates min/max/avg when an existing card's quote_amount is updated", async () => {
    // Insert initial quote
    await postQuote(oppId, { subcontractor_id: subId, quote_amount: 50000 });

    // Update the same sub's quote (upsert path)
    const post2 = await postQuote(oppId, {
      subcontractor_id: subId,
      quote_amount: 40000,
    });
    expect(post2.ok).toBe(true);

    const detail = await getDetail(oppId);
    // Still 1 unique card — count should not double
    expect(detail.bid_quote_count).toBe(1);
    expect(detail.bid_min_quote).toBe(40000);
    expect(detail.bid_avg_quote).toBe(40000);
  });

  it("handles multiple subs: count, min, avg all reflect all quotes", async () => {
    // Add a second subcontractor
    const subRows2 = await query<{ id: string }>(
      `insert into subcontractors (company_name, trade_categories)
       values ('Second Sub', ARRAY['concrete'])
       returning id`,
      []
    );
    const subId2 = subRows2[0].id;

    try {
      await postQuote(oppId, { subcontractor_id: subId, quote_amount: 30000 });
      await postQuote(oppId, { subcontractor_id: subId2, quote_amount: 70000 });

      const detail = await getDetail(oppId);
      expect(detail.bid_quote_count).toBe(2);
      expect(detail.bid_min_quote).toBe(30000);
      expect(detail.bid_max_quote).toBe(70000);
      expect(detail.bid_avg_quote).toBe(50000);
    } finally {
      await query(`delete from call_cards where opportunity_id = $1`, [oppId]);
      await query(`delete from subcontractors where id = $1`, [subId2]);
    }
  });
});

describe("POST /:id/quotes → GET / (pipeline list) bid summary", () => {
  it("pipeline list bid_quote_count starts at 0 before any quote", async () => {
    const row = await getList(oppId);
    expect(row).toBeDefined();
    expect(row!.bid_quote_count).toBe(0);
    expect(row!.bid_min_quote).toBeNull();
  });

  it("pipeline list reflects bid_quote_count after a manual quote is added", async () => {
    await postQuote(oppId, { subcontractor_id: subId, quote_amount: 25000 });

    const row = await getList(oppId);
    expect(row).toBeDefined();
    expect(row!.bid_quote_count).toBe(1);
    expect(Number(row!.bid_min_quote)).toBe(25000);
  });

  it("pipeline list does not count call_cards without a quote_amount", async () => {
    // Insert a call_card with no quote (status = voicemail, no amount)
    await query(
      `insert into call_cards (opportunity_id, subcontractor_id, status, card_json, response_json)
       values ($1, $2, 'voicemail', '{}'::jsonb, '{"outcome":"voicemail"}'::jsonb)`,
      [oppId, subId]
    );

    const row = await getList(oppId);
    expect(row!.bid_quote_count).toBe(0);
    expect(row!.bid_min_quote).toBeNull();
  });
});
