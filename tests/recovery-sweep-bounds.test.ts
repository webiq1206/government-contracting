import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("applies recovery limits to actual selection SQL without borrowing another tenant's failures", async () => {
  const source = readFileSync("lib/agents/maintenance.ts", "utf8");
  const sql = source.match(/`(select id, title from opportunities[\s\S]*?limit 200)`/)?.[1];
  expect(sql).toBeTruthy();
  const db = new PGlite();
  try {
    await db.exec(`create table opportunities(id text,org_id text,title text,status text,stage text,score integer,is_sources_sought boolean,created_at timestamptz,human_action_required boolean,risk_flags text[]);
      create table job_runs(org_id text,opportunity_id text,agent text,status text,started_at timestamptz,summary jsonb);
      insert into opportunities select id,'a',id,'open','scoring',null,false,now()-interval '2 days'
        from unnest(array['eligible','recent','capped','success','other-tenant','research','lease-waits','value-held']) id;
      update opportunities set is_sources_sought=true where id='research';
      -- Held for a person on a value limit: scoring again returns the same hold.
      update opportunities set human_action_required=true, risk_flags=array['pre_analysis_value_below_min'] where id='value-held';
      insert into job_runs values('a','recent','scoring-engine','error',now()-interval '30 minutes'),
        ('a','success','scoring-engine','ok',now()-interval '2 days'),
        ('b','other-tenant','scoring-engine','ok',now());
      insert into job_runs select 'a','capped','scoring-engine','error',now()-interval '2 hours' from generate_series(1,3);
      -- Three refusals while an earlier attempt was inside its lease (a worker
      -- restart mid-call) are waits, not failures, and must not cap the record.
      insert into job_runs select 'a','lease-waits','scoring-engine','error',now()-interval '2 hours','{"transientHold":true}'::jsonb from generate_series(1,3);`);
    const result = await db.query<{ id: string }>(sql!, ["a"]);
    // An old ok run can mean held work, not a produced score. Missing output
    // remains recoverable after backoff; current output is the success proof.
    expect(result.rows.map(row => row.id).sort()).toEqual(["eligible", "lease-waits", "other-tenant", "success"]);
    await db.exec("update opportunities set score=70 where id='success'");
    expect((await db.query<{ id: string }>(sql!, ["a"])).rows.map(row=>row.id).sort()).toEqual(["eligible", "lease-waits", "other-tenant"]);
    const analysisSql = source.match(/`(select id from opportunities[\s\S]*?solicitation_analysis is null[\s\S]*?limit 200)`/)?.[1];
    expect(analysisSql).toBeTruthy();
    await db.exec(`alter table opportunities add column solicitation_analysis jsonb;
      delete from opportunities where id='value-held';
      update opportunities set score=70;
      update job_runs set agent='solicitation-analyst';`);
    const analysis = await db.query<{ id: string }>(analysisSql!, ["a"]);
    expect(analysis.rows.map(row => row.id).sort()).toEqual(["eligible", "lease-waits", "other-tenant", "success"]);
    await db.exec("update opportunities set solicitation_analysis='{}'::jsonb where id='success'");
    expect((await db.query<{ id: string }>(analysisSql!, ["a"])).rows.map(row=>row.id).sort()).toEqual(["eligible", "lease-waits", "other-tenant"]);
    // Sent to analysis for a document read whose analyst job was never
    // created: unscored, but recoverable. Unscored in scoring is not briefed.
    await db.exec(`insert into opportunities(id,org_id,title,status,stage,score,is_sources_sought,created_at)
      values('stranded','a','stranded','open','analysis',null,false,now()-interval '2 days'),
            ('unscored-in-scoring','a','unscored','open','scoring',null,false,now()-interval '2 days')`);
    expect((await db.query<{ id: string }>(analysisSql!, ["a"])).rows.map(row=>row.id).sort()).toEqual(["eligible", "lease-waits", "other-tenant", "stranded"]);
  } finally { await db.close(); }
}, 30_000);

it("re-scores only analyses that never got their final score and have what sourcing needs", async () => {
  const source = readFileSync("lib/agents/maintenance.ts", "utf8");
  const sql = source.match(/`(select id, analysis_input_hash as hash from opportunities[\s\S]*?limit 200)`/)?.[1];
  expect(sql).toBeTruthy();
  const db = new PGlite();
  const missing = (keys: string[]) => JSON.stringify({ brief_source: "model",
    completeness: { ok: keys.length === 0, missing: keys.map(key => ({ key, critical: true })) } });
  try {
    await db.exec(`create table opportunities(id text,org_id text,status text,stage text,is_sources_sought boolean,
        pursuit_state text,solicitation_analysis jsonb,analysis_input_hash text,score_breakdown jsonb,risk_flags text[],
        deadline timestamptz,updated_at timestamptz);
      create table job_runs(org_id text,opportunity_id text,agent text,status text,started_at timestamptz,summary jsonb);`);
    const add = (id: string, analysis: string, extra: Partial<Record<string, string>> = {}) => db.query(
      `insert into opportunities values($1,'a',coalesce($2,'open'),coalesce($3,'analysis'),false,$4,$5::jsonb,'hash-1',$6::jsonb,$7::text[],now()+interval '20 days',now()-interval '1 hour')`,
      [id, extra.status ?? null, extra.stage ?? null, extra.pursuit ?? null, analysis, extra.breakdown ?? null, extra.flags ?? null]);
    await add("bid-gaps-only", missing(["analysis_verification_0", "unsupported_documents", "wage_determination"]));
    await add("complete", missing([]), { stage: "scoring" });
    await add("no-scope", missing(["scope"]));
    await add("already-scored", missing([]), { breakdown: JSON.stringify({ analysis_input_hash: "hash-1" }) });
    await add("stale-score", missing([]), { breakdown: JSON.stringify({ analysis_input_hash: "hash-0" }) });
    await add("prime-blocked", missing([]), { flags: "{prime_only_blocked}" });
    await add("stopped", missing([]), { pursuit: "stopped" });
    await add("advanced", missing([]), { stage: "sub_research" });
    await add("archived", missing([]), { status: "archived" });
    await add("portal-brief", JSON.stringify({ brief_source: "portal", completeness: { ok: true, missing: [] } }));
    await add("just-ran", missing([]));
    await add("capped", missing([]));
    await db.exec(`insert into job_runs values('a','just-ran','solicitation-analyst','ok',now()-interval '10 minutes',null);
      insert into job_runs select 'a','capped','scoring-engine','error',now()-interval '3 hours',null from generate_series(1,3);`);
    const rows = await db.query<{ id: string }>(sql!, ["a", ["solicitation_number", "agency", "deadline", "location", "scope"]]);
    expect(rows.rows.map(row => row.id).sort()).toEqual(["bid-gaps-only", "complete", "stale-score"]);
  } finally { await db.close(); }
}, 30_000);
