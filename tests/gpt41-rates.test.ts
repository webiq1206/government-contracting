import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

it("restores token estimates, preserves custom rates, and never prices missing usage as zero", async () => {
  const db = new PGlite();
  try {
    await db.exec("create table api_usage_rates (provider text, service text, rates jsonb, max_request_cost numeric, evidence text, unique(provider,service))");
    const migration = readFileSync(new URL("../db/migrations/124_gpt41_rates.sql", import.meta.url), "utf8");
    await db.exec(migration);
    const value = await db.query<{ cost: string }>("select api_token_estimate($1::jsonb,rates)::text as cost from api_usage_rates where service='gpt-4.1'", [JSON.stringify({ input_tokens: 1000, cached_input_tokens: 500, output_tokens: 200 })]);
    expect(Number(value.rows[0].cost)).toBeCloseTo(0.00385, 8);
    const missing = await db.query("select api_token_estimate('{}'::jsonb,rates) as cost from api_usage_rates");
    expect(missing.rows[0].cost).toBeNull();
    await db.exec("update api_usage_rates set max_request_cost=9");
    await db.exec(migration);
    expect(Number((await db.query("select max_request_cost from api_usage_rates")).rows[0].max_request_cost)).toBe(9);
  } finally { await db.close(); }
}, 30000);
