import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { GPT6_RATES } from "../lib/ai/model-contracts";

it("adds only candidate rates, preserves custom rates/ceilings, and keeps unknown costs null", async () => {
  const db = new PGlite();
  try {
    await db.exec("create table api_usage_rates (provider text, service text, rates jsonb, max_request_cost numeric, evidence text, unique(provider,service))");
    await db.exec(readFileSync("db/migrations/124_gpt41_rates.sql","utf8"));
    const migration = readFileSync("db/migrations/134_gpt6_candidate_rates.sql","utf8");
    await db.exec(migration);
    for (const [model,rates] of Object.entries(GPT6_RATES)) {
      const row = (await db.query<{rates:unknown;max_request_cost:string}>("select rates,max_request_cost::text from api_usage_rates where service=$1",[model])).rows[0];
      expect(row.rates).toEqual(rates);
      expect(Number(row.max_request_cost)).toBe(3);
    }
    const priced = await db.query<{cost:string}>("select api_token_estimate('{\"input_tokens\":1000,\"output_tokens\":200}'::jsonb,rates)::text as cost from api_usage_rates where service='gpt-6-sol'");
    expect(Number(priced.rows[0].cost)).toBeCloseTo(0.004,12);
    expect((await db.query("select api_token_estimate('{\"requests\":1}'::jsonb,rates) as cost from api_usage_rates")).rows.every(row => row.cost === null)).toBe(true);
    await db.exec("update api_usage_rates set max_request_cost=9,rates='{\"input_tokens\":99,\"output_tokens\":99}',evidence='operator-custom' where service='gpt-6-sol'");
    await db.exec(migration);
    expect((await db.query("select max_request_cost::text,rates,evidence from api_usage_rates where service='gpt-6-sol'")).rows[0]).toEqual({max_request_cost:"9",rates:{input_tokens:99,output_tokens:99},evidence:"operator-custom"});
    expect((await db.query("select count(*)::int as count from api_usage_rates")).rows[0].count).toBe(3);
  } finally { await db.close(); }
},30000);
